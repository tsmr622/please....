import os, json, time, re
import openai
import asyncio
import grpc
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.formatters import TextFormatter
from typing import Optional

import youtubesummary_pb2
import youtubesummary_pb2_grpc

# OpenAI API 설정
openai.api_key = os.getenv("OPENAI_API_KEY")

# 유저별 작업 관리
user_tasks = {}

# 캐시 디렉토리
CACHE_DIR = "./transcript_cache"
os.makedirs(CACHE_DIR, exist_ok=True)

def extract_video_id(youtube_url: str) -> str:
    """YouTube URL에서 video ID를 추출"""
    import re
    
    # 다양한 YouTube URL 패턴 지원
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)',
        r'youtube\.com\/v\/([^&\n?#]+)',
        r'youtube\.com\/watch\?.*v=([^&\n?#]+)'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, youtube_url)
        if match:
            return match.group(1)
    
    raise ValueError("유효한 YouTube URL이 아닙니다.")


def get_transcript_text(video_id: str, languages=['ko', 'en']) -> str:
    """자막 가져오고 텍스트로 변환"""
    try:
        transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=languages)
        text = "\n".join(
            f"{float(line['start']):.2f}s ~ {float(line['start']) + float(line['duration']):.2f}s: {line['text']}"
            for line in transcript
        )
        return text
    except Exception as e:
        print(f"[오류 발생] {e}")
        return None

async def generate_youtube_summary(transcript: str, video_title: str = "") -> str:
    """OpenAI API를 사용해서 YouTube 자막 요약 생성"""
    if not openai.api_key:
        raise Exception("OpenAI API 키가 설정되지 않아 요약을 생성할 수 없습니다.")

    print("OpenAI API로 YouTube 요약 생성 중...")

    # 자막이 너무 길면 잘라내기
    max_transcript_length = 4000
    if len(transcript) > max_transcript_length:
        transcript = transcript[:max_transcript_length] + "..."

    prompt = f"""
다음은 YouTube 동영상의 자막입니다. 이 자막을 바탕으로 동영상의 내용을 요약해주세요.

동영상 제목: {video_title}
자막 내용:
{transcript}

1. 전체 규칙
- `|||` 기호를 사용하여 항목 타입과 내용, 필드를 구분
- 각 항목은 반드시 새로운 줄에서 시작

2. 항목 타입별 정의:
- `__COMMENT` : 사용자가 유튜브 영상을 실행했을 때 이 영상에 대한 짧은 코멘트 (예: "재밌는 영상을 보고 있네? 이 영상은 이런 내용이야")
- `__SUMMARY` : 사용자가 보고 있는 영상의 전체 요약으로 주제와 관련되어 사용자가 전체 요약을 봤을 때 영상의 전체 내용을 유추하고 파악할 수 있는 150~200자 내외의 한국어 요약 설명
- `__TIMELINE` : 사용자가 보고 있는 영상의 타임라인으로 이 항목에는 아래에서 설명하는 규칙을 따라야 함 

3. `__TIMELINE` 규칙
- 자막 내용을 타임라인으로 표현할 때 시간 형식은 [MM:SS] 형식으로 해야합니다. 예를 들어 112.34초는 [1:52]로 표현해야 하고 시간이 1시간이 넘어 갈때는 [시:분:초]형태가 아닌 [총 분:초]로 표현해야 합니다.
- 타임라인은 5개 이상 10개 이하로 자막을 참고하여 영상 전체 구간을 시간대별로 고르게 나눠서 중요한 장면을 요약하세요.
- 타임라인은 100자 이내로 작성하되 맥락과 의도 또는 전달하려는 주제를 추론하여 단순 나열이 아닌 내용 흐름에 따른 구조화된 설명으로 작성해주세요.
- 가능하다면 말의 분위기와 감정도 파악해서 요약에 반영, 의미 없는 자막은 제외하고 핵심 자막을 기준으로 소주제를 정리해주세요.
- 자막에 기반하여 실제 등장한 시간대만 포함하세요.
- 잘못된 미래 시간(예: [13844], [12652423:36] 등)은 절대 생성하지 마세요.
- 오타/잘못된 시간 표현이 있으면 즉시 실패
- 영어, 특수문자, 이상한 괄호 사용 금지
- 타임라인마다 반드시 줄바꿈하세요.  즉, [00:12], [01:23] 등 '[' 문자가 나올 때마다 줄바꿈(새 줄) 되도록 작성하세요.  
 
4. 프롬프트 응답 포맷 예시:
 __COMMENT|||흥미로운 영상을 보고 있구나. 이 영상은 이런 내용이야.
 __SUMMARY|||이 영상은 복잡한 주제를 시청자에게 쉽게 전달하기 위해 구조적으로 구성되어 있습니다. 서두에서는 핵심 문제를 제시하고, 이어지는 본문에서는 이를 해결하기 위한 이론, 사례, 실험 결과 등을 체계적으로 설명합니다. 마지막에는 전체 내용을 요약하며 시청자에게 적용 가능한 인사이트를 제공합니다. 영상 전반에 걸쳐 시청자의 이해를 돕는 그래픽과 예시가 풍부하게 포함되어 있습니다.
 __TIMELINE|||
 [00:15] 영상 도입부에서 주제의 중요성과 배경 설명  
 [01:42] 핵심 개념 A에 대한 정의와 간단한 시각적 예시  
 [04:10] 실제 사례를 바탕으로 개념 A 적용 과정 설명  
 [06:25] 개념 B 도입과 A와의 비교 분석  
 [09:00] 종합 요약 및 시청자에게 던지는 사색적 질문     
    """.format(video_title=video_title, transcript=transcript)

    response = openai.ChatCompletion.create(
        model="gpt-3.5-turbo",
        messages=[
            {"role": "system", "content": "당신은 YouTube 동영상의 자막을 분석하여 명확하고 유용한 요약을 제공하는 전문가입니다."},
            {"role": "user", "content": prompt}
        ],
        max_tokens=4000,
        temperature=0.7,
        stream=False
    )

    yield response["choices"][0]["message"]["content"]
    yield ""  # 마지막 빈 응답

