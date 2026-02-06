# 消防登高面检测：协作开发说明（只新增、不修改）

> 目标：新功能以“独立模块”方式开发，**不修改、不删除**现有代码，只允许新增文件与新增模块目录。

## 一、前端模块创建位置
请在以下目录新增模块（仅新增文件）：

```
frontend/
  features/
    fire-ladder/
      registry.ts   # 功能注册（必须）
      panel.tsx     # 右侧面板 UI
      scene.tsx     # 3D 场景叠加层（可选）
      store.ts      # Zustand 状态
      api.ts        # 接口封装
      types.ts      # 类型定义
```

说明：
- `registry.ts` 负责注册功能（工具名称、图标、Panel、SceneLayer 等）。
- `panel.tsx` 只负责 UI + 交互，业务状态放 `store.ts`。
- `scene.tsx` 用于 3D 标注/高亮（如果不需要可返回 `null`）。
- **不要修改**其他已有 feature 目录。

## 二、允许调用的公共模块（只可“引用”，不可修改旧文件）
以下公共模块可直接引用：

**前端公共 UI 与场景基础：**
- `frontend/components/ui/*`（通用 UI 组件）
- `frontend/components/common/*`（跨功能 UI，若需新增请在此新增文件）
- `frontend/components/scene/*`（场景公共组件/上下文）
- `frontend/components/scene/scene-context.tsx`（获取场景数据 `useSceneSnapshot`）

**前端工具与注册：**
- `frontend/lib/registries/tool-registry.ts`（注册工具）
- `frontend/lib/stores/model-store.ts`（模型/上传数据）
- `frontend/features/shared/*`（如需公共工具函数，请新增到这里）

> 重要：公共模块允许“新增文件/新增导出”，**不允许修改或删除已有文件内容**。

## 三、后端模块创建位置
新增后端功能文件夹（仅新增文件）：

```
services/
  rhino-api/
    rhino_api/
      features/
        fire_ladder/
          api.py      # 路由
          service.py  # 业务计算
          __init__.py
```

说明：
- `api.py` 定义接口，调用 `service.py`。
- `service.py` 做实际算法实现。
- 后端会自动扫描 `features` 目录，无需修改 `main.py`。

**后端可调用的公共模块（只可引用）：**
- `rhino_api/core/config.py`
- `rhino_api/services/rhino_model.py`
- `rhino_api/core/utils.py`
- 以及其它已有 `services/*` 模块

如需公共功能，请**新增**一个文件到 `rhino_api/core/` 或 `rhino_api/services/`，不要改旧文件。

## 四、禁止修改的内容（强约束）
- 不修改任何已有 feature 的文件（如 `height-check` / `setback-check` / `sight-corridor`）。
- 不修改 `frontend/app/page.tsx`、`frontend/components/city-scene.tsx` 等核心文件。
- 不删除、不重命名任何既有文件或目录。

## 五、协作流程建议
- 从 `collab 1.0` 拉分支开发。
- 仅提交新增文件，避免触碰旧文件。
- 如必须共享功能，**新增**到 `features/shared` 或 `components/common`。

---
如有新增模块位置或公共调用范围不清楚，请先和我确认后再写。  
