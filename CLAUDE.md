# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

HDMS（高强度片区数字化管控平台）用于城市设计管控、三维模型解析与指标校核，并逐步扩展为**资料驱动的问答系统 + 知识图谱**平台。

## Architecture

```
Frontend (Next.js 16 + React 19 + Three.js) → port 3000
Nginx Gateway (统一代理，可选)               → port 8001
QA Assistant API (FastAPI + Python)         → port 8002  ← 直连 Milvus/Neo4j/MongoDB，完成 RAG 检索+生成
Review System API (FastAPI + Python)        → port 8003  ← 管控审查功能（限高/退线/视线通廊/消防登高面/空中连廊）
Approval Checklist API (FastAPI, 预留)      → port 8004
Data Process API (FastAPI + Python)         → port 8005  ← 仅负责数据处理（OCR/分块/向量入库/KG构建）
Data Services (Docker)                      → Milvus / Neo4j / MinIO / Postgres / MongoDB / etcd
```

**数据流**：
```
data_process(8004): PDF → OCR → 分块 → 向量入库(Milvus) → 知识图谱构建(Neo4j)
qa_assistant(8002): 用户提问 → 多源检索(Milvus+Neo4j+MongoDB) → 拼接上下文 → 调用 LLM → 流式返回
```

## Key Directories
- `frontend/` - 主前端（Next.js + Three.js + UI）
- `backend/qa_assistant/` - 管控问答助手（FastAPI + RAG 检索 + LLM 生成）
  - `core/database/` - 数据库客户端（Milvus / MongoDB / Neo4j）
  - `rag/` - RAG 管线（retriever / service / embedder / graph_query）
  - `schemas/` - Pydantic 模型
  - `routes/` - API 路由
- `backend/review_system/` - 管控审查系统（FastAPI）
- `backend/approval_checklist/` - 管控审批清单（预留）
- `data_process/` - 数据处理服务（OCR / 向量化 / KG 构建 / Gradio）
  - `vector_process/ingestion/` - 文档分块与向量入库
  - `KG_process/` - 知识图谱构建
  - `ocr_process/` - OCR 处理
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
python -m venv backend\\review_system\.venv
.\backend\\review_system\.venv\Scripts\activate
pip install -r requirements.txt

# Run
python -m uvicorn app:app --reload --port 8003 --app-dir backend/review_system
```

### QA Assistant
```bash
# Setup (PowerShell)
python -m venv backend\\qa_assistant\\.venv
.\\backend\\qa_assistant\\.venv\\Scripts\\activate
pip install -r requirements.txt

# Run
python -m uvicorn app:app --reload --port 8002 --app-dir backend/qa_assistant
```

### Nginx Gateway
```bash
nginx -c nginx/hdms.conf
```

## 管控审查系统 - 新功能开发指南

> 当你需要在管控审查系统中添加新的检测功能时，请严格遵循以下模块化架构。
> 每个功能 = 一个独立模块，前后端各自自包含。

### 标准模块结构

以 `fire-ladder`（消防登高面检测）为参考模板：

```
前端模块: frontend/features/{feature-name}/
├── types.ts        # 类型定义（请求参数、响应结构、枚举）
├── api.ts          # API 调用封装（使用 API_BASE + normalizeApiBase）
├── store.ts        # Zustand 状态管理（results, warnings, showLabels, reset）
├── panel.tsx       # UI 面板组件（检测按钮、结果展示、可视化开关）
├── scene.tsx       # Three.js 3D 场景渲染层（高亮、标签）
├── registry.ts     # 注册到 toolRegistry（id, name, icon, Panel, SceneLayer, reset）
└── utils.ts        # 工具函数（可选）

