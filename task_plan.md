# Task Plan - 公网数据处理全链路优化

## Goal
修复并优化公网环境中“上传 -> OCR -> 向量化 -> 图谱化”链路，确保前端不会调用 localhost，Nginx 正确转发 data_process 接口，并给出验证步骤。

## Phases
- [x] Phase 1: 现状诊断与证据收集
- [x] Phase 2: 前端 data_process 基址优化
- [x] Phase 3: 公网路由（Cloudflare Tunnel）规则修复
- [x] Phase 4: 回归验证与上线说明

## Risks
- Nginx 配置文件是模板，需部署后 `nginx -t && reload` 才生效。
- 前端静态包需重建发布后，公网 JS 才会更新。
- 当前公网 data_process 临时走 `8125`（绕过 8025 僵死端口），后续需清理 8025 旧进程并恢复统一端口规划。
- 当前 data_process 通过进程级环境变量覆盖 `NEO4J_URI=bolt://localhost:7689`；若重启方式变化，需同步到正式启动脚本/环境文件。

## Errors Encountered
- 运行 `cloudflared tunnel ingress validate --config ...` 报参数位置错误；改为 `cloudflared tunnel --config ... ingress validate` 后通过。
