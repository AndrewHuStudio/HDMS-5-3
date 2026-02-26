# 管控审批清单需求与开发进度（持续更新）

- 状态：前后端第一版已落地（可联调）
- 模块：`backend/approval_checklist`
- 更新日期：2026-02-26

---

## 1. 已确认需求（最终口径）

1. 业务范围：**单一项目**（`project_id`）的管控审批清单。
2. 数据来源：`review_system` 十个检测项结果。
3. 功能定位：**汇总展示**，不是审批流。
4. 角色权限：当前不区分角色权限。
5. 核心动作：保存草稿、导出 PDF。
6. 模板要求：
   - 标题：`城市规划管控要素审查表`
   - 编号可填（默认空），且需持久化并回填
   - 片区名称可填（默认 `未命名片区`）
   - 检测时间默认当前时间（到秒）
   - 要素数量按已选检测项计算（默认 10）
   - 含审查意见、审查结论、签字区、盖章区、打印/导出
7. 异常规则：
   - 检测项异常时显示：`xxx检测功能异常，暂时无法显示`
   - 异常项自动取消勾选，重复点击仍提示并保持未勾选
8. PDF 规则：A4 纵向，内容超长自动分页。

---

## 2. 十个检测项（来自 `frontend/features`）

1. 限高检测（`height-check`）
2. 贴线率检测（`setback-rate-check`）
3. 建筑退线检测（`setback-check`）
4. 绿地退线检测（`green-setback-check`）
5. 广场退线检测（`plaza-setback-check`）
6. 空中连廊检测（`sky-bridge`）
7. 视线通廊检测（`sight-corridor`）
8. 消防登高面检测（`fire-ladder`）
9. 车行出入口检测（`vehicle-entrance-check`）
10. 人行出入口检测（`pedestrian-entrance-check`）

---

## 3. 已完成开发（Backend）

### 3.1 服务与配置

- `backend/approval_checklist/app.py`
- `backend/approval_checklist/core/config.py`
- `backend/approval_checklist/schemas.py`
- `backend/approval_checklist/routes/checklist.py`
- `backend/approval_checklist/services/checklist_service.py`

### 3.2 已提供接口

- `GET /health`
- `GET /approval-checklist/checks`
- `POST /approval-checklist/generate`
- `POST /approval-checklist/drafts`
- `GET /approval-checklist/drafts/{project_id}`
- `POST /approval-checklist/export-pdf`

### 3.3 脚本能力

1. 一键导出十项原始结果：
   - `backend/approval_checklist/scripts/export_review_results.py`
   - 输出目录：`backend/approval_checklist/raw_results/<timestamp>/`
2. 原始结果归一化为清单 JSON v1：
   - `backend/approval_checklist/scripts/normalize_raw_results.py`
   - 输出文件：`checklist_normalized_v1.json`

### 3.4 已验证结果

- 十项检测原始导出已跑通（含 sky-bridge 连接格式兼容处理）。
- 归一化 JSON v1 已生成并可用于前端展示。
- `generate` 与 `export-pdf` 已联通。

---

## 4. 已完成开发（Frontend）

- 已实现并替换：`frontend/components/review-panel.tsx`
- 已新增 API 封装：`frontend/lib/api/approval-checklist.ts`

### 4.1 页面效果已具备

1. 右下检测项选择器（默认全选）
2. `project_id` 与 `model_path` 输入
3. 生成审查表（弹窗：城市规划管控要素审查表）
4. 异常项自动取消 + 右下角异常提示弹窗
5. 保存草稿、读取草稿、导出 PDF、打印按钮

---

## 5. 当前已知限制 / 待完善

1. MongoDB 未启动时，草稿接口会返回 503（符合预期防错）。
2. PDF 当前为后端生成的“文本版模板”，不是最终精美排版版式。
3. “东北视角图”字段结构已预留，图片渲染与嵌入待下一步接入。
4. 需再做一轮完整联调与交互细节打磨（按钮状态、异常文案、边界提示）。

---

## 6. 下一步计划（建议）

1. 启动 Mongo 后完成草稿全链路联调（保存→读取→回填）。
2. 升级 PDF 到接近设计稿的正式模板（表格/分页/签章区细节）。
3. 接入“东北视角图”真实数据来源与展示。
4. 增加接口单测与前端最小回归用例。

---

## 7. 快速执行命令

### 7.1 导出十项原始结果

```bash
python backend/approval_checklist/scripts/export_review_results.py --model-path <model_path>
```

### 7.2 归一化为审批清单 JSON v1

```bash
python backend/approval_checklist/scripts/normalize_raw_results.py --run-dir <timestamp> --project-id <project_id>
```
