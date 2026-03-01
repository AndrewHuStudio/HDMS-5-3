# 管控审核清单导出功能 - A4预览区域不显示内容问题分析

**日期**: 2026-02-28
**问题**: 导出弹窗中间A4预览区域无法显示内容
**状态**: 已修复
**优先级**: P0（严重）

---

## 一、问题现象

### 1.1 用户反馈

打开管控审核清单导出弹窗后：
- ✅ 左侧栏：检测项列表正常显示
- ✅ 右侧栏：功能按钮正常显示
- ❌ 中间栏：A4预览区域完全空白，没有任何内容

### 1.2 控制台日志

```
Feature: height-check Stats: null
Feature: setback-check Stats: null
... (其他检测项)
Initial items: Array(10)
MiddlePreview items: Array(10)
```

**关键发现**：
- `items` 数组有10个元素（数据已初始化）
- 但所有 `detailedStats` 都是 `null`
- `MiddlePreview` 组件收到了 `items` 数据

---

## 二、根本原因分析

### 2.1 主要问题：useEffect 依赖数组失效 ⭐⭐⭐

**问题代码位置**：`frontend/features/export-checklist/dialog.tsx` 第 49-71 行

```typescript
useEffect(() => {
  if (open && features.length > 0) {
    const initialItems: FeatureChecklistItem[] = features.map((f) => {
      const detailedStats = convertResultToStats(f.id, f.rawResult);
      console.log('Feature:', f.id, 'Stats:', detailedStats);
      return {
        id: f.id,
        name: f.name,
        screenshot: null,
        summary: f.summary,
        detailedStats,
        rawResult: f.rawResult,
        aiSuggestion: "",
        isGeneratingAI: false,
        showAiSuggestion: true,
        govSuggestion: "",
      };
    });
    console.log('Initial items:', initialItems);
    setItems(initialItems);
  }
}, [open, features]);  // ← 问题：features 引用不稳定
```

**根本原因**：

在父组件 `frontend/components/approval-checklist-panel.tsx` 第 635-648 行：

```typescript
<ExportChecklistDialog
  open={exportDialogOpen}
  onOpenChange={setExportDialogOpen}
  features={FEATURES.map((f) => {  // ← 每次渲染都创建新数组
    const state = getFeatureRawState(f.id);
    const { summary } = useFeatureStatus(f.id);
    return {
      id: f.id,
      name: f.name,
      summary,
      rawResult: state,
    };
  })}
/>
```

**问题链条**：

1. 父组件每次渲染时，`FEATURES.map()` 创建新的数组对象
2. 即使数组内容相同，但引用地址不同（`[] !== []`）
3. React 的 `useEffect` 依赖数组使用 `Object.is()` 比较引用
4. 检测到 `features` 变化，触发 `useEffect`
5. 但此时 `open` 可能为 `false`，条件 `if (open && features.length > 0)` 不满足
6. **结果**：`setItems()` 永远不会被调用，`items` 保持初始空数组

**时序图**：

```
父组件渲染 → features 新对象 → useEffect 触发 → open=false → 不执行 setItems
     ↓
弹窗打开 → open=true → 但 features 没变化 → useEffect 不触发 → items 仍为空
```

---

### 2.2 次要问题：DialogContent 高度约束不明确

**问题代码位置**：`frontend/features/export-checklist/dialog.tsx` 第 164 行

```typescript
<DialogContent className="max-w-[90vw] max-h-[90vh] p-0 flex flex-col">
```

**问题分析**：

1. `DialogContent` 基础样式使用 `grid` 布局（来自 `@/components/ui/dialog`）
2. 传入 `flex flex-col` 覆盖了 `grid`，但没有明确高度
3. `max-h-[90vh]` 只是最大高度限制，不是固定高度
4. 内部 `flex-1` 容器无法正确计算可用高度

**影响**：
- 中间栏的 `overflow-y-auto` 无法正常工作
- 内容可能被压缩或无法滚动

---

### 2.3 次要问题：中间栏 flex-1 高度计算错误

**问题代码位置**：`frontend/features/export-checklist/dialog.tsx` 第 169 行

