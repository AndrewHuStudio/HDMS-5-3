# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

HDMS（高强度片区数字化管控平台）用于城市设计管控、三维模型解析与指标校核，并逐步扩展为**资料驱动的问答系统 + 知识图谱**平台。

## Architecture

```
Frontend (Next.js 16 + React 19 + Three.js) → port 3000
Backend API (FastAPI + Python)              → port 8000
Data Services (Docker)                      → Milvus / Neo4j / MinIO / Postgres / MongoDB / etcd
```

## Key Directories
- `frontend/` - 主前端（Next.js + Three.js + UI）
- `services/rhino-api/` - 后端 API（FastAPI）
- `data/uploads/` - 上传模型
- `data/cache/` - 缓存
- `docs/` - 文档
- `docker-compose.yml` - 向量库/图数据库等基础服务

## Common Commands

### Frontend
```bash
cd frontend
npm install
npm run dev
npm run build
npm run lint
```

### Backend
```bash
# Setup (PowerShell)
python -m venv services\rhino-api\.venv
.\services\rhino-api\.venv\Scripts\activate
pip install -r requirements.txt

# Run
python -m uvicorn rhino_api.main:app --reload --port 8000 --app-dir services/rhino-api
```

## Backend API Endpoints (current)
- `POST /models/import` - 上传并解析 .3dm
- `POST /height-check/pure-python` - 限高检测（纯 Python）
- `POST /setback-check` - 退线检测
- `POST /sight-corridor/check` - 视线通廊检测
- `POST /sight-corridor/collision` - 视线通廊碰撞检测
- `POST /qa/chat` - 问答接口（OpenAI 兼容）
- `GET /health` - 健康检查

## Frontend QA & Graph
- 问答主面板：`frontend/components/qa-panel.tsx`
  - 通过 `/qa/chat` 请求后端；失败时使用本地简答 fallback。
  - 使用 `react-markdown` + `remark-gfm` 渲染 Markdown（表格/列表/代码块）。
- 知识图谱：`frontend/components/knowledge-graph.tsx`
  - `react-force-graph-2d` 渲染；
  - 支持列表/图谱视图（当前为静态数据 + 选中要素）。
- 同源代理：`frontend/app/qa/chat/route.ts`
  - Next.js 代理转发到后端 `/qa/chat`，避免跨域。

## Environment Variables (root `.env`)
- `APP_ENV`
- `MODEL_STORAGE_PATH`
- `CACHE_STORAGE_PATH`
- `MAX_UPLOAD_MB`
- `CORS_ORIGINS`
- `HDMS_BASE_URL` - OpenAI 兼容 API Base
- `HDMS_API_KEY`
- `HDMS_MODEL`
- `HDMS_VISION_MODEL`

Frontend 可选：
- `HDMS_BACKEND_BASE_URL`（用于 Next 代理到后端）
- `NEXT_PUBLIC_HDMS_API_BASE`（如需直连后端）

## Notes
- 优先通过**新增模块**扩展功能，减少合并冲突；如需替换旧模块请明确说明。
- 目前问答与知识图谱为基础版本，后续接入 OCR、向量检索与图数据库。
