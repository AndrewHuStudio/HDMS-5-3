# Task Plan - 公网数据处理全链路优化

## Goal
修复并优化公网环境中“上传 -> OCR -> 向量化 -> 图谱化”链路，确保前端不会调用 localhost，Nginx 正确转发 data_process 接口，并给出验证步骤。

## Phases
- [x] Phase 1: 现状诊断与证据收集
- [ ] Phase 2: 前端 data_process 基址优化
- [ ] Phase 3: Nginx 路由与超时优化
- [ ] Phase 4: 回归验证与上线说明

## Risks
- Nginx 配置文件是模板，需部署后 `nginx -t && reload` 才生效。
- 前端静态包需重建发布后，公网 JS 才会更新。

## Errors Encountered
- 暂无
