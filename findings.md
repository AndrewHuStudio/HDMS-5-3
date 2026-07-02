# QA首token与流式输出性能（2026-05-06）
- 后端 `backend/qa_assistant/routes/qa.py:chat_stream()` 当前会在返回 `StreamingResponse` 前执行 `_create_retriever()` 和 `create_rag_service()`，这意味着数据库 lazy init、embedder 初始化、retriever 构造等 setup 时间都会发生在首个 SSE 字节之前。用户感知就是“发出问题后很久才有任何输出/状态”。
- `backend/qa_assistant/rag/service.py:answer_question_stream()` 在检索完成后会构造 `retrieval_overview_prefix`，但旧逻辑直到 LLM 第一个 `answer` 事件到达时才把这段前缀作为 answer 发出。如果模型先长时间输出 `reasoning_content` 或 `<think>`，首个可见 answer token 会被模型 reasoning 时间拖住。
- 前端 `frontend/lib/sse-client.ts` 当前会在每次处理网络 chunk 后立即 flush token buffer 到 `qa-view`，但 `frontend/features/qa/qa-view.tsx` 又只在下一帧把整个累计 `answerTokenBuffer` 一次性追加到 React 状态。若浏览器/代理把多个 SSE token 合成一个较大网络 chunk，UI 会一帧跳出一大段，然后等待下一大段，表现为“卡卡的、不流畅”。
- Next 代理 `frontend/app/qa/chat/stream/route.ts` 已直接返回 `response.body`，没有显式读取并聚合全量响应；但缺少 `X-Accel-Buffering: no` 透传，可补强部署到反代后的零缓冲语义。
- 修复方向：
  - 路由层尽快返回 `StreamingResponse`，把 retriever/service 创建移动进 generator，并先发 `status` 心跳/理解事件，降低首字节延迟。
  - 检索完成后在进入 LLM 前直接发出 `retrieval_overview_prefix`，让用户尽早看到答案区有内容，而不是等模型第一个 answer。
  - 前端按帧限制单次追加到 UI 的字符量，剩余内容继续排到后续 animation frame，实现打字式平滑输出，同时保持 done/error/replacement 前强制 flush 完整内容。

# QA引用来源加载/PDF打开慢（2026-05-06）
- 本轮截图中的“引用来源”骨架屏慢，链路是 `frontend/components/qa-sources.tsx` 展开卡片后请求 `/api/rag/sources/{chunkId}`，Next 代理到 `backend/qa_assistant/routes/qa.py:get_source_details()`。
- 这不是上一轮“首 token / 流式平滑”修复直接引入的回归；上一轮只改了 `chat_stream()` 首包、检索综述输出顺序、Next SSE headers、前端 answer token flush。
- 真正慢点是 `get_source_details()` 默认会执行 `_resolve_pdf_path()` 和 `_search_page_in_pdf()`；后者会调用 `_get_pdf_page_texts()` 抽取整本 PDF 每页文本来反查物理页码。大 PDF 或多个来源同时展开时会明显卡住。
- 更早的“引用来源/PDF稳定性”修复取消了答案完成后的批量 source detail 预取，避免后台同时解析多个 PDF；副作用是这类耗时从后台预取变成用户展开/打开时可见，所以体感更明显。
- `frontend/lib/resolve-pdf-url.ts` 还有一个额外慢点：即使 source 已有 `doc_id`，只要没有 page，也会先请求 source detail 来找页码，再打开 PDF。这会让“查看PDF”被 page lookup 阻塞。
- 修复方向：
  - source detail 默认走快路径：不解析 PDF 路径、不扫描 PDF，只返回 chunk/document 已有元数据和文本。
  - 若将来确实需要精确物理页码，可显式传 `resolve_page=true` 触发 PDF 扫描。
  - 已有 `doc_id/pdf_url` 时 PDF 打开直接返回文档 URL，不再为了未知页码阻塞 viewer。
  - Next `/api/rag/sources/{chunkId}` 代理透传 `resolve_page`，保留显式精确页码能力。

# Findings & Decisions