后端模块: backend/review_system/
├── routes/{feature}.py     # FastAPI 路由（Request 模型 + 端点）
└── services/{feature}.py   # 检测业务逻辑（纯 Python + rhino3dm）
```

### 开发步骤（按顺序）

**第 1 步：后端 - 创建检测服务**
1. 在 `backend/review_system/services/` 下创建 `{feature}.py`
2. 实现核心检测函数，参考 `services/fire_ladder.py` 的模式
3. 使用 `rhino3dm` 读取 3dm 模型，按图层提取对象进行检测
4. 返回格式统一：`{ status, method, summary, results, warnings, parameters }`

**第 2 步：后端 - 创建 API 路由**
1. 在 `backend/review_system/routes/` 下创建 `{feature}.py`
2. 定义 Pydantic Request 模型（继承 BaseModel，加 `ConfigDict(protected_namespaces=())`)
3. 创建 POST 端点：`@router.post("/{feature}-check")`
4. 在 `app.py` 中导入并注册：`app.include_router({feature}.router)`

**第 3 步：前端 - 创建 types.ts**
1. 在 `frontend/features/{feature-name}/` 下创建 `types.ts`
2. 定义与后端响应对应的 TypeScript 接口

**第 4 步：前端 - 创建 api.ts**
1. 封装 API 调用函数，使用 `API_BASE` + `normalizeApiBase`
2. 参考 `features/fire-ladder/api.ts`

**第 5 步：前端 - 创建 store.ts**
1. 使用 Zustand 创建状态管理
2. 包含：results, warnings, showLabels, setter 方法, reset 方法
3. 类型从 `./types` 导入（不要从 `@/lib/` 导入）

**第 6 步：前端 - 创建 panel.tsx**
1. 自包含的面板组件，直接使用 store 和 api
2. 包含：模型上传、开始检测、结果展示、可视化开关
3. 参考 `features/fire-ladder/panel.tsx`

**第 7 步：前端 - 创建 scene.tsx**
1. Three.js 场景渲染层，高亮检测结果
2. 使用 `@react-three/drei` 的 Html 组件显示标签
3. 参考 `features/fire-ladder/scene.tsx`

**第 8 步：前端 - 创建 registry.ts**
1. 将功能注册到 `toolRegistry`
2. 指定 id, name, description, category, icon, Panel, SceneLayer, reset
3. 图标从 `lucide-react` 导入

**第 9 步：前端 - 注册到 index.ts**
1. 在 `frontend/features/index.ts` 中添加 `import "./{feature-name}/registry";`

### 现有功能模块一览

| 功能 | 前端目录 | 后端路由 | 后端服务 | API 端点 |
|------|---------|---------|---------|---------|
| 限高检测 | `features/height-check/` | `routes/height_check.py` | `services/height_limit_pure.py` | `POST /height-check/pure-python` |
| 退线检测 | `features/setback-check/` | `routes/setback_check.py` | `services/setback_check.py` | `POST /setback-check` |
| 视线通廊 | `features/sight-corridor/` | `routes/sight_corridor.py` | `services/sight_corridor_check.py` | `POST /sight-corridor/check` |
| 消防登高面 | `features/fire-ladder/` | `routes/fire_ladder.py` | `services/fire_ladder.py` | `POST /fire-ladder-check` |
| 空中连廊 | `features/sky-bridge/` | `routes/sky_bridge.py` | `services/sky_bridge.py` | `POST /sky-bridge-check` |

### 关键规范

- **前端命名**：目录用 kebab-case（如 `fire-ladder`），文件用固定名称
- **后端命名**：文件用 snake_case（如 `fire_ladder.py`）
- **类型定义**：放在模块内的 `types.ts`，不要放在 `@/lib/` 下
- **状态管理**：store 从 `./types` 导入类型，不要跨模块引用
- **API 调用**：统一使用 `API_BASE` + `normalizeApiBase`，定义在 `@/lib/api-base`
- **图标**：从 `lucide-react` 导入，先确认图标存在（v0.454.0）

## Review System API Endpoints (current)
- `POST /models/import` - 上传并解析 .3dm
- `POST /height-check/pure-python` - 限高检测（纯 Python）
- `POST /setback-check` - 退线检测
- `POST /sight-corridor/check` - 视线通廊检测
- `POST /sight-corridor/collision` - 视线通廊碰撞检测
- `POST /fire-ladder-check` - 消防登高面检测
- `POST /sky-bridge-check` - 空中连廊检测
- `GET /health` - 健康检查

## QA Assistant API Endpoints
- `POST /qa/chat` - RAG 问答（非流式）：多源检索 → LLM 生成
- `POST /qa/chat/stream` - RAG 问答（SSE 流式）：sources → thinking → answer → done
- `GET /rag/sources/{chunk_id}` - 获取来源 chunk 详情（用于引用预览）
- `GET /health` - 健康检查
- `GET /health/db` - 数据库连接状态与统计

## Data Process API Endpoints
- `POST /ingestion/document` - 入库单个文档
- `POST /ingestion/batch` - 批量入库
- `GET /ingestion/status` - 入库状态
- `POST /graph/build` - 构建单文档知识图谱
- `POST /graph/build/batch` - 批量构建知识图谱
- `POST /graph/query` - 执行 Cypher 查询
- `GET /graph/statistics` - 图谱统计
- `GET /health` - 健康检查
- `GET /health/db` - 数据库连接状态

## Frontend QA & Graph
- 问答主面板：`frontend/components/qa-panel.tsx`
  - 通过 `/qa/chat` 请求后端；失败时使用本地简答 fallback。
  - 使用 `react-markdown` + `remark-gfm` 渲染 Markdown（表格/列表/代码块）。
- 流式问答：`frontend/features/qa/qa-view.tsx`
  - 通过 `/qa/chat/stream` 获取 SSE 流式响应。
  - 支持 thinking（推理过程）和 sources（来源引用）展示。
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
- `EMBEDDING_MODEL` - 向量嵌入模型（默认 text-embedding-3-large）
- `MILVUS_HOST` / `MILVUS_PORT` - Milvus 连接
- `MONGODB_URI` / `MONGODB_DATABASE` - MongoDB 连接
- `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` - Neo4j 连接

Frontend 可选：
- `HDMS_QA_BASE_URL`（用于 Next 代理到问答服务）
- `NEXT_PUBLIC_HDMS_API_BASE`（前端直连审查系统后端）
- `NEXT_PUBLIC_HDMS_QA_BASE`（前端直连问答助手后端）

## Notes
- 优先通过**新增模块**扩展功能，减少合并冲突；如需替换旧模块请明确说明。
- qa_assistant 直连三个数据库（Milvus/Neo4j/MongoDB），启动时自动初始化连接。
- data_process 仅负责数据入库和知识图谱构建，不参与问答流程。