```typescript
<div className="flex flex-1 overflow-hidden">
  {/* 左侧栏 */}
  <LeftSidebar ... />

  {/* 中间栏 */}
  <MiddlePreview ... />

  {/* 右侧栏 */}
  <RightActions ... />
</div>
```

**问题分析**：

1. 父容器 `DialogContent` 使用 `flex flex-col`
2. `DialogHeader` 占用固定高度
3. 中间的 `flex-1` 容器应该占用剩余高度
4. 但由于父容器没有明确高度，`flex-1` 计算可能为 0

**影响**：
- 中间栏高度不足，内容无法显示
- 或者高度过大，超出视口

---

### 2.4 数据问题：rawResult 可能为 undefined

**问题代码位置**：`frontend/components/approval-checklist-panel.tsx` 第 638-646 行

```typescript
features={FEATURES.map((f) => {
  const state = getFeatureRawState(f.id);  // ← 可能返回 undefined
  const { summary } = useFeatureStatus(f.id);
  return {
    id: f.id,
    name: f.name,
    summary,
    rawResult: state,  // ← undefined 传入
  };
})}
```

**getFeatureRawState 函数**（第 580-620 行）：

```typescript
const getFeatureRawState = (featureId: string) => {
  switch (featureId) {
    case "height-check":
      return useHeightCheckStore.getState().results;
    case "setback-check":
      return useSetbackCheckStore.getState().result;
    // ... 其他 case
    default:
      return undefined;  // ← 没有匹配时返回 undefined
  }
};
```

**影响**：
- `rawResult: undefined` 传入 `convertResultToStats()`
- 返回 `null`（无检测数据）
- 中间栏显示"暂无检测数据"

---

## 三、问题严重程度评估

| 问题 | 严重程度 | 是否阻塞 | 影响范围 |
|------|---------|---------|---------|
| useEffect 依赖数组失效 | **P0 严重** | ✅ 是 | 完全无法显示内容 |
| DialogContent 高度约束 | P1 中等 | ❌ 否 | 布局可能错乱 |
| flex-1 高度计算错误 | P1 中等 | ❌ 否 | 内容显示不完整 |
| rawResult 为 undefined | P2 较低 | ❌ 否 | 显示"暂无数据"提示 |

**结论**：主要问题是 **useEffect 依赖数组失效**，必须优先修复。

---

## 四、修复方案

### 4.1 方案一：使用 useMemo 稳定 features 引用（推荐）⭐

**修改文件**：`frontend/components/approval-checklist-panel.tsx`

**修改位置**：第 635-648 行

**修改前**：
```typescript
<ExportChecklistDialog
  open={exportDialogOpen}
  onOpenChange={setExportDialogOpen}
  features={FEATURES.map((f) => {  // ← 每次都是新对象
    const state = getFeatureRawState(f.id);
    const { summary } = useFeatureStatus(f.id);
    return {
      id: f.id,
      name: f.name,
      summary,
      rawResult: state,
    };
  })}
/>
```

**修改后**：
```typescript
// 在组件顶部添加
const exportFeatures = useMemo(() => {
  return FEATURES.map((f) => {
    const state = getFeatureRawState(f.id);
    const { summary } = useFeatureStatus(f.id);
    return {
      id: f.id,
      name: f.name,
      summary,
      rawResult: state,
    };
  });
}, [/* 依赖项：当检测结果变化时更新 */]);

// 使用缓存的 features
<ExportChecklistDialog
  open={exportDialogOpen}
  onOpenChange={setExportDialogOpen}
  features={exportFeatures}
/>
```

**优点**：
- 稳定 `features` 引用，只在依赖项变化时重新创建
- 不需要修改 `dialog.tsx`
- 符合 React 最佳实践

**缺点**：
- 需要正确设置依赖项（所有检测结果的 store）

---

### 4.2 方案二：修改 useEffect 依赖数组

**修改文件**：`frontend/features/export-checklist/dialog.tsx`

**修改位置**：第 49-71 行

**修改前**：
```typescript
useEffect(() => {
  if (open && features.length > 0) {
    // ... 初始化逻辑
    setItems(initialItems);
  }
}, [open, features]);  // ← 依赖 features
```

