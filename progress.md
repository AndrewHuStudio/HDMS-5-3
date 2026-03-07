# Progress Log

## Session: 2026-03-07

### Phase 1: 需求确认与证据收集
- **Status:** complete
- **Started:** 2026-03-07
- Actions taken:
  - 读取并应用会话要求的技能流程（using-superpowers、systematic-debugging、TDD、planning-with-files、verification-before-completion）。
  - 与用户确认任务意图与执行边界。
  - 发现已有未提交代码改动并暂停确认，用户选择在现状上继续。
  - 建立计划与发现文档，记录症状与初步证据。
  - 梳理前后端 SSE/渲染链路，确认前端具备图片与引用渲染能力。
- Files created/modified:
  - `task_plan.md` (created)
  - `findings.md` (created)
  - `progress.md` (created)

### Phase 2: 根因定位与测试设计（TDD）
- **Status:** complete
- Actions taken:
  - 新增失败测试 `test_keep_document_sources_when_local_pdf_missing_by_default`，验证“本地 PDF 缺失不应导致来源清空”。
  - 初次运行测试失败，确认根因位于 `context_builder` 的 PDF 硬门控逻辑。
- Files created/modified:
  - `backend/qa_assistant/tests/test_context_builder_pdf_gate.py` (created)

### Phase 3: 最小实现修复
- **Status:** complete
- Actions taken:
  - 在 `core/config.py` 新增配置 `QA_REQUIRE_LOCAL_PDF_FOR_SOURCES`，默认关闭严格 PDF 门控。
  - 在 `rag/context_builder.py` 将“无本地 PDF 直接丢弃来源”改为“仅在严格模式下启用”。
  - 新增两条回归测试：默认模式不触发 PDF 探测、严格模式仍可过滤。
- Files created/modified:
  - `backend/qa_assistant/core/config.py` (modified)
  - `backend/qa_assistant/rag/context_builder.py` (modified)
  - `backend/qa_assistant/tests/test_context_builder_pdf_gate.py` (modified)

### Phase 4: 验证与回归检查
- **Status:** in_progress
- Actions taken:
  - 运行针对性测试：`python -m pytest backend/qa_assistant/tests/test_context_builder_pdf_gate.py -q`，3/3 通过。
  - 运行目录测试：`python -m pytest backend/qa_assistant/tests -q`，3/3 通过。
  - 尝试直连 `http://localhost:8002/qa/chat/stream` 抓 SSE，当前环境端口未启动，需在用户运行环境二次验证真实链路。
- Files created/modified:
  - `progress.md` (updated)

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| keep_document_sources_when_local_pdf_missing_by_default | `pytest test_context_builder_pdf_gate.py` | 默认模式保留文档来源 | 通过 | ✓ |
| default_mode_skips_pdf_availability_probe | `pytest test_context_builder_pdf_gate.py` | 默认模式不调用 PDF 探测 | 通过 | ✓ |
| strict_mode_can_filter_missing_local_pdf | `pytest test_context_builder_pdf_gate.py` | 严格模式下可过滤缺失 PDF 来源 | 通过 | ✓ |
| qa_assistant tests | `python -m pytest backend/qa_assistant/tests -q` | 全部通过 | 3 passed | ✓ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-03-07 | 检测到工作区已有未提交改动 | 1 | 与用户确认后按现状继续 |
| 2026-03-07 | 本地 8002 端口无服务，无法直接抓 SSE | 1 | 改为测试验证 + 待用户运行环境联调 |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Phase 4（验证中） |
| Where am I going? | 完成运行态联调验证后进入交付说明 |
| What's the goal? | 修复慢响应及图片/参考文献缺失回归问题 |
| What have I learned? | 根因为 PDF 硬门控导致来源丢失与额外探测开销 |
| What have I done? | 完成失败测试、最小修复、自动化回归验证 |
