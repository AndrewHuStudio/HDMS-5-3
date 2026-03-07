# Findings & Decisions

## Requirements
- 修复问答系统回归问题，不做无关重构。
- 恢复回复中的图片展示能力。
- 恢复回复中的参考文献/引用展示能力。
- 缩短首字等待时间（用户感知“思考时间过久”）。
- 启动与公网发布相关流程不能被破坏。

## Research Findings
- 用户提供的日志显示单次请求中：
  - 向量检索约 3.5s；
  - rerank 后检索阶段累计约 12.1s；
  - 首 token 时间约 80.3s，总时长约 92.6s；
  - 下游聊天接口请求返回 200，但耗时长。
- 用户截图中最终回复为纯文本结构化内容，未见图片和参考文献区块。
- 前端渲染链路支持图片与引用，且当 `sources` 非空时会渲染引用面板；当前缺失更像后端来源集为空，而非纯前端样式问题。
- 后端 `rag/context_builder.py` 存在硬门控：`pdf_is_available(file_name)==False` 时直接 `continue` 丢弃整条文档来源。
- 该门控会同时造成：
  - `sources` 为空或大幅减少，前端无引用面板；
  - 图片注入失去 `image_urls` 源数据，答案中 `[[IMG:x-y]]` 无法替换为图片；
  - 触发本地 PDF 索引探测开销（首次请求更明显），放大“思考时间长”的体感。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 先定位后端返回契约（字段是否仍含 images/citations） | 能快速区分后端/前端问题边界 |
| 先写失败测试锁定输出契约再修复 | 防止修完再次回归 |
| 增加配置 `QA_REQUIRE_LOCAL_PDF_FOR_SOURCES`（默认关闭） | 默认不再因 PDF 缺失丢弃来源，必要时可开启严格模式 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| 工作区已有未提交修改 | 已与用户确认按现有改动继续 |
| 本地 8002 未启动，无法直接在线复现 SSE | 改为代码路径+测试复现，并记录需用户环境二次验证 |

## Resources
- `backend/qa_assistant/routes/qa.py`
- `backend/qa_assistant/rag/service.py`
- `backend/qa_assistant/rag/context_builder.py`
- `backend/qa_assistant/tests/test_context_builder_pdf_gate.py`
- `backend/qa_assistant/app.py`
- `docs/启动与公网发布事项`

## Visual/Browser Findings
- UI 侧聊天区域显示“思考中...”较久，用户问题后等待明显偏长。
- 对比历史效果，当前回复未渲染图片与参考文献板块，仅显示正文。