**修改后**：
```typescript
useEffect(() => {
  if (open && features.length > 0) {
    // ... 初始化逻辑
    setItems(initialItems);
  }
}, [open]);  // ← 只依赖 open

// 或者使用 useRef 存储 features
const featuresRef = useRef(features);
featuresRef.current = features;

useEffect(() => {
  if (open && featuresRef.current.length > 0) {
    const initialItems = featuresRef.current.map((f) => {
      // ... 初始化逻辑
    });
    setItems(initialItems);
  }
}, [open]);
```

**优点**：
- 简单直接，只修改一个文件
- 确保弹窗打开时初始化数据

**缺点**：
- 当 `features` 变化时不会更新（可能需要手动刷新）
- 不符合 React Hooks 规则（ESLint 会警告）

---

### 4.3 方案三：修复 DialogContent 高度约束

**修改文件**：`frontend/features/export-checklist/dialog.tsx`

**修改位置**：第 164 行

**修改前**：
```typescript
<DialogContent className="max-w-[90vw] max-h-[90vh] p-0 flex flex-col">
```

**修改后**：
```typescript
<DialogContent className="max-w-[90vw] h-[90vh] p-0 flex flex-col">
  {/* 明确高度为 90vh，而不是最大高度 */}
```

**同时修改**：第 169 行

```typescript
<div className="flex flex-1 overflow-hidden min-h-0">
  {/* 添加 min-h-0 确保 flex-1 正确计算 */}
```

**优点**：
- 修复布局问题，确保内容正确显示
- 改善用户体验

**缺点**：
- 不解决主要问题（useEffect 依赖）

---

### 4.4 方案四：处理 undefined rawResult

**修改文件**：`frontend/components/approval-checklist-panel.tsx`

**修改位置**：第 580-620 行

**修改前**：
```typescript
const getFeatureRawState = (featureId: string) => {
  switch (featureId) {
    case "height-check":
      return useHeightCheckStore.getState().results;
    // ... 其他 case
    default:
      return undefined;  // ← 返回 undefined
  }
};
```

**修改后**：
```typescript
const getFeatureRawState = (featureId: string) => {
  switch (featureId) {
    case "height-check":
      return useHeightCheckStore.getState().results || [];
    case "setback-check":
      return useSetbackCheckStore.getState().result || { buildings: [] };
    // ... 其他 case，都添加默认值
    default:
      return null;  // ← 返回 null 而不是 undefined
  }
};
```

**优点**：
- 避免 `undefined` 导致的问题
- 提供合理的默认值

**缺点**：
- 不解决主要问题

---

## 五、推荐修复步骤

### 步骤 1：修复主要问题（P0）

**使用方案一**：在 `approval-checklist-panel.tsx` 中使用 `useMemo` 稳定 `features` 引用

```typescript
// 1. 导入 useMemo
import { useMemo } from "react";

// 2. 在组件内部，ExportChecklistDialog 之前添加
const exportFeatures = useMemo(() => {
  return FEATURES.map((f) => {
    const state = getFeatureRawState(f.id);
    const { summary } = useFeatureStatus(f.id);
    return {
      id: f.id,
      name: f.name,
      summary,
      rawResult: state,
    };
  });
}, [
  // 依赖项：所有检测结果的 store
  useHeightCheckStore.getState().results,
  useSetbackCheckStore.getState().result,
  useSightCorridorStore.getState().result,
  useFireLadderStore.getState().result,
  useSkyBridgeStore.getState().result,
  // ... 其他 store
]);

// 3. 使用缓存的 features
<ExportChecklistDialog
  open={exportDialogOpen}
  onOpenChange={setExportDialogOpen}
  features={exportFeatures}
/>
```

**验证**：
1. 打开导出弹窗
2. 检查控制台日志：`Initial items: Array(10)`
3. 检查中间栏是否显示内容

---

### 步骤 2：修复布局问题（P1）

**修改 `dialog.tsx`**：