## QA前端流程跑通（2026-04-19）
- 当前前端 external 模式运行在 `http://localhost:8021`，并通过 Next 代理处理 `/qa/chat/stream`。
- `scripts/start-frontend.ps1` 在 external 模式下默认把 `HDMS_QA_BASE_URL` 设为 `http://localhost:8022`，但本机 `8022` 没有服务。
- 实际在线的 QA 后端是 `http://localhost:8032`，其 OpenAPI 标题为 `HDMS QA Assistant API`，并且包含 `/qa/chat/stream`、`/rag/*` 等路径。
- 实际在线的审查系统在 `8023`，审批清单在 `8024`，数据处理在 `8125`；之前把 8023/8024 误当 QA 端口会导致 `/qa/chat/stream` 返回 404。
- 直接请求 `http://localhost:8032/qa/chat/stream` 可收到 `status`、`sources`、`retrieval_stats`、`thinking`、`answer` 等 SSE 事件。
- 修正前端启动脚本后，直接请求 `http://localhost:8021/qa/chat/stream` 也能收到与 8032 一致的 SSE 事件，说明前端代理链路已打通。

## QA流式Markdown稳定性（2026-04-19）
- `frontend/features/qa/render/streaming-markdown-stability.ts` 当前 `splitTailBlock()` 仅按“最后一个空行”切 tail，会把没有空行分隔的完整段落、表格、列表整体移出 parser。
- 同文件 `isRiskyMarkdownTail()` 使用 `/[*_`[]$/` 判定 risky tail，等同于只要尾部出现这些字符就容易误报，导致正常中文技术文本在 streaming 阶段被隐藏。
- `frontend/components/qa-new/qa-markdown-renderer.tsx` 当前 pending 渲染只有二态：显示或隐藏，缺少对“有真实文本但 markdown 未闭合”的纯文本兜底。
- `qa-markdown-renderer.tsx` 在 `!isMathComplete(streamingPrepared.markdownForParser)` 时会把整个 stable prefix 纯文本降级，导致已完整的标题/列表/表格格式丢失。
- `frontend/features/qa/qa-view.tsx` 的 answer token flush 仍基于 `setTimeout(48ms)`，更新节奏不与渲染帧对齐。
- `frontend/lib/normalize-rules/phase-matrix.ts` 目前让 `block-parser` 在 `streaming` 阶段运行，这与“流式阶段避免结构重写”的目标冲突。

## QA最终答案层级跳变根因（2026-04-27）
- 真实线上 QA 链路是 `frontend:8021 -> backend/qa_assistant:8032`，不是 `MediArch_System` 的前端路径。
- 本次“输出过程中层级正确，但输出结果序号跳变/级别错乱/平级消融”的主根因在后端 `answer_replaced` 链路，而不是首要发生在前端渲染器。
- `backend/qa_assistant/rag/postprocess/citations.py` 里的 `normalize_citations()` 使用了全局 `re.sub(r"[ \t]{2,}", " ", result)`。
- 这条全局空格压缩会把 Markdown 列表的前导缩进一起压掉，例如二级有序项前的 4 空格会被压成 1 空格，直接把嵌套列表压平成同级列表。
- 因为流式过程展示的是未经过这一步最终后处理的文本，所以流式阶段层级看起来正确；`answer_replaced` 一旦替换为后处理结果，最终答案就会出现层级跳变。
- 现有 `_should_emit_answer_replacement()` 只统计顶层有序/无序列表行数，忽略 `^\s{4,}` 的嵌套列表项，所以无法识别“二级序号被压平成一级序号”的退化。
- 直接函数级复现证据：
  - 输入：`1. 一级 -> (4空格)1. 二级 -> (8空格)- 细项`
  - 旧 `normalize_citations()` 输出会变成：`1. 一级 -> (1空格)1. 二级 -> (1空格)- 细项`
  - 旧 `_should_emit_answer_replacement()` 仍返回接受。
- 修复方向：
  - 后端引用归一化只压缩行内多余空格，不再破坏 leading indent。
  - 前后端的 answer replacement guard 都增加对嵌套有序/无序列表数量的检测，拒绝“nested list flattening”。

## QA最终答案跳变的前端次级根因（2026-04-27）
- 在后端缩进问题修复后，前端仍存在第二个会制造“过程对、结果跳”的问题：`frontend/features/qa/qa-view.tsx` 在收到 `answer_replaced` 事件时，会立刻把可见 `content` 改成最终替换内容。
- 这意味着用户看到的并不是“流式内容持续到 done，再一次性切到最终内容”，而是中途提前切到 finalizing/final 管线；如果最终替换文本触发了更强的标题/列表规范化，界面会在输出尚未完成前发生结构跳变。
- 该问题与后端缩进问题不同：即使后端最终文本本身合法，只要前端提前接管正文，仍会出现“输出过程中层级正常，结果阶段突然变样”的感知问题。
- 修复方向：
  - `answer_replaced` 阶段只暂存 `pendingFinalContent / pendingFinalSources`，不提前改写可见正文。
  - 等到 `done` 事件到达，再一次性接管最终正文并生成最终稳定 Markdown。

## QA代理运行时状态（2026-04-27）
- 之前 `8021` 返回 `502 {"detail":"Backend unavailable."}`，不是 QA 文本层级问题，而是 Next 生产进程未跑在最新构建上的独立运行时问题。
- 重新构建前端并以正确的 `HDMS_QA_BASE_URL=http://127.0.0.1:8032` 环境重启 `8021` 后，`POST http://127.0.0.1:8021/qa/chat/stream` 已返回 `200 text/event-stream`。
- 当前 `8021 -> 8032` 代理链路已恢复，可用于继续验证真实 QA 问答页面。

## QA引用点击无法跳转根因（2026-04-29）
- 点击正文里的引用标记后，事件链路本身是通的：`CitationPill -> useCitationState.handleCitationSelect -> jumpToCitationSource`，source 卡片也已经带有 `id` 和 `data-citation-target-*` 目标属性。
- 真正卡住的位置在 `frontend/features/qa/citation-engine/core/dom-navigation.ts` 的 `jumpToCitationSource()`。
- 旧逻辑只有在“source 面板滚动容器本身已经处于聊天视口内”时，才会使用 `sourceScrollContainer`；否则直接退回只滚外层 `chatScrollContainer`。
- 这在带独立来源滚动区的布局里会失效：外层聊天区即使滚动了，source 面板内部列表位置没有变，目标卡片仍然被 source 面板自己的 `overflow-y-auto` 裁切，用户看到的效果就是“点击引用无跳转”。
- 该问题不是引用 pill 没渲染，也不是 target id 算错；而是多层滚动容器场景下只滚了外层，漏滚了真正承载目标卡片的内部来源滚动容器。
- 修复方向：
  - 只要 source 面板自身可滚，就始终先滚 `sourceScrollContainer` 到目标卡片。
  - 如果 source 面板当前整体不在聊天视口里，再补一次对 `chatScrollContainer` 的滚动，把整个 source 面板带进可视区。
  - 为避免将来回归，新增 `frontend/scripts/qa-citation-offscreen-source-panel-regression.ts` 锁定“offscreen source panel + nested scroller”场景。

## Assistant embedded 引用跳转补充（2026-04-30）
- `/assistant` 走 embedded inline source layout，不使用普通问答页的 sidebar source scroller。
- 当前工作区已有之前的 citation 重构：正文 pill 会携带 `data-citation-label` / `data-citation-origin-id`，source card 会携带 message-scoped `id`、`data-citation-target-label`、`data-citation-target-message`。
- 这次确认的 embedded inline 缺口是 `QACitationSourcePanel` 只在 `layout === "sidebar"` 时给 source panel wrapper 设置 `citation-source-list-<message>` id。
- `useCitationState.attemptCitationJump()` 会优先按 `buildCitationSourcePanelScrollerId(messageId)` 找 source container；inline 模式缺这个 id 时，pending citation selection 无法稳定拿到当前 message 的 source panel container。
- 修复后 inline 和 sidebar source panel 都暴露同一个 message-scoped source-list id；inline 容器没有 `overflow-y-auto`，所以 `jumpToCitationSource()` 仍会按现有逻辑 fallback 到 `.qa-scrollbar`，不会把 inline 容器误当内部滚动区。
- 新增 `frontend/scripts/qa-citation-inline-scroller-id-regression.tsx`，先在旧实现下失败，修复后通过。
- 用户进一步澄清目标行为是：点击正文红色 citation pill（例如 `1-4`）后，页面应滚动到“引用来源”列表中对应 label 的来源项卡片。
- 因此真正需要锁定的是 source item card 的滚动祖先，而不是只滚动传入的 chat container。`/assistant` 嵌入布局下可能存在多个 `.qa-scrollbar` 或外层滚动区，传入的 chat container 不一定包含目标来源项。
- 新增 `frontend/scripts/qa-citation-nearest-scroll-parent-regression.ts` 复现该断点：目标 `1-4` source card 挂在 `realChatScroller` 下，但函数收到的是不包含目标的 `wrongChatScroller`；旧实现会滚错容器，表现为点击 pill 没有明显跳到来源项。
- `frontend/features/qa/citation-engine/core/dom-navigation.ts` 现在会在找到目标 source card 后：
  - 先使用明确包含目标且可滚动的 `sourceScrollContainer`；
  - 否则沿目标 source card 的 `parentElement` 链寻找最近可滚动祖先；
  - 只有当传入的 `chatScrollContainer` 包含目标，或没有更好的祖先容器时，才滚动 chat container；
  - 最后才退回原生 `scrollIntoView()`。
- 该修复保持原有 sidebar/offscreen source panel 行为：有独立 source scroller 时仍先滚 source list，必要时再滚 chat container 让整个来源面板可见。

## QA引用来源详情/PDF打开不稳定根因（2026-05-06）
- 用户反馈现象集中在答案底部“引用来源”卡片：点击展开后详情有时看不到，点击“查看PDF”有时打不开或加载很慢。
- 准确前端链路：
  - `frontend/components/qa-sources.tsx` 的 `SourceCard` 负责卡片展开、详情加载和“查看PDF”按钮。
  - 展开详情会调用 `/api/rag/sources/{chunkId}`；PDF 按钮经 `frontend/lib/resolve-pdf-url.ts` 解析 URL 后打开 `PdfLightbox`。
  - `frontend/app/api/rag/sources/[chunkId]/route.ts` 和 `frontend/app/api/rag/documents/[docId]/pdf/route.ts` 是 Next 同源代理。
- 准确后端链路：
  - `backend/qa_assistant/routes/qa.py:get_source_details()` 读取 chunk/document 后，会调用 `_resolve_pdf_path(document)` 和 `_search_page_in_pdf(pdf_path, text)`。
  - `_search_page_in_pdf()` 会通过 `_get_pdf_page_texts()` 读取并抽取 PDF 每页文本，用于反查 chunk 的物理页码。
- 当前强信号根因：
  - 前端 `QASources` 在答案渲染后会预取最多 12 个来源详情，即使用户还没展开卡片。
  - 多个引用来源通常指向同一个 PDF。并发详情请求会同时进入后端 `_get_pdf_page_texts()`。
  - `_pdf_page_texts_cache` 只在完整抽取结束后写入；并发请求在第一个请求完成前都会 cache miss，导致同一 PDF 被重复完整解析。
  - 这会拖慢来源详情响应，并和 PDF 查看请求竞争资源，表现为“详情/PDF 偶发打不开或很慢”。
- 修复方向：
  - 后端为同一 PDF 的 page-text 抽取增加 in-flight/锁保护，让并发请求共享一次解析结果。
  - 前端取消答案完成后的来源详情大批量预取，只在选中/展开或必要元信息缺失且用户交互后请求，避免主动放大后端压力。
