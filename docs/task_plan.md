# Task Plan: 管控资料上传一级面板前端改造

## Goal
在不改动后端业务逻辑的前提下，完成“管控资料上传”一级面板前端框架，并实现严格串行的 4 个滚动板块（OCR、向量化、图谱化、一键校验），同时保持现有系统视觉风格一致。

## Current Phase
Complete

## Phases
### Phase 1: Requirements & Discovery
- [x] 确认产品分区与导航顺序（1/2/3/4）
- [x] 确认“管控资料上传”使用无 3D 主视口、无右侧详情栏的独立页面布局
- [x] 确认一键校验需要展示全流程统计信息
- **Status:** complete

### Phase 2: UI/State 设计
- [x] 设计新视图 ID 与导航数据结构
- [x] 设计“资料上传页”占位模块结构与视觉层级
- [x] 设计 page.tsx 条件布局切换逻辑
- **Status:** complete

### Phase 3: 实现
- [x] 新增资料上传页面组件（四大板块）
- [x] 调整导航配置与 ActiveView 类型
- [x] 调整主页面布局分支（数据上传页 vs 现有三维工作台）
- **Status:** complete

### Phase 4: 验证
- [x] 运行自动化验证（pytest + Next.js webpack build）
- [x] 人工核查关键交互代码路径（菜单切换、滚动页面、标题映射）
- **Status:** complete

### Phase 5: 交付
- [x] 汇总改动文件与验证结果
- [x] 向用户说明后续接入后端的挂接点
- **Status:** complete

## Key Questions
1. 严格串行是否允许暂存“跳过步骤”入口？（当前按“仅展示”实现，不提供跳过）
2. 一键校验是否展示实时计算？（当前按占位统计展示）

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 采用新增一级视图 `data-upload` | 满足 1/2/3/4 产品分区要求 |
| 资料上传使用独立滚动主内容区 | 符合“无 3D 主视口/无右侧栏”的 UX 要求 |
| 四个板块先做占位结构 | 当前阶段只做前端框架，保留后续接口挂接空间 |
| 默认打开 `data-upload` 视图 | 进入系统即能看到新资料上传流程 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| 
pm run lint` 缺少 eslint 可执行文件 | 1 | 改用 
px next build --webpack` 做构建与类型校验 |
| 
pm run build` 在 Next16 默认 Turbopack 下报配置错误 | 1 | 使用 
px next build --webpack` 与项目现有 webpack 配置兼容 |

## Notes
- 保持现有 UI 风格，复用 Card、Badge、Button、Separator 等基础组件。
- 新增 pytest 前端骨架校验用例，已完成红绿验证。


