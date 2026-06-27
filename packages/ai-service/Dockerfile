# context = repo root（見 docker-compose.yml）
FROM python:3.11-slim

WORKDIR /app

# lightgbm 需要 libgomp
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
  && rm -rf /var/lib/apt/lists/*

COPY packages/ai-service/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY packages/ai-service/ ./

# 建置時訓練模型（合成資料，seed 固定），讓容器啟動即可服務
RUN python train.py

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
