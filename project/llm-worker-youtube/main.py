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


def seconds_to_mmss(seconds):
    minutes = int(seconds // 60)
    sec = int(seconds % 60)
    return f"{minutes:02d}:{sec:02d}"

def convert_range_to_single_timestamp(text: str) -> str:
    # 패턴: "xxx.xxs ~ yyy.yys:"
    pattern = re.compile(r"(\d+(?:\.\d+)?)s\s*~\s*(\d+(?:\.\d+)?)s:")

    def replacer(match):
        start_sec = float(match.group(1))
        return f"[{seconds_to_mmss(start_sec)}]"

    return pattern.sub(replacer, text)

async def generate_youtube_summary(transcript: str, video_title: str = "") -> str:
    """OpenAI API를 사용해서 YouTube 자막 요약 생성"""
    if not openai.api_key:
        raise Exception("OpenAI API 키가 설정되지 않아 요약을 생성할 수 없습니다.")

    print("OpenAI API로 YouTube 요약 생성 중...")

    # 자막이 너무 길면 잘라내기
    # max_transcript_length = 10000
    # if len(transcript) > max_transcript_length:
    #     transcript = transcript[:max_transcript_length] + "..."

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
- 타임라인은 갯수는 5개 이상 생성하고 중요한 정보 혹은 영상에 큰 이벤트라고 판단된다면 타임라인을 생성하되 영상 전체를 아울러 시간대가 고르게 분포할 수 있도록 생성하세요.
- 반드시 타임라인은 60~100자 이내로 작성하되 맥락과 의도 또는 전달하려는 주제를 추론하여 단순 나열이 아닌 내용 흐름에 따른 구조화된 설명으로 작성하고 한 문장으로 끝내지 말고, 2~3문장으로 자연스럽게 이어지도록 작성하세요.
- 반드시 각 타임라인 설명은 마치 사용자와 영상을 함께 보고 있는 것 처럼 부드럽고 말하듯 자연스럽게 작성하세요.
- 예를 들어: "~을 어떤 방법으로 소개하고 있네요", "~에 대한 이야기가 나오고 있어요", "~에 대해 살펴보고 있어요" 등
- 반드시 딱딱한 설명문, 리포트 스타일 표현은 피하고, 친근하고 회화적인 말투로 표현하세요.
- 반드시 실제 자막에서 등장한 시간 정보만 사용해야 합니다.
- 자막의 시작 시간 또는 종료 시간 범위를 벗어난 타임라인은 절대 포함하지 마세요.
- 타임라인의 시간은 자막의 타임스탬프를 기반으로 하며, 없는 시간대 또는 미래 시간대를 추측하여 임의로 생성하지 마세요.
- 반드시 잘못된 미래 시간(예: 1384423513261, 1265242356765736 등)은 절대 생성하지 마세요.
- 오타/잘못된 시간 표현이 있으면 즉시 실패
- 영어, 특수문자, 이상한 괄호 사용 금지
- 타임라인마다 반드시 줄바꿈하세요.  즉, 1253, 6476 등 숫자가 나올 때마다 줄바꿈(새 줄) 되도록 작성하고 중복되는 내용이 없도록 출력하세요.

4. 표현 스타일 예시:
- ~을 어떤 방식으로 소개하고 있네요, ~에 대해 이어서 설명해주고 있어요.
- ~에 대한 고민이 나오고 있어요. 이와 관련된 내용을 이야기하면서 내용을 구체화하고 있어요.
- ~을 강조하면서 시청자가 놓치지 말아야 할 부분을 짚어주고 있네요.

5. 프롬프트 응답 포맷 예시:
 __COMMENT|||흥미로운 영상을 보고 있구나. 이 영상은 이런 내용이야.
 __SUMMARY|||이 영상은 복잡한 주제를 시청자에게 쉽게 전달하기 위해 구조적으로 구성되어 있습니다. 서두에서는 핵심 문제를 제시하고, 이어지는 본문에서는 이를 해결하기 위한 이론, 사례, 실험 결과 등을 체계적으로 설명합니다. 마지막에는 전체 내용을 요약하며 시청자에게 적용 가능한 인사이트를 제공합니다. 영상 전반에 걸쳐 시청자의 이해를 돕는 그래픽과 예시가 풍부하게 포함되어 있습니다.
 __TIMELINE|||
 478.205s ~ 485.137s: 영상 도입부에서 주제의 중요성과 배경 설명을 하고 있어요.  
 485.137s ~ 754.125s: 핵심 개념 A에 대한 정의와 간단한 시각적 예시를 보여주네요.  
 754.125s ~ 893.756s: 실제 사례를 바탕으로 개념 A 적용 과정 설명을 하고 있어요.
 893.756s ~ 1023.137s: 개념 B 도입과 A와의 비교 분석 중이네요!  
 1023.137s ~ 1153.137s: 종합 요약 및 시청자에게 던지는 사색적 질문을 하고 있습니다.     

※ 각 줄은 `시작초s ~ 종료초s:` 형식을 반드시 지키고, 뒤에는 자연스러운 말투로 설명을 작성하세요.
※ 절대로 `[mm:ss]`, `[123.45]`, `1384423513261`, `12:00 PM` 같은 시간 표현을 사용하지 마세요.
※ 이 예시와 정확히 같은 형식을 따라야 후속 처리에 오류가 발생하지 않습니다.
    """.format(video_title=video_title, transcript=transcript)

    response = openai.ChatCompletion.create(
        model="gpt-3.5-turbo",
        messages=[
            {"role": "system", "content": "당신은 YouTube 동영상의 자막을 분석하여 명확하고 유용한 요약을 제공하는 전문가입니다."},
            {"role": "user", "content": prompt}
        ],
        max_tokens=4096,
        temperature=0.7,
        stream=False
    )

    content = response["choices"][0]["message"]["content"]
    content = convert_range_to_single_timestamp(content)

    yield content
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