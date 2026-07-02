# Session: 2026-05-06 QA首token与流式输出性能

### Phase 1: 根因调查
- **Status:** complete
- Actions taken:
  - Applied `using-superpowers`, `brainstorming`, `systematic-debugging`, `test-driven-development`, and `planning-with-files`.
  - Replaced active `task_plan.md` with the current first-token latency and streaming smoothness task.
  - Confirmed the working tree already contains many QA-related pending changes from earlier sessions, so this task must preserve those changes.
  - Inspected backend `chat_stream()`, `answer_question_stream()`, Next stream proxy, SSE client, and `QAView` answer flush loop.
  - Confirmed root causes:
    - `chat_stream()` created retriever/RAG service before returning `StreamingResponse`, delaying first SSE bytes.
    - `retrieval_overview_prefix` was held until the first LLM answer token, so long model reasoning delayed the first visible answer.
    - Frontend appended the whole accumulated answer buffer in a single animation frame, producing jumpy output when network chunks were large.

### Phase 2: failing regressions
- **Status:** complete
- Actions taken:
  - Added `backend/qa_assistant/tests/test_stream_latency_behaviour.py`.
  - Confirmed it failed before the fix:
    - route setup called `_create_retriever()` / `create_rag_service()` before returning the streaming response.
    - retrieval overview answer event appeared after thinking events.
  - Added `frontend/scripts/qa-streaming-output-frame-budget-regression.ts`.
  - Initially deleted the helper and confirmed the regression failed before implementation.

### Phase 3: minimal fix
- **Status:** complete
- Actions taken:
  - Updated `backend/qa_assistant/routes/qa.py` so `chat_stream()` returns `StreamingResponse` immediately, emits an initial `status` event first, and then creates retriever/RAG service inside the generator.
  - Updated `backend/qa_assistant/rag/service.py` to emit retrieval overview before entering the LLM stream.
  - Updated `frontend/app/qa/chat/stream/route.ts` to include `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`.
  - Added `frontend/features/qa/streaming-output-buffer.ts` and connected `frontend/features/qa/qa-view.tsx` to drain answer buffers in bounded per-frame chunks.

### Phase 4: verification
- **Status:** complete
- Verification:
  - `python -m pytest backend/qa_assistant/tests/test_stream_latency_behaviour.py -q` passed.
  - `python -m pytest backend/qa_assistant/tests/test_stream_latency_behaviour.py backend/qa_assistant/tests/test_stream_answer_stability.py backend/qa_assistant/tests/test_answer_replacement_shape_guard.py backend/qa_assistant/tests/test_citation_normalization_preserves_list_indent.py -q` passed.
  - `python -m pytest backend/qa_assistant/tests -q` passed.
  - `npx --yes tsx scripts/qa-streaming-output-frame-budget-regression.ts` passed.
  - `npx --yes tsx scripts/qa-streaming-stable-prefix-regression.tsx` passed.
  - `npx --yes tsx scripts/qa-streaming-normalization-regression.ts` passed.
  - `npx --yes tsx scripts/qa-answer-replaced-deferred-until-done-regression.ts` passed.
  - `npx --yes tsx scripts/qa-done-uses-stable-markdown-regression.tsx` passed.
  - `npx --yes tsx scripts/qa-done-freezes-streaming-frame-regression.tsx` passed.
  - `npx --yes tsx scripts/qa-streaming-equals-final-regression.tsx` passed.
  - `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` passed from `frontend`.

## Session: 2026-05-06 QA引用来源加载/PDF打开慢

### Phase 1: 根因调查
- **Status:** complete
- Actions taken:
  - Re-read source card and PDF open paths: `frontend/components/qa-sources.tsx`, `frontend/lib/resolve-pdf-url.ts`, Next source proxy, and backend `get_source_details()`.
  - Confirmed the previous first-token/streaming fix does not touch citation source loading or PDF viewer logic.
  - Identified the slow boundary: backend source details defaulted to PDF path resolution and full-PDF page text scanning for exact page lookup.
  - Identified an additional PDF open slow path: `resolvePdfUrlForSource()` fetched source details even when `doc_id` was already available, solely to find a page anchor.

### Phase 2: failing regressions
- **Status:** complete
- Actions taken:
  - Added `backend/qa_assistant/tests/test_source_detail_fast_path.py`.
  - Confirmed it failed because default source details scanned the PDF and there was no `resolve_page` opt-in parameter.
  - Added `frontend/scripts/qa-pdf-open-docid-fast-path-regression.ts`.
  - Confirmed it failed because doc_id-backed PDF open still fetched `/api/rag/sources/chunk-1`.

### Phase 3: minimal fix
- **Status:** complete
- Actions taken:
  - Updated `backend/qa_assistant/routes/qa.py:get_source_details()` with `resolve_page=false` default.
  - Default source detail now skips `_resolve_pdf_path()` and `_search_page_in_pdf()` and returns `/rag/documents/{doc_id}/pdf` when `doc_id` exists.
  - `resolve_page=true` still triggers precise PDF page scanning when explicitly requested.
  - Updated `frontend/lib/resolve-pdf-url.ts` so known `doc_id/pdf_url` opens immediately without source-detail fetch for missing page.
  - Updated Next source proxy to pass through `resolve_page`.

### Phase 4: verification
- **Status:** complete
- Verification:
  - `python -m pytest backend/qa_assistant/tests/test_source_detail_fast_path.py -q` passed.
  - `npx --yes tsx scripts/qa-pdf-open-docid-fast-path-regression.ts` passed.
  - `python -m pytest backend/qa_assistant/tests -q` passed.
  - `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` passed from `frontend`.
  - Existing citation/source regressions passed: `qa-citation-source-target-attr-regression.tsx`, `qa-citation-source-selection-regression.tsx`, `qa-citation-jump-regression.ts`.

# Progress Log

## Session: 2026-05-06 QA引用来源详情/PDF稳定性

### Phase 1: 根因调查
- **Status:** complete
- Actions taken:
  - Applied `using-superpowers`, `systematic-debugging`, `test-driven-development`, `planning-with-files`, and `verification-before-completion`.
  - Inspected `frontend/components/qa-sources.tsx`, `frontend/components/qa-new/qa-citation-source-panel.tsx`, `frontend/components/pdf-lightbox.tsx`, the Next `/api/rag/sources/[chunkId]` and `/api/rag/documents/[docId]/pdf` proxy routes, and backend `backend/qa_assistant/routes/qa.py`.
  - Confirmed PowerShell wildcard handling requires `-LiteralPath` for route directories named `[chunkId]` and `[docId]`.
  - Traced source card expansion to `/api/rag/sources/{chunkId}` and PDF open to `resolvePdfUrlForSource()` plus `PdfLightbox`.
  - Identified likely pressure point: backend source detail calls run `_search_page_in_pdf()` and can concurrently parse the same PDF many times; frontend eager source-detail prefetch can trigger many such calls immediately after answer render.
- Files modified:
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### Phase 2: failing regressions
- **Status:** complete
- Actions taken:
  - Added a temporary backend regression proving concurrent calls to `_get_pdf_page_texts()` for the same PDF parsed the same PDF 5 times before the fix.
  - Added a temporary frontend regression proving `QASources` eagerly prefetched up to 12 source-detail records after answer render.
  - Added a temporary chunk-only PDF button regression proving chunk-backed sources still need a `查看PDF` button after eager prefetch is removed.
  - Removed all temporary regression files after verification, per user request.

### Phase 3: minimal fix
- **Status:** complete
- Actions taken:
  - Updated `backend/qa_assistant/routes/qa.py` with per-PDF locks around `_get_pdf_page_texts()` so concurrent detail requests share one in-flight PDF text extraction.
  - Updated `frontend/components/qa-sources.tsx` to remove answer-render-time source detail prefetch and metadata autoprefetch; details still load on card expansion/selection.
  - Kept `查看PDF` visible for chunk-backed sources so clicks can resolve `doc_id` through `resolvePdfUrlForSource()` on demand.
- Files modified:
  - `backend/qa_assistant/routes/qa.py`
  - `frontend/components/qa-sources.tsx`

### Phase 4: verification
- **Status:** complete
- Verification:
  - Temporary backend concurrency regression failed before the fix with 5 PDF parses; passed after the fix.
  - Temporary frontend eager-prefetch regression failed before the fix; passed after removing the source-detail prefetch.
  - Temporary chunk-only PDF button regression failed before the UI adjustment; passed after keeping the on-demand PDF button.
  - Inline backend concurrency probe ran 3 rounds after test cleanup: each round had 5 concurrent callers and exactly 1 fake PDF parse.
  - `rg` check confirmed no `prefetchingKeysRef`, `PREFETCH_LIMIT`, or metadata autoprefetch remnants remain in `frontend/components/qa-sources.tsx`.
  - `python -m pytest backend/qa_assistant/tests/test_stream_answer_stability.py backend/qa_assistant/tests/test_answer_replacement_shape_guard.py backend/qa_assistant/tests/test_citation_normalization_preserves_list_indent.py -q` passed twice in final verification.
  - `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` passed from `frontend`.
  - Existing citation/source regressions passed: `qa-citation-inline-scroller-id-regression.tsx`, `qa-citation-source-target-attr-regression.tsx`, `qa-citation-source-selection-regression.tsx`, `qa-citation-jump-regression.ts`, `qa-citation-offscreen-source-panel-regression.ts`.

## Session: 2026-04-30 Assistant embedded citation jump

### Follow-up: source item card jump clarification
- **Status:** complete
- Actions taken:
  - Re-read the user clarification: clicking an inline red citation pill must scroll to the matching source item card in “引用来源”.
  - Confirmed the existing handoff regression `frontend/scripts/qa-citation-nearest-scroll-parent-regression.ts` fails against the current code because `jumpToCitationSource()` scrolls a passed non-ancestor chat container.
  - Updated `frontend/features/qa/citation-engine/core/dom-navigation.ts` so source jumps prefer an explicit containing source scroller, then the target source card's nearest scrollable ancestor, then a containing chat scroller, then native `scrollIntoView()`.
  - Adjusted containment handling to keep existing lightweight regression mocks working while rejecting real non-ancestor containers when `parentElement`/`contains()` prove the target is outside.
  - Corrected the new regression expectation to match the existing centered scroll formula, including the container's current `scrollTop`.
- Verification:
  - `npx --yes tsx scripts/qa-citation-nearest-scroll-parent-regression.ts` passed.
  - `npx --yes tsx scripts/qa-citation-inline-scroller-id-regression.tsx` passed.
  - `npx --yes tsx scripts/qa-citation-inline-primary-jump-regression.ts` passed.
  - `npx --yes tsx scripts/qa-citation-inline-chat-fallback-regression.ts` passed.
  - `npx --yes tsx scripts/qa-citation-sidebar-scroller-regression.tsx` passed.
  - `npx --yes tsx scripts/qa-citation-jump-regression.ts` passed.
  - `npx --yes tsx scripts/qa-citation-offscreen-source-panel-regression.ts` passed.
  - `npx --yes tsx scripts/qa-citation-source-target-attr-regression.tsx` passed.
  - `npx --yes tsx scripts/qa-citation-query-fallback-regression.ts` passed.
  - `npx --yes tsx scripts/qa-citation-same-doc-fallback-regression.ts` passed.
  - `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` passed.
- Files modified:
  - `frontend/features/qa/citation-engine/core/dom-navigation.ts`
  - `frontend/scripts/qa-citation-nearest-scroll-parent-regression.ts`
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### Phase 1: Root cause investigation
- **Status:** complete
- Actions taken:
  - Applied `using-superpowers`, `systematic-debugging`, `test-driven-development`, `planning-with-files`, and `verification-before-completion`.
  - Replaced the active `task_plan.md` with the current `/assistant` embedded citation jump task.
  - Reviewed current citation diff and confirmed this working tree already contains pending selection, message-scoped target ids, and source target attributes from previous citation work.
  - Ran focused citation regressions for inline jump, inline fallback, pending streaming click, and source target attributes; all four passed.
  - Started Next dev on `127.0.0.1:8021` for page-level checks.
  - Tried a page-level mock SSE script, but removed it because this local install lacks Playwright and cached Playwright lacked its browser binary.
  - Confirmed the actionable embedded inline gap: `QACitationSourcePanel` only emitted `citation-source-list-<message>` for sidebar layout, while `useCitationState` resolves source containers by that id.
- Files created/modified:
  - `task_plan.md` (updated)
  - `progress.md` (updated)
  - `findings.md` (updated)

### Phase 2: Failing regression
- **Status:** complete
- Actions taken:
  - Added `frontend/scripts/qa-citation-inline-scroller-id-regression.tsx`.
  - Ran it against the current implementation before the fix and confirmed it failed because inline layout did not render `citation-source-list-assistant-qa-1`.
- Files created/modified:
  - `frontend/scripts/qa-citation-inline-scroller-id-regression.tsx` (created)

### Phase 3: Minimal fix
- **Status:** complete
- Actions taken:
  - Updated `frontend/components/qa-new/qa-citation-source-panel.tsx` so the source panel wrapper always gets the message-scoped source-list id.
  - Kept the sidebar-only `overflow-y-auto` class unchanged so inline layout still scrolls via the chat container.
- Files created/modified:
  - `frontend/components/qa-new/qa-citation-source-panel.tsx` (updated)

### Phase 4: Verification
- **Status:** complete
- Actions taken:
  - Ran `npx --yes tsx scripts/qa-citation-inline-scroller-id-regression.tsx`, passed.
  - Ran `npx --yes tsx scripts/qa-citation-inline-primary-jump-regression.ts`, passed.
  - Ran `npx --yes tsx scripts/qa-citation-inline-chat-fallback-regression.ts`, passed.
  - Ran `npx --yes tsx scripts/qa-citation-sidebar-scroller-regression.tsx`, passed.
  - Ran `npx --yes tsx scripts/qa-citation-source-target-attr-regression.tsx`, passed.
  - Ran `npx --yes tsx scripts/qa-citation-streaming-pending-jump-regression.ts`, passed.
  - Ran `npx --yes tsx scripts/qa-citation-jump-regression.ts`, passed.
  - Ran `npx --yes tsx scripts/qa-citation-offscreen-source-panel-regression.ts`, passed.
  - Ran `npx --yes tsx scripts/qa-citation-query-fallback-regression.ts`, passed.
  - Ran `npx --yes tsx scripts/qa-citation-same-doc-fallback-regression.ts`, passed.
  - Ran `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`, passed.
- Files created/modified:
  - `task_plan.md` (updated)
  - `findings.md` (updated)
  - `progress.md` (updated)

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

## Session: 2026-04-29 QA引用跳转修复

### Phase 1: 根因调查
- **Status:** complete
- Actions taken:
  - 复核引用点击链路：`CitationPill`、`useCitationState`、`jumpToCitationSource`、`QACitationSourcePanel`、`QASources`。
  - 确认 source 卡片已正确暴露 `id={buildCitationTargetId(...)}` 与 `data-citation-target-*`，问题不在 pill 或 target 生成。
  - 锁定 `frontend/features/qa/citation-engine/core/dom-navigation.ts`：旧逻辑在 source 面板不在聊天视口时错误退回只滚外层聊天容器，导致 source 面板自身内部滚动位置未更新。
- Files created/modified:
  - `findings.md` (updated)
  - `progress.md` (updated)

### Phase 2: 测试先行
- **Status:** complete
- Actions taken:
  - 新增 `frontend/scripts/qa-citation-offscreen-source-panel-regression.ts`。
  - 先运行该脚本，确认旧实现失败，具体表现为 `sourceScrollToTop === null`，证明 source 面板自己的滚动容器没有被滚动。
- Files created/modified:
  - `frontend/scripts/qa-citation-offscreen-source-panel-regression.ts` (created)

### Phase 3: 最小实现
- **Status:** complete
- Actions taken:
  - 修改 `frontend/features/qa/citation-engine/core/dom-navigation.ts`。
  - 让 `jumpToCitationSource()` 在 source 面板自身可滚时始终先滚 `sourceScrollContainer` 到目标卡片。
  - 当 source 面板整体不在聊天视口内时，再额外滚动 `chatScrollContainer`，把来源面板整体带入可视区。
  - 补充 `resolveTargetHeight()`，允许滚动计算同时适配普通目标节点和滚动容器节点。
- Files created/modified:
  - `frontend/features/qa/citation-engine/core/dom-navigation.ts` (updated)

### Phase 4: 验证
- **Status:** complete
- Actions taken:
  - 运行 `npx --yes tsx scripts/qa-citation-offscreen-source-panel-regression.ts`，通过。
  - 运行 `npx --yes tsx scripts/qa-citation-jump-regression.ts`，通过。
  - 运行 `npx --yes tsx scripts/qa-citation-inline-chat-fallback-regression.ts`，通过。
  - 运行 `npx --yes tsx scripts/qa-citation-source-selection-regression.tsx`，通过。
  - 运行 `npx --yes tsx scripts/qa-citation-source-target-attr-regression.tsx`，通过。
  - 运行 `npx --yes tsx scripts/qa-citation-sidebar-scroller-regression.tsx`，通过。
  - 运行 `node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json`，通过。
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