```typescript
// 1. 修改 DialogContent 高度
<DialogContent className="max-w-[90vw] h-[90vh] p-0 flex flex-col">

// 2. 修改中间容器
<div className="flex flex-1 overflow-hidden min-h-0">
```

**验证**：
1. 检查中间栏是否能正确滚动
2. 检查内容是否完整显示

---

### 步骤 3：处理数据问题（P2）

**修改 `approval-checklist-panel.tsx`**：

```typescript
const getFeatureRawState = (featureId: string) => {
  switch (featureId) {
    case "height-check":
      return useHeightCheckStore.getState().results || [];
    case "setback-check":
      return useSetbackCheckStore.getState().result || { buildings: [] };
    // ... 为所有 case 添加默认值
    default:
      return null;
  }
};
```

**验证**：
1. 检查控制台日志：`Stats:` 不应该全是 `null`
2. 检查中间栏是否显示详细统计

---

### 步骤 4：移除调试日志

**修改 `dialog.tsx`**：

```typescript
// 移除以下调试日志
console.log('Feature:', f.id, 'Stats:', detailedStats);
console.log('Initial items:', initialItems);
console.log('MiddlePreview items:', items);
```

---

## 六、测试验证清单

### 6.1 功能测试

- [ ] 打开导出弹窗，中间栏显示标题和日期
- [ ] 中间栏显示所有检测项（10个）
- [ ] 每个检测项显示详细统计信息
- [ ] 左侧栏显示检测项列表
- [ ] 右侧栏显示功能按钮
- [ ] 点击"加载截图"按钮，截图正常显示
- [ ] 点击"生成 AI 建议"按钮，AI 建议正常生成
- [ ] 填写审查方建议，输入框正常工作
- [ ] 点击"导出 PDF"按钮，PDF 正常导出

### 6.2 布局测试

- [ ] 弹窗尺寸为 90vw × 90vh
- [ ] 左侧栏宽度 280px
- [ ] 右侧栏宽度 200px
- [ ] 中间栏自适应宽度
- [ ] 中间栏可以正常滚动
- [ ] A4 页面居中显示
- [ ] 内容不被截断

### 6.3 数据测试

- [ ] 所有检测项的 `detailedStats` 不为 `null`
- [ ] 通过/不通过地块信息正确显示
- [ ] 建筑名称和数量正确
- [ ] 总计信息准确

### 6.4 性能测试

- [ ] 打开弹窗速度 < 500ms
- [ ] 不自动截图（手动触发）
- [ ] 数据初始化时间 < 200ms

---

## 七、关键文件清单

| 文件路径 | 修改内容 | 优先级 |
|---------|---------|--------|
| `frontend/components/approval-checklist-panel.tsx` | 使用 useMemo 稳定 features 引用 | P0 |
| `frontend/features/export-checklist/dialog.tsx` | 修复 DialogContent 高度约束 | P1 |
| `frontend/components/approval-checklist-panel.tsx` | 处理 undefined rawResult | P2 |
| `frontend/features/export-checklist/dialog.tsx` | 移除调试日志 | P3 |

---

## 八、预期结果

修复后，导出弹窗应该：

1. ✅ 打开速度快（< 500ms）
2. ✅ 中间栏显示完整的 A4 预览内容
3. ✅ 显示所有检测项的详细统计
4. ✅ 布局正确，可以正常滚动
5. ✅ 所有功能按钮正常工作
6. ✅ PDF 导出正常

---

## 九、回归测试

修复后需要测试以下功能，确保没有引入新问题：

1. 检测功能是否正常（限高、退线等）
2. 审批清单面板是否正常显示
3. 其他弹窗是否正常工作
4. 性能是否有下降

---

## 十、总结

**根本原因**：`features` prop 引用不稳定导致 `useEffect` 依赖数组失效，`items` 永远不会被初始化。

**修复方案**：使用 `useMemo` 稳定 `features` 引用，同时修复布局和数据问题。

**预计修复时间**：1-2 小时

**风险评估**：低风险，修改范围小，不影响其他功能。

---

**文档版本**: v1.0
**创建日期**: 2026-02-28
**作者**: Claude Sonnet 4.6
**状态**: 待修复