- 已实施结果：
  - `backend/qa_assistant/routes/qa.py` 现在对 `_get_pdf_page_texts()` 使用按 PDF 路径划分的锁，避免同一 PDF 在并发来源详情请求中被重复完整解析。
  - `frontend/components/qa-sources.tsx` 已移除答案渲染后的批量 source detail 预取和缺元信息时的自动预取；来源详情仍在卡片展开/选中时按需加载。
  - 对只有 `chunk_id`、暂时没有 `doc_id/pdf_url` 的来源，仍显示“查看PDF”按钮；点击时沿用 `resolvePdfUrlForSource()` 通过 source detail endpoint 按需解析 PDF URL。

## OCR任务持久化（2026-04-09）
- OCR job 当前仅存在 `data_process/ocr_process/core.py` 的进程内 `_jobs` 字典。
- `get_job_status()` 只读内存；`get_summary()` 则直接扫描 OCR 输出目录，因此两者天然会失配。
- 当前 OCR 执行模型依赖 daemon thread；服务重启后，非终态任务不可能继续执行。
- 持久化应覆盖：创建 job、更新 job、读取 job，以及 OCR 全量重置时的清理策略。
- 若持久化目录与 `data/ocr_output` 绑定，会在“清空 OCR 输出”时一起被误删；应拆开。
- 最终实现采用独立目录 `OCR_JOB_STORE_DIR`，默认落在 `data/ocr_jobs`。
- `get_job_status()` 在内存 miss 时会回读 JSON；若文件状态不是终态，会统一转成 `failed` 并附带“服务重启，任务中断”错误。
- `clear_output_dir()` 现在会同步清空 OCR job store 和内存 `_jobs`，保证 OCR 全量重置后状态一致。

## Requirements
- 依据 `E:\MyPrograms\HDMS\docs\启动与公网发布事项\26-0314 HDMS用户使用手册.pdf` 提取功能需求。
- 目标是整理出“关键功能模块”数量与清单。
- 先提取功能，再逐项寻找和提取源码。
- 将提取结果文档输出到 `E:\MyPrograms\HDMS\docs\启动与公网发布事项`。
- 文档需要支持后续追踪源码填写进度。
- 当前新增要求：直接把源码映射结果填写到 `26-0314 HDMS用户使用手册.txt`。
- 需要按四大板块整理：管控资料上传、管控问答助手、管控审查系统、管控审批清单。
- 每个板块下需要同时列出前端与后端。

## Research Findings
- 前端四大板块实际由 `frontend/components/workspace/persistent-workspace-shell.tsx` 统一挂载。
- `frontend/app/(workspace)/*/page.tsx` 基本都是空壳页，真正功能在组件层。
- 管控资料上传对应独立后端服务 `data_process/main.py`，不在 `backend` 目录内。
- 管控问答助手对应 `backend/qa_assistant/app.py` 和 `backend/qa_assistant/routes/qa.py`。
- 管控审查系统对应 `backend/review_system/app.py`，具体检测实现集中在 `routes` 与 `services`。
- 管控审批清单对应 `backend/approval_checklist/app.py`，前端聚合检测主要在 `frontend/components/approval-checklist-panel.tsx`。
- 审批清单前端复用了 review_system 的全部检测 feature，不是独立的检测算法目录。
- 问答助手前端存在 Next 代理层：`frontend/app/qa/chat/stream/route.ts`、`frontend/app/api/rag/sources/[chunkId]/route.ts`。
- 审批清单前端存在 Next 代理层：`frontend/app/api/approval/[...path]/route.ts`。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 以四大板块为一级结构重写目标 txt | 符合用户指定的整理方式 |
| 在每个板块内按“前端入口 -> 子功能 -> 后端实现”展开 | 便于后续继续细化到函数级 |
| 先备份原始 txt 再覆盖 | 保留原始 PDF 文本抽取结果 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
|       |            |

## Resources
- `E:\MyPrograms\HDMS\docs\启动与公网发布事项\26-0314 HDMS用户使用手册.pdf`
- `E:\MyPrograms\HDMS\docs\启动与公网发布事项\26-0314 HDMS用户使用手册.txt`
- `E:\MyPrograms\HDMS\docs\启动与公网发布事项\26-0314 HDMS用户使用手册_原文提取备份.txt`

## Visual/Browser Findings
- 已将手册内容映射为四大板块源码说明文档，不再以 PDF 页码为主组织。
