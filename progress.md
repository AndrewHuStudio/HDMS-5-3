# Progress Log

## Session: 2026-04-19 QA前端输出流程跑通

### Phase 1: 现状确认与根因调查
- **Status:** complete
- Actions taken:
  - 读取并应用 `using-superpowers`、`systematic-debugging`、`planning-with-files`、`verification-before-completion`。
  - 检查 `frontend/features/qa/api.ts`、`frontend/app/qa/chat/stream/route.ts`、`scripts/start-frontend.ps1`。
  - 核对本机进程与端口，确认前端在 `8021`，QA 后端实际在 `8032`，而 external 模式默认指向了不存在的 `8022`。
- Files created/modified:
  - `task_plan.md` (updated)
  - `findings.md` (updated)
  - `progress.md` (updated)

### Phase 2: 真实复现
- **Status:** complete
- Actions taken:
  - 直接请求 `http://localhost:8032/qa/chat/stream`，确认 QA 后端可返回 SSE。
  - 直接请求 `http://localhost:8021/qa/chat/stream`，定位到前端代理链路因错误上游配置表现异常。
  - 用 OpenAPI/health 检查排除 8023、8024、8125 为 QA 服务的可能。
- Files created/modified:
  - `findings.md` (updated)

### Phase 3: 最小修复
- **Status:** complete
- Actions taken:
  - 修改 `scripts/start-frontend.ps1`，将 external 模式默认 `HDMS_QA_BASE_URL` 从 `http://localhost:8022` 改为 `http://localhost:8032`。
  - 重启前端开发服务到 `8021`。
- Files created/modified:
  - `scripts/start-frontend.ps1` (updated)

### Phase 4: 验证与交付
- **Status:** complete
- Actions taken:
  - 验证 `http://localhost:8021/assistant` 可访问。
  - 使用 Node 读取 `http://localhost:8021/qa/chat/stream` 实际收到 `status`、`sources`、`retrieval_stats`、`thinking`、`answer` 等 SSE 事件。
  - 确认前端 `/qa/chat/stream` 已与真实 QA 后端 `8032` 打通。
- Files created/modified:
  - `task_plan.md` (updated)
  - `progress.md` (updated)

## Session: 2026-04-19 QA流式Markdown稳定性修复

### Phase 1: 现状确认与根因对齐
- **Status:** complete
- Actions taken:
  - 读取并应用 `using-superpowers`、`brainstorming`、`systematic-debugging`、`test-driven-development`、`planning-with-files`、`verification-before-completion`。
  - 检查 `streaming-markdown-stability.ts`、`qa-markdown-renderer.tsx`、`qa-view.tsx`、`phase-matrix.ts`。
  - 对照用户提供分析，确认主要根因是 tail 切分粗糙、risky 误报、pending 渲染能力不足和流式阶段结构性重写。
- Files created/modified:
  - `task_plan.md` (updated)
  - `findings.md` (updated)
  - `progress.md` (updated)

### Phase 2: 测试先行
- **Status:** complete
- Actions taken:
  - 扩展 `frontend/scripts/qa-streaming-stable-prefix-regression.tsx`，覆盖完整段落、完整表格、不完整表格、不完整列表、未闭合公式和纯语法碎片。
  - 新增 `frontend/scripts/qa-streaming-normalization-regression.ts`，锁定 `block-parser` 不得进入 `streaming` 阶段。
  - 使用 `jiti` 执行回归脚本，确认旧实现先在不完整表格与 math tail 场景失败。
- Files created/modified:
  - `frontend/scripts/qa-streaming-stable-prefix-regression.tsx` (updated)
  - `frontend/scripts/qa-streaming-normalization-regression.ts` (created)

### Phase 3: 最小实现
- **Status:** complete
- Actions taken:
  - 重写 `frontend/features/qa/render/streaming-markdown-stability.ts`，实现 block-aware stable/tail 切分、未闭合 inline markup 判定、pending 三态渲染决策，以及未闭合公式回收到 tail。
  - 更新 `frontend/components/qa-new/qa-markdown-renderer.tsx`，移除整段 math fallback 纯文本降级，改为稳定前缀 markdown 渲染 + pending 三态显示。
  - 更新 `frontend/features/qa/qa-view.tsx`，将 answer token flush 从 `setTimeout(48ms)` 改为 `requestAnimationFrame`。
  - 更新 `frontend/lib/normalize-rules/phase-matrix.ts`，将 `block-parser` 从 `streaming` 阶段移除。
- Files created/modified:
  - `frontend/features/qa/render/streaming-markdown-stability.ts` (rewritten)
  - `frontend/components/qa-new/qa-markdown-renderer.tsx` (updated)
  - `frontend/features/qa/qa-view.tsx` (updated)
  - `frontend/lib/normalize-rules/phase-matrix.ts` (updated)

### Phase 4: 验证与交付
- **Status:** complete
- Actions taken:
  - 运行 `frontend\\node_modules\\.bin\\jiti frontend/scripts/qa-streaming-stable-prefix-regression.tsx`，通过。
  - 运行 `frontend\\node_modules\\.bin\\jiti frontend/scripts/qa-streaming-normalization-regression.ts`，通过。
  - 运行 `node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json`，通过。
  - 运行 `npm run lint`，结果为 0 error / 110 warning，均为仓库现存 warning，未引入新的 lint error。
- Files created/modified:
  - `task_plan.md` (updated)
  - `progress.md` (updated)

## Session: 2026-04-09 OCR任务状态持久化

### Phase 1: 现状确认与方案收敛
- **Status:** complete
- Actions taken:
  - 读取并应用 `using-superpowers`、`brainstorming`、`test-driven-development`、`planning-with-files`。
  - 确认 OCR job 当前是内存 `_jobs`，状态查询与摘要来源不一致。
  - 确认实现方向为“文件持久化 + 重启后终态恢复 / 非终态中断失败”。
- Files created/modified:
  - `task_plan.md` (updated)
  - `findings.md` (updated)
  - `progress.md` (updated)

### Phase 2: 测试先行
- **Status:** complete
- Actions taken:
  - 新增 `data_process/tests/test_ocr_job_persistence.py`。
  - 先验证“创建即落盘 / 已完成任务可恢复 / 非终态任务重启后中断失败”三项行为失败。
- Files created/modified:
  - `data_process/tests/test_ocr_job_persistence.py` (created)

### Phase 3: 最小实现
- **Status:** complete
- Actions taken:
  - 在 `data_process/ocr_process/core.py` 中增加文件型 OCR job store。
  - 将持久化接入 submit、update、status、clear 四个核心链路。
  - 保持 OCR API 返回结构不变。
- Files created/modified:
  - `data_process/ocr_process/core.py` (updated)

### Phase 4: 验证与交付
- **Status:** complete
- Actions taken:
  - 运行 OCR 相关 pytest 集合，验证 8 个用例通过。
  - 复跑前端 3 个数据上传相关 node 测试，确认与 OCR 状态恢复逻辑兼容。
- Files created/modified:
  - `progress.md` (updated)

## Session: 2026-04-27 QA最终答案层级跳变修复

### Phase 1: 真实根因收敛
- **Status:** complete
- Actions taken:
  - 确认真实在线链路为 `8021 -> 8032`，聚焦 `E:\MyPrograms\HDMS`。
  - 对比 `answer_question_stream()` 的 streamed answer 与 `answer_replaced` 路径，确认跳变发生在最终替换阶段。
  - 函数级复现发现 `backend/qa_assistant/rag/postprocess/citations.py` 的全局空格压缩会破坏 Markdown 列表前导缩进。
  - 确认 `_should_emit_answer_replacement()` 与前端 `shouldAcceptAnswerReplacement()` 都缺少“嵌套列表深度丢失”的检测。
- Files created/modified:
  - `findings.md` (updated)
  - `progress.md` (updated)

### Phase 2: 测试先行
- **Status:** complete
- Actions taken:
  - 扩展 `backend/qa_assistant/tests/test_answer_replacement_shape_guard.py`，新增“嵌套有序列表被压平成顶级列表”失败用例。
  - 新增 `backend/qa_assistant/tests/test_citation_normalization_preserves_list_indent.py`，锁定“引用归一化不得破坏列表缩进”失败用例。
  - 运行 pytest，确认两条新用例均先失败。
- Files created/modified:
  - `backend/qa_assistant/tests/test_answer_replacement_shape_guard.py` (updated)
  - `backend/qa_assistant/tests/test_citation_normalization_preserves_list_indent.py` (created)

### Phase 3: 最小实现
- **Status:** complete
- Actions taken:
  - 修改 `backend/qa_assistant/rag/postprocess/citations.py`，将全局空格压缩替换为“保留 leading indent 的行内空格压缩”。
  - 修改 `backend/qa_assistant/rag/service.py`，为 answer replacement guard 增加 `nested_ordered_list_lines` / `nested_bullet_list_lines` 检测。
  - 同步修改 `frontend/features/qa/qa-view.tsx` 本地守卫，防止前端接受同类嵌套层级退化替换。
  - 更新 `frontend/scripts/qa-answer-replacement-list-shape-guard-regression.ts`，使其覆盖真实的“二级编号被压平成一级编号”场景。
- Files created/modified:
  - `backend/qa_assistant/rag/postprocess/citations.py` (updated)
  - `backend/qa_assistant/rag/service.py` (updated)
  - `frontend/features/qa/qa-view.tsx` (updated)
  - `frontend/scripts/qa-answer-replacement-list-shape-guard-regression.ts` (updated)

