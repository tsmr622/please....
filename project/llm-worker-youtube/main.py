import os, json, time
import openai
import asyncio
import grpc
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.formatters import TextFormatter

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

def get_transcript(video_id: str) -> str:
    """YouTube 자막을 가져와서 텍스트로 변환"""
    try:
        # 한국어 자막 우선, 없으면 영어, 없으면 자동 생성
        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
        
        # 한국어 자막 찾기
        try:
            transcript = transcript_list.find_transcript(['ko'])
        except:
            # 영어 자막 찾기
            try:
                transcript = transcript_list.find_transcript(['en'])
            except:
                # 자동 생성 자막 사용
                transcript = transcript_list.find_generated_transcript(['ko', 'en'])
        
        # 자막을 텍스트로 변환
        formatter = TextFormatter()
        transcript_text = formatter.format_transcript(transcript.fetch())
        
        return transcript_text
        
    except Exception as e:
        print(f"자막 가져오기 실패: {e}")
        raise e

def generate_youtube_summary(transcript: str, video_title: str = "") -> str:
    """OpenAI API를 사용해서 YouTube 자막 요약 생성"""
    if not openai.api_key:
        return "OpenAI API 키가 설정되지 않아 요약을 생성할 수 없습니다."

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

요약 시 다음 사항을 지켜주세요:
1. 핵심 내용을 간결하게 정리
2. 주요 포인트들을 bullet point로 정리
3. 전체적인 맥락과 흐름을 파악할 수 있도록 구성
4. 전문 용어가 있다면 간단히 설명 포함
5. 동영상의 목적이나 의도를 파악하여 요약

요약은 한국어로 작성해주세요.
"""

    response = openai.ChatCompletion.create(
        model="gpt-3.5-turbo",
        messages=[
            {"role": "system", "content": "당신은 YouTube 동영상의 자막을 분석하여 명확하고 유용한 요약을 제공하는 전문가입니다."},
            {"role": "user", "content": prompt}
        ],
        max_tokens=2048,
        temperature=0.7,
        stream=True
    )
    
    for chunk in response:
        delta = chunk["choices"][0]["delta"]
        content = delta.get("content")
        if content:
            yield content

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
            
            # 자막 가져오기
            transcript = get_transcript(video_id)
            print(f"자막 길이: {len(transcript)} 문자")
            
            # OpenAI API로 요약 생성 및 스트리밍
            for content in generate_youtube_summary(transcript):
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