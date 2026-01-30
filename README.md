# HDMS

## 项目定位
- 目标场景：Web 端对片区进行一键检测。
- 模型格式：`.3dm`。
- 验证逻辑：GH（Grasshopper）逻辑接入检测流程。
- 计算依赖：后端可运行 Rhino.Compute 服务。

## 技术栈概览（基于仓库观察）
- 前端：`apps/frontend`（Next.js 16 + React 19 + three.js）。
- 旧前端参考：`my-app`（Next.js + three.js）。
- 后端：`services/rhino-api`（FastAPI），用于解析 `.3dm` 并提供模型相关 API。

## 推荐落地路径（高层）
1) 前端：提供“一键检测”按钮，触发检测 API。
2) 后端：
   - 接收 `.3dm` 并解析图层结构。
   - 可选转换为前端可读格式（glb 等）。
   - 通过 Rhino.Compute/Hops 调用 GH 定义，返回检测结果。
3) 前端：根据检测结果（违规对象 ID、几何、数值）进行高亮与报告展示。

## 目录指引
- `apps/frontend/`: 新前端项目（V0 安装产物）。
- `my-app/`: 旧前端参考。
- `services/rhino-api/`: 3dm 解析与模型服务（FastAPI）。
- `services/rhino-api/rhino_api/`: 后端 Python 包入口。
- `docs/DEV.md`: 现有架构与开发说明。
- `third_party/compute.rhino3d/`: Rhino.Compute 源码。

## 根目录启动
### 前端（新：apps/frontend）
1) 安装依赖  
   `npm install --prefix apps/frontend`
2) 启动开发服务  
   `npm run dev --prefix apps/frontend`

提示：为避免 Next.js 默认 Turbopack 与 `webpack` 配置冲突，`apps/frontend` 已使用 `next dev --webpack`。



### 后端（FastAPI）
1) 创建虚拟环境  
   `python -m venv services\rhino-api\.venv`
2) 激活虚拟环境（PowerShell）  
   `.\services\rhino-api\.venv\Scripts\activate`
3) 安装依赖  
   `pip install -r services\rhino-api\requirements.txt`
4) 启动服务  
   `python -m uvicorn rhino_api.main:app --reload --port 8000 --app-dir services/rhino-api`

### Rhino.Compute（手动启动）
1) 启动 Rhino.Compute 服务（需本机已安装 Rhino 8 for Windows）  
   `dotnet run --project third_party/compute.rhino3d/src/rhino.compute/rhino.compute.csproj`
2) 后端默认会连接 `http://localhost:6500`（可用 `RHINO_COMPUTE_URL` 覆盖）

Claude --dangerously-skip-permissions
请先和我确认意图，确保你理解我的需求，然后再找出错误代码的位置，并修复它