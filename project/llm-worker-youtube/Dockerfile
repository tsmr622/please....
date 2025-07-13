FROM python:3.10-slim
WORKDIR /app

# 필요한 패키지 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# proto 파일 복사 및 컴파일
COPY protos/ ./protos/
RUN python -m grpc_tools.protoc -I./protos --python_out=. --grpc_python_out=. ./protos/youtubesummary.proto

# 메인 코드 복사
COPY main.py .

EXPOSE 50052

CMD ["python", "-u", "main.py"]