# gRPC 서비스 구현
class YoutubeSummaryService(youtubesummary_pb2_grpc.YoutubeSummaryServiceServicer):
    async def YoutubeSummary(self, request, context):
        user_id = request.user_id
        youtube_url = request.youtubeUrl

        # 기존 작업이 있으면 취소
        if user_id in user_tasks:
            user_tasks[user_id].cancel()
            try:
                await user_tasks[user_id]
            except asyncio.CancelledError:
                pass

        user_tasks[user_id] = asyncio.current_task()

        print(f"[YoutubeSummaryRequest] 수신")
        print(f"user_id: {user_id}")
        print(f"youtube_url: {youtube_url}")

        try:
            # YouTube URL에서 video ID 추출
            video_id = extract_video_id(youtube_url)
            print(f"video_id: {video_id}")

            transcript = get_transcript_text(video_id)
            if transcript:
                print(transcript)
                print("요약 가능!")
            else:
                print("자막을 불러올 수 없습니다.")
            
            # OpenAI API로 요약 생성 및 스트리밍
            async for content in generate_youtube_summary(transcript):
                # print(content)
                yield youtubesummary_pb2.YoutubeSummaryResponse(content=content, is_final=False)
            
            yield youtubesummary_pb2.YoutubeSummaryResponse(content="", is_final=True)
            
        except Exception as e:
            error_msg = f"YouTube 요약 생성 중 오류: {str(e)}"
            print(error_msg)
            yield youtubesummary_pb2.YoutubeSummaryResponse(content=error_msg, is_final=True)
        finally:
            user_tasks.pop(user_id, None)

async def serve():
    server = grpc.aio.server()
    youtubesummary_pb2_grpc.add_YoutubeSummaryServiceServicer_to_server(YoutubeSummaryService(), server)
    server.add_insecure_port('[::]:50052')
    await server.start()
    print("YouTube Summary gRPC server started on port 50052")
    print("LLM 워커 대기중…")
    print("OpenAI API 키 상태:", "설정됨" if openai.api_key else "설정되지 않음")
    await server.wait_for_termination()
if __name__ == "__main__":
    asyncio.run(serve())