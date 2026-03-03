# Findings

## 2026-03-03
- `https://hdmsurban.com/_next/static/chunks/app/page.js` 中出现 `http://localhost:8025`，说明公网前端仍在调用 localhost。
- `https://hdmsurban.com/ingestion/status` 返回 200，而 `https://hdmsurban.com/api/summary` 返回 404。
- `nginx/hdms-public-802x.conf` 存在 `/ingestion/` `/graph/` 代理，但没有 `/api/` 代理。
- 本地 `http://127.0.0.1:8025/api/health` 与 `http://127.0.0.1:8025/api/summary` 可用。
- OCR 输出目录实际由 `OCR_OUTPUT_DIR` 控制（`.env.external` 为 `data/ocr_output_external`），不是 `data/model_external`。
