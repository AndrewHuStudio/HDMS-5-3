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
├── services/
│   └── rhino-api/            # 后端（FastAPI + Python）
│       ├── rhino_api/
│       ├── README.md
│       └── .env.example
├── data/                     # 上传与缓存数据
│   ├── uploads/
│   └── cache/
├── docs/
├── packages/
├── scripts/
├── .env                      # 本地环境变量
├── .env.example              # 环境变量模板
├── docker-compose.yml
├── CLAUDE.md
└── README.md
```

## 快速启动

### 前端
```
cd frontend
npm install
npm run dev
```

### 后端
```
python -m venv services\rhino-api\.venv
.\services\rhino-api\.venv\Scripts\activate
pip install -r services\rhino-api\requirements.txt
python -m uvicorn rhino_api.main:app --reload --port 8000 --app-dir services/rhino-api
```
