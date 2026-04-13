# Findings & Decisions

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
