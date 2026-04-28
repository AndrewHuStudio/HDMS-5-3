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
