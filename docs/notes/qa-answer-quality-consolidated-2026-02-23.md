# QA 问答效果代码与架构审查报告（2026-02-24 更新）

> 本次报告基于最新代码改造进行复审，目标是验证“信息流展示”与“内容归一化”进一步解耦后的真实落地状态，并识别新的架构风险。

## 1. 本次改造核对结论（针对 6 项变更）

### 1.1 已删除非流式接口（`POST /qa/chat`）
- 结论：已落地。
- 证据：`backend/qa_assistant/routes/qa.py` 中 `@router.post("/qa/chat")` 相关实现已删除。
- 影响：前端和后端都转为纯流式主路径。

### 1.2 已删除缓存命中相关链路
- 结论：已落地。
- 证据：
  - `backend/qa_assistant/rag/service.py` 已移除 `get_query_cache` 相关读取/写入。
  - `backend/qa_assistant/routes/qa.py` 已删除 `/qa/cache/stats` 与 `/qa/cache/clear`。
- 影响：每次都走实时检索 + 实时推理，结果时效性提升，成本与延迟上升。

### 1.3 已移除 `inject_summary_document_names()` 注入路径
- 结论：已落地。
- 证据：`backend/qa_assistant/rag/service.py` 的 `_finalize_answer_and_sources(...)` 不再调用 `pp_summary.inject_summary_document_names(...)`。
- 影响：正文“检索综述”不再由后处理二次注入，减少“后置改写引发的结构跳变”。

### 1.4 已移除 `retrieval_overview` SSE 事件
- 结论：已落地。
- 证据：
  - 后端不再 `yield ("retrieval_overview", ...)`。
  - 前端 `frontend/lib/sse-client.ts` 已移除 `retrieval_overview` 分支与回调。
- 影响：外部“检索综述卡片”数据源被移除。

### 1.5 已将检索综述改为 answer 前缀注入
- 结论：已落地。
- 证据：`backend/qa_assistant/rag/service.py` 新增 `_build_retrieval_overview_text(...)`，并在 LLM answer 流前先 `yield("answer", {content: prefix})`。
- 影响：检索综述与正文统一为同一 answer 流，展示口径更一致。

### 1.6 前端已清理外部检索综述卡片逻辑
- 结论：已落地。
- 证据：`frontend/components/qa-new/qa-shell.tsx` 中 `QARetrievalOverview` 组件与渲染分支已删除；`retrievalOverview` 类型与状态使用已清理。
- 影响：页面只保留“回答正文内检索综述”，不再双轨展示。

---

## 2. 当前架构状态（更新后）

### 2.1 信息流展示
- 单一路径：仅 SSE 流式问答。
- 单一综述承载：检索综述作为 answer 前缀进入正文流，不再使用外部综述卡片。
- 渲染阶段：`streaming / finalizing / final` 三阶段仍保留，用于降低 stream/final 跳变。

### 2.2 内容归一化
- `buildAnswerMarkdown(...)` 继续按分阶段 pipeline 处理：
  - `normalize`（已通过 `markdown-normalization-pipeline` 分阶段调用）
  - `citation`
  - `image/table`
- `normalizeAnswerMarkdownArtifacts` 仍是核心规则引擎，但已被阶段编排层包裹。

---

## 3. 关键审查发现（本轮）

### P1：可靠性回退能力降低（有意改造，但需明确接受）
- 现象：前端 `qa-view` 移除了 SSE 失败后的非流式 fallback；后端也删除了非流式 `/qa/chat`。
- 风险：当流式链路异常时，用户直接失败，不再自动回退。
- 建议：若业务允许“纯流式强约束”，需在产品层明确；否则应保留最小降级通道。

### P1：缓存全部移除后，成本/延迟波动风险上升
- 现象：无缓存命中路径，所有请求都触发检索与模型推理。
- 风险：高并发下成本与响应抖动增加；热点问题失去复用收益。
- 建议：可考虑后续引入“短时会话级缓存”或“可配置缓存开关”，而非永久移除。

### P2：检索综述与正文统一后，重复问题显著缓解
- 现象：原“外部卡片 vs 正文综述”重复/矛盾问题在架构层已消除。
- 剩余风险：若模型正文再次自行生成第二个“检索综述”标题，仍可能出现正文内重复。
- 建议：在后处理增加轻量去重守卫（仅对 `## 检索综述` 标题做幂等）。

---

## 4. 与 `normalizeAnswerMarkdownArtifacts` 相关的结构评估

### 已改善
- 归一化调用从“单一 streaming 布尔”升级为“按渲染阶段编排调用”，减少收尾阶段大幅重写。

### 仍待治理
- `normalizeAnswerMarkdownArtifacts` 本体仍是超长规则链，顺序耦合与回归风险仍高。
- 当前分层更多是“调用层解耦”，尚未完成“规则层模块化”。

### 下一步建议（维持主线不变）
1. 拆分 normalize 内部 stage（heading/list/table/math/image/ref）并建立最小回归用例。
2. 建立“阶段策略矩阵”常量，避免策略散落在多个调用点。
3. 对“检索综述标题幂等”增加专项守卫，防止模型自发重复标题。

---

## 5. 回归验证建议（本轮之后）
- 场景 A：流式正常链路，检索综述应只出现一次（正文前缀）。
- 场景 B：SSE 异常链路，确认产品期望是“直接失败”还是“可降级”。
- 场景 C：`answer_replaced` 前后含表格/图片/引用，观察 finalizing 到 done 的稳定性。
- 场景 D：模型自行输出“检索综述”标题时，是否出现正文内部重复。

---

## 6. 一句话结论
本次改造已实质解决“检索综述双轨冲突”，并强化了解耦主线；新的主要问题不再是重复展示，而是“纯流式+无缓存”带来的可靠性与成本边界，需要产品与架构共同确认。
