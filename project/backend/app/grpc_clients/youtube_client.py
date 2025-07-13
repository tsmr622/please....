import grpc
import youtubesummary_pb2, youtubesummary_pb2_grpc


class YoutubeSummaryClient:
    def __init__(self, host="llm-worker-youtube", port=50052):
        self.target = f"{host}:{port}"

    async def youtubesummary_stream(self, user_id: str, youtube_url: str):
        # 비동기 gRPC 채널 사용
        async with grpc.aio.insecure_channel(self.target) as channel:
            stub = youtubesummary_pb2_grpc.YoutubeSummaryServiceStub(channel)
            request = youtubesummary_pb2.YoutubeSummaryRequest(
                user_id=user_id,
                youtubeUrl=youtube_url
            )
            # stream 응답을 async generator로 반환
            async for response in stub.YoutubeSummary(request):
                yield response