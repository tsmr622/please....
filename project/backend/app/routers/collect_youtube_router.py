from fastapi import APIRouter, Request, Header, HTTPException
from pydantic import BaseModel
import json, os, jwt

from ..grpc_clients.youtube_client import YoutubeSummaryClient
from ..websocket_manager import websocket_manager

collect_youtube_router = APIRouter()
youtube_client = YoutubeSummaryClient()
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")

class YoutubeUrlReq(BaseModel):
    youtube_url: str

@collect_youtube_router.post("/collect/youtube")
async def collect_youtube(req: YoutubeUrlReq,
                         request: Request,
                         authorization: str = Header(None)):
    # JWT 추출 및 decode
    if not authorization or not authorization.startswith("Bearer "):
        print("401 Unauthorized: Authorization header missing or invalid")
        raise HTTPException(status_code=401, detail="Authorization header missing or invalid")
    token = authorization.split(" ")[1]
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
        user_id = payload.get("user_id")
        if not user_id:
            print("401 Unauthorized: user_id not found in token")
            raise HTTPException(status_code=401, detail="user_id not found in token")
    except jwt.ExpiredSignatureError:
        print("401 Unauthorized: Token expired")
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        print("401 Unauthorized: Invalid token")
        raise HTTPException(status_code=401, detail="Invalid token")

    print(f"[COLLECT YOUTUBE] url={req.youtube_url}", flush=True)

    # trigger_type 추출
    body = await request.json()
    trigger_type = body.get("trigger_type", "unknown")
    print(f"[COLLECT] trigger_type={trigger_type} url={req.youtube_url}", flush=True)

    # YouTube URL을 gRPC로 전송
    async for chunk in youtube_client.youtubesummary_stream(user_id, req.youtube_url):
        print(chunk, flush=True)
        await websocket_manager.send_to_user(user_id, {
            "content": chunk.content,
            "is_final": chunk.is_final
        })

    return {"status": "ok"}