# 城市高强度片区协同设计管理平台研发及技术验证子任务3：城市高强度片区数字化管控工具

## 课题介绍
子任务 3：数字化管控软件的研发，是在课题一、二、三、四形成的理论与技术基础上，开发出的支撑城市设计知识获取与管控的数字化工具，它与子任务一（智能性能评估软件）、子任务二（智能优化设计软件）集成到人机交互协同设计管理平台中，并最终在项目中验证，以支撑面向高强度片区的城市设计知识问答系统实现多主体、多要素、多流程的辅助空间优化管控。

## 项目目录结构
```
HDMS/
├── frontend/                 # 前端（Next.js + React + Three.js）
│   ├── app/
│   ├── components/
│   ├── features/
│   ├── lib/
│   ├── public/
│   └── package.json
├── backend/
│   ├── qa_assistant/             # 管控问答助手（FastAPI + Python）
│   ├── review_system/            # 管控审查系统（FastAPI + Python）
│   │   ├── core/
│   │   ├── routes/
│   │   ├── services/
│   │   └── README.md
│   └── approval_checklist/       # 管控审批清单（预留）
├── data_process/             # 问答系统数据处理（OCR / 向量化 / KG / Gradio）
├── data/                     # 上传与缓存数据
│   ├── uploads/
│   └── cache/
├── docs/
├── nginx/                   # Nginx 网关配置
├── .env                      # 本地环境变量
├── docker-compose.yml
├── CLAUDE.md
└── README.md
```

## 🎉 最新更新：RAG系统已完成

**日期**: 2026-02-06

HDMS现已集成完整的RAG（检索增强生成）系统，支持：
- ✅ **向量化**: 文档分块 + 嵌入生成（text-embedding-3-large）
- ✅ **知识图谱**: 实体提取 + 关系映射（Neo4j）
- ✅ **多源检索**: 向量搜索 + 图谱查询 + 关键词搜索
- ✅ **智能问答**: 上下文感知 + 来源归属

📚 **快速开始**: [RAG系统快速开始指南](./docs/RAG系统快速开始.md)
📖 **详细文档**: [RAG系统实现完成报告](./docs/RAG系统实现完成报告.md)

---

## 快速启动

### 1. 启动Docker服务
```bash
docker-compose up -d
```

### 2. 启动管控审查系统后端（内部端口 8001）
```bash
# Windows
python -m venv backend\\review_system\.venv
.\backend\\review_system\.venv\Scripts\activate
pip install -r requirements.txt
cd backend\\review_system
python -m uvicorn app:app --reload --port 8001 --app-dir .

# Linux/Mac
python -m venv backend/review_system/.venv
source backend/review_system/.venv/bin/activate
pip install -r requirements.txt
cd backend/review_system
python -m uvicorn app:app --reload --port 8001 --app-dir .
```

### 3. 启动管控问答助手后端（内部端口 8002）
```bash
# Windows
python -m venv backend\\qa_assistant\\.venv
.\\backend\\qa_assistant\\.venv\\Scripts\\activate
pip install -r requirements.txt
cd backend\\qa_assistant
python -m uvicorn app:app --reload --port 8002 --app-dir .

# Linux/Mac
python -m venv backend/qa_assistant/.venv
source backend/qa_assistant/.venv/bin/activate
pip install -r requirements.txt
cd backend/qa_assistant
python -m uvicorn app:app --reload --port 8002 --app-dir .
```

### 4. 启动数据处理服务（内部端口 8004，可选）
```bash
python -m uvicorn data_process.main:app --reload --port 8004 --app-dir .
```

### 5. 启动 Nginx 网关（对外端口 8000）
```bash
nginx -c nginx/hdms.conf
```

### 6. 启动前端
```bash
cd frontend
npm install
npm run dev
```

### 7. 访问服务
- **前端**: http://localhost:3000
- **统一网关**: http://localhost:8000
- **审查系统API文档**: http://localhost:8000/docs
- **审查系统健康检查**: http://localhost:8000/health
- **问答助手接口**: http://localhost:8000/qa/chat
- **问答助手健康检查**: http://localhost:8000/qa/health
