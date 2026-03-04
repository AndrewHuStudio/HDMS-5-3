# Findings

## 2026-03-03
- `https://hdmsurban.com/_next/static/chunks/app/page.js` 中出现 `http://localhost:8025`，说明公网前端仍在调用 localhost。
- 同一构建产物还包含 `http://localhost:8023`、`http://localhost:8022`，并且源码片段显示这些值来自 `NEXT_PUBLIC_*` 注入（不是运行时计算出来的）。
- 曾观测到 `https://hdmsurban.com/api/summary` 异常；本轮复测该地址返回 200（同源 `/api` 目前可用）。
- `nginx/hdms-public-802x.conf` 当前已包含 `/api/`、`/ingestion/`、`/graph/` 代理规则。
- 本地 `http://127.0.0.1:8025/api/health` 与 `http://127.0.0.1:8025/api/summary` 可用。
- OCR 输出目录实际由 `OCR_OUTPUT_DIR` 控制（`.env.external` 为 `data/ocr_output_external`），不是 `data/model_external`。
- 从外网探测 `https://hdmsurban.com:8022/health`、`:8023/health`、`:8025/health` 均超时，说明浏览器若被引导到这些端口会直接 `Failed to fetch`。
- `https://hdmsurban.com/api/summary` 当前可返回 200，说明同源 `/api/*` 路由本身可用，问题核心是前端请求了错误基址（localhost/802x 端口）。
- 实际运行中的 `%USERPROFILE%\\.cloudflared\\config.yml` 缺少 `/qa/*`、`/rag/*`、`/models/*` 等规则，且曾把 `/api/approval/*` 路径导向错误服务。
- 实机 `data_process` 在端口 `8025` 出现“可监听但无 HTTP 响应”的僵死状态；切到 `8125` 后 `/api/health`、`/api/summary` 恢复正常。
- `ingestion/status` 与 `graph/statistics` 原先会触发阻塞式 DB 初始化导致超时；已改为后台初始化，避免请求拖死。
- 外部 Milvus 初始连接失败，通过重启 `hdms-external-milvus` 恢复；Neo4j `17689` 握手异常，当前 data_process 运行时使用 `NEO4J_URI=bolt://localhost:7689`。
- 修复后公网回归结果：`/api/summary` 200、`/api/approval/health` 200、`/approval/health` 200、`/models/import`(GET) 405、`/setback-rate-check`(GET) 405、`/qa/chat/stream`(POST 空体) 422，均表明路由已命中目标服务。
- 修复后公网 `https://hdmsurban.com/api/health` 200、`/api/summary` 200、`/ingestion/status` 200、`/graph/statistics` 200（均无超时）。
- 抓取 `https://hdmsurban.com/` 当前所有 JS chunk，已不再包含 `http://localhost:8022/8023/8025` 字符串。
