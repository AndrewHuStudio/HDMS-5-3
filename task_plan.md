# Task Plan: OCR任务状态持久化

## Goal
为 `data_process/ocr_process` 增加 OCR job 状态持久化，保证服务重启后任务状态不会直接丢失；已完成任务可恢复查询，中断中的任务应明确标记为中断失败。

## Current Phase
Phase 4

## Phases
### Phase 1: 现状确认与持久化方案
- [x] 确认 OCR job 当前内存存储点与读写路径
- [x] 确认重启后恢复语义（完成保留，中途任务失败）
- [x] 记录关键发现到 `findings.md`
- **Status:** complete

### Phase 2: 测试先行
- [x] 编写 job 落盘与恢复失败测试
- [x] 编写中断任务恢复语义测试
- [x] 验证测试先失败
- **Status:** complete

### Phase 3: 最小实现
- [x] 增加文件型 OCR job store
- [x] 接入 submit/update/status/clear 链路
- [x] 保持现有 API 返回结构不变
- **Status:** complete

### Phase 4: 验证与交付
- [x] 跑目标 pytest 用例
- [x] 复核前端现有 OCR 恢复逻辑是否仍兼容
- [x] 汇报变更、验证结果与残余风险
- **Status:** complete

## Key Questions
1. OCR job 应该存到哪里，才不会被 OCR 输出清理误伤？
2. 服务重启后，非终态任务应该恢复成什么状态？
3. 哪些 API 和测试需要保持完全兼容？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 优先做文件型持久化而不是引入新数据库 | 与当前架构最贴近，变更面最小 |
| 重启恢复时仅保留终态；非终态统一标记为中断失败 | 后台线程已丢失，不能伪装继续执行 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
|       | 1       |            |

## Notes
- 目标目录暂定为独立 job store，而不是 `data/ocr_output`
- 需要与现有前端 `OCRUploadPanel` 的轮询恢复逻辑兼容