### Phase 4: 验证
- **Status:** in_progress
- Actions taken:
  - 运行 `pytest backend/qa_assistant/tests/test_citation_normalization_preserves_list_indent.py backend/qa_assistant/tests/test_answer_replacement_shape_guard.py -q`，通过。
  - 运行 `pytest backend/qa_assistant/tests/test_stream_answer_stability.py backend/qa_assistant/tests/test_answer_replacement_shape_guard.py backend/qa_assistant/tests/test_citation_normalization_preserves_list_indent.py -q`，通过。
  - 运行 `node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json`，通过。
  - 额外函数级复核 `normalize_citations()` 输出，确认 4 空格与 8 空格列表缩进已保持。
  - 继续定位到前端次级根因：`answer_replaced` 会提前改写可见正文，导致 finalizing 阶段过早接管页面。
  - 新增 `frontend/features/qa/answer-replacement-state.ts`，将最终替换内容延迟到 `done` 才正式接管。
  - 更新 `frontend/features/qa/qa-view.tsx` 与 `frontend/features/qa/types.ts`，引入 `pendingFinalContent / pendingFinalSources` 状态流。
  - 运行 `npx --yes tsx scripts/qa-answer-replaced-deferred-until-done-regression.ts`，通过。
  - 运行 `npx --yes tsx scripts/qa-mixed-list-preservation-regression.tsx`，通过。
  - 运行 `npx --yes tsx scripts/qa-done-uses-stable-markdown-regression.tsx`，通过。
  - 运行 `npx --yes tsx scripts/qa-done-freezes-streaming-frame-regression.tsx`，通过。
  - 运行 `npx --yes tsx scripts/qa-streaming-equals-final-regression.tsx`，通过。
  - 运行 `npx --yes tsx scripts/qa-list-structure-regression.tsx`，通过。
  - 运行 `npx --yes tsx scripts/qa-final-structure-regression.tsx`，通过。
  - 运行 `npx --yes tsx scripts/qa-answer-replacement-list-shape-guard-regression.ts`，通过。
  - 重新执行前端生产构建 `npm run build`，通过。
  - 重新以 `8032` 为 QA 上游重启 `8021`，确认 `POST http://127.0.0.1:8021/qa/chat/stream` 已恢复为 `200 text/event-stream`。
  - 运行 `python -m pytest backend/qa_assistant/tests/test_stream_answer_stability.py backend/qa_assistant/tests/test_answer_replacement_shape_guard.py backend/qa_assistant/tests/test_citation_normalization_preserves_list_indent.py -q`，通过。
- Files created/modified:
  - `progress.md` (updated)

## Session: 2026-03-21

### Phase 1: 代码结构识别
- **Status:** complete
- **Started:** 2026-03-21
- Actions taken:
  - 读取并应用 `using-superpowers`、`planning-with-files` 技能说明。
  - 扫描前端与后端目录，确认四大板块对应代码位置。
  - 确认工作区实际由 `PersistentWorkspaceShell` 统一挂载。
- Files created/modified:
  - `task_plan.md` (updated)
  - `findings.md` (updated)
  - `progress.md` (updated)

### Phase 2: 四大板块功能映射
- **Status:** complete
- Actions taken:
  - 管控资料上传映射到 `frontend/components/data-upload-panel.tsx` 与 `data_process/*`。
  - 管控问答助手映射到 `frontend/features/qa/*` 与 `backend/qa_assistant/*`。
  - 管控审查系统映射到 `frontend/features/*check*` 与 `backend/review_system/*`。
  - 管控审批清单映射到 `frontend/components/approval-checklist-panel.tsx` 与 `backend/approval_checklist/*`。
- Files created/modified:
  - `task_plan.md` (updated)
  - `findings.md` (updated)

### Phase 3: 生成源码整理文档
- **Status:** complete
- Actions taken:
  - 备份原始手册文本提取文件。
  - 将目标 txt 重写为四大板块源码整理版。
- Files created/modified:
  - `docs\启动与公网发布事项\26-0314 HDMS用户使用手册_原文提取备份.txt` (created)
  - `docs\启动与公网发布事项\26-0314 HDMS用户使用手册.txt` (updated)

### Phase 4: 自检与交付
- **Status:** complete
- Actions taken:
  - 校验目标 txt 存在且内容已变为源码整理版。
  - 校验四大板块标题与大量前后端路径已写入文档。
- Files created/modified:
  - `task_plan.md` (updated)
  - `findings.md` (updated)
  - `progress.md` (updated)

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| 原始 txt 备份 | 原始手册文本 | 生成备份文件 | 已创建备份 txt | ✓ |
| 目标 txt 重写 | 手册 txt | 改为四大板块源码整理版 | 已完成 | ✓ |
| 内容覆盖校验 | 搜索四大板块标题与路径 | 文档中出现四大板块和前后端路径 | 已验证 | ✓ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
|           |       | 1       |            |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | 已完成四大板块源码整理并交付 |
| Where am I going? | 下一步可继续从文档细化到函数级/类级源码链路 |
| What's the goal? | 将手册 txt 直接改写为四大板块的源码定位文档 |
| What have I learned? | 审批清单复用审查系统检测；资料上传对应 data_process；问答和审批都含前端代理层 |
| What have I done? | 已备份原文并重写目标 txt 为源码整理版 |
