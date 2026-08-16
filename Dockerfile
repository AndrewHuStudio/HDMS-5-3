FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/approval_checklist/requirements.txt /tmp/approval-requirements.txt
RUN pip install --no-cache-dir -r /tmp/approval-requirements.txt

COPY backend ./backend
COPY data_process ./data_process

RUN mkdir -p /app/data/uploads /app/data/cache /app/data/ocr

ENV PYTHONPATH=/app
