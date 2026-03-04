# Progress Log

- 2026-03-03: 完成外部栈容器检查与 OCR 提交实测（本机成功写入 `data/ocr_output_external`）。
- 2026-03-03: 确认公网 data_process 路由缺失 `/api/`，且前端构建产物含 localhost:8025。
- 2026-03-03: 开始实施前端与 Nginx 优化修复。
- 2026-03-03: 复核公网 JS 构建产物，确认 `NEXT_PUBLIC_*` 被编译为 `http://localhost:8022/8023/8025`，导致外网浏览器请求错误端口并 `Failed to fetch`。
- 2026-03-03: 复测 `https://hdmsurban.com/api/summary` 返回 200，判定同源 `/api` 可用，当前阻塞点在前端基址注入错误/未重建发布。
- 2026-03-03: 已修复 `frontend/lib/api-base.ts` 与 `frontend/features/data-upload/api.ts`，公网访问将自动回退同源，不再误连 localhost。
- 2026-03-03: 已修复并替换 Cloudflare Tunnel 运行配置 `%USERPROFILE%\\.cloudflared\\config.yml`，补齐 `/qa` `/rag` `/models` 等路由并重启 cloudflared。
- 2026-03-03: 已完成前端重新构建并重启 8021 服务；公网 JS chunk 检查通过（不含 localhost:8022/8023/8025）。
- 2026-03-03: 公网烟测通过：`/api/summary`、`/api/approval/health`、`/approval/health` 均 200，关键功能路径可达。
- 2026-03-03: 发现 `8025` 端口上的 data_process 处于“监听但无响应”状态，临时切换 Cloudflare data 路由到 `localhost:8125` 并启动新实例。
- 2026-03-03: 修复 `data_process` 中 ingestion/graph 的阻塞式 DB 初始化逻辑，改为后台初始化+快速失败，避免请求超时拖死 API。
- 2026-03-03: 重启 `hdms-external-milvus` 后 Milvus 连接恢复；data_process 进程使用 `NEO4J_URI=bolt://localhost:7689` 运行，数据库初始化成功。
- 2026-03-03: 回归确认：公网 `/api/health`、`/api/summary`、`/ingestion/status`、`/graph/statistics` 均返回 200，无超时。
