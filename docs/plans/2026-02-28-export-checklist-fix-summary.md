# 管控审核清单导出功能 - 修复总结

**日期**: 2026-02-28
**状态**: 已完成
**修复时间**: 约 45 分钟

---

## 修复内容概览

修复了导出弹窗中间 A4 预览区域无法显示内容的问题，涉及 7 个核心问题：

1. **P0 严重**: useEffect 依赖数组失效导致数据永远不初始化
2. **P1 中等**: DialogContent 高度约束导致布局错误
3. **P2 较低**: 功能 ID 不匹配（5 个功能）
4. **P2 较低**: 数据结构包装错误（10 个功能）
5. **P2 较低**: 视线通廊转换函数字段不匹配
6. **P2 较低**: 绿地退线转换函数字段不匹配
7. **P2 较低**: 广场退线转换函数字段不匹配
8. **P2 较低**: 贴线率转换函数字段不匹配

---

## 修复详情

### 1. 修复 useEffect 依赖数组失效（P0）

**文件**: `frontend/features/export-checklist/dialog.tsx`

**问题**:
- 父组件每次渲染时 `features` prop 都是新对象（引用不稳定）
- `useEffect` 依赖 `[open, features]`，但 `features` 变化时 `open` 可能为 `false`
- 导致 `setItems()` 永远不会被调用

**修复方案**: 使用 `useRef` 存储 `features`，只依赖 `open`

```typescript
// 修复前
useEffect(() => {
  if (open && features.length > 0) {
    // ... 初始化逻辑
    setItems(initialItems);
  }
}, [open, features]);  // ← features 引用不稳定

// 修复后
const featuresRef = useRef(features);
featuresRef.current = features;

useEffect(() => {
  if (open && featuresRef.current.length > 0) {
    const initialItems = featuresRef.current.map((f) => {
      // ... 初始化逻辑
    });
    setItems(initialItems);
  }
}, [open]);  // ← 只依赖 open，通过 ref 读取最新 features
```

**效果**: 弹窗打开时必定触发数据初始化，不受 `features` 引用变化影响。

---

### 2. 修复 DialogContent 高度约束（P1）

**文件**: `frontend/features/export-checklist/dialog.tsx`

**问题**:
- `max-h-[90vh]` 只是最大高度限制，不是固定高度
- 内部 `flex-1` 容器无法正确计算可用高度
- 中间栏的 `overflow-y-auto` 无法正常工作

**修复方案**: 使用固定高度 + `min-h-0` 确保 flex 子元素正确计算

```typescript
// 修复前
<DialogContent className="max-w-[90vw] max-h-[90vh] p-0 flex flex-col">
  <div className="flex flex-1 overflow-hidden">

// 修复后
<DialogContent className="max-w-[90vw] h-[90vh] p-0 flex flex-col">
  <div className="flex flex-1 overflow-hidden min-h-0">
```

**效果**: 中间栏高度正确，内容可以正常滚动。

---

### 3. 修复功能 ID 不匹配和数据结构错误（P2）

#### 3.1 功能 ID 不匹配

**文件**: `frontend/features/export-checklist/utils.ts`

**问题**: `convertResultToStats` 中的 feature ID 与实际 ID 不匹配

| 实际 ID | 错误 ID | 结果 |
|---------|---------|------|
| `vehicle-entrance-check` | `vehicle-entrance` | 返回 `null` |
| `pedestrian-entrance-check` | `pedestrian-entrance` | 返回 `null` |
| `green-setback-check` | `green-setback` | 返回 `null` |
| `plaza-setback-check` | `plaza-setback` | 返回 `null` |
| `setback-rate-check` | `building-line-rate` | 返回 `null` |

**修复方案**: 更正所有 case 标签

```typescript
// 修复前
case "vehicle-entrance":
case "pedestrian-entrance":
case "green-setback":
case "plaza-setback":
case "building-line-rate":

// 修复后
case "vehicle-entrance-check":
case "pedestrian-entrance-check":
case "green-setback-check":
case "plaza-setback-check":
case "setback-rate-check":
```

**效果**: 5 个功能的统计数据现在可以正确转换。

---

#### 3.2 数据结构包装错误

**文件**: `frontend/components/approval-checklist-panel.tsx`

**问题**: `getFeatureRawState` 将 store 数据包装在额外的对象层中

```typescript
// 修复前（错误包装）
case "setback-check":
  return { result: useSetbackCheckStore.getState().result };
  // 返回 { result: { buildings: [...] } }
  // 但 convertSetbackCheckToStats 期望 { buildings: [...] }

// 修复后（直接返回）
case "setback-check":
  return useSetbackCheckStore.getState().result;
  // 返回 { buildings: [...] }
```

**特殊处理**: `fire-ladder` 和 `sky-bridge` 需要包装，因为它们的 store 存储的是数组，但转换函数期望 `{ results: [...] }` 格式

```typescript
case "fire-ladder":
  return { results: useFireLadderStore.getState().results };
case "sky-bridge":
  return { results: useSkyBridgeStore.getState().results };
```

**效果**: 所有功能的原始数据现在可以正确传递给转换函数。

---

### 4. 修复转换函数字段不匹配（P2）

#### 4.1 视线通廊检测

**文件**: `frontend/features/export-checklist/utils.ts`

**问题**:
- Store 返回 `CorridorCollisionResult` 有 `.blocked_buildings` 字段
- 转换函数期望 `.results` 字段

**修复方案**: 重写 `convertSightCorridorToStats` 使用正确的字段

```typescript
// 修复前
if (!result || !result.results) { ... }
const results = result.results || [];

// 修复后
if (!result) { ... }
const blockedBuildings = result.blocked_buildings || [];
const status = result.status || "unknown";

if (status === "clear") {
  return { summary: "视线通廊畅通，无遮挡建筑", ... };
}
```

**效果**: 视线通廊检测结果可以正确显示遮挡建筑信息。

---

#### 4.2 绿地退线检测

**文件**: `frontend/features/export-checklist/utils.ts`

**问题**:
- Store 返回 `GreenSetbackCheckResponse` 有 `.results` 字段
- 转换函数期望 `.buildings` 字段

**修复方案**: 修改字段访问路径

```typescript
// 修复前
if (!result || !result.buildings) { ... }
const buildings = result.buildings || [];

// 修复后
if (!result || !result.results) { ... }
const buildings = result.results || [];
```

**效果**: 绿地退线检测结果可以正确显示违规建筑。

---

#### 4.3 广场退线检测

**文件**: `frontend/features/export-checklist/utils.ts`

**问题**:
- Store 返回 `PlazaSetbackCheckResponse` 有 `.results` 字段
- 转换函数期望 `.buildings` 字段

**修复方案**: 修改字段访问路径（同绿地退线）

```typescript
// 修复前
if (!result || !result.buildings) { ... }
const buildings = result.buildings || [];

// 修复后
if (!result || !result.results) { ... }
const buildings = result.results || [];
```

**效果**: 广场退线检测结果可以正确显示违规建筑。

---

#### 4.4 贴线率检测

**文件**: `frontend/features/export-checklist/utils.ts`

**问题**:
- Store 返回 `SetbackCheckResult` 有 `.plots` 字段（按地块统计）
- 转换函数期望 `.results` 字段（按建筑统计）

**修复方案**: 重写转换逻辑，按地块而非建筑统计

```typescript
// 修复前
if (!result || !result.results) { ... }
const results = result.results || [];
const passed = results.filter((r: any) => r.is_compliant);

// 修复后
if (!result || !result.plots) { ... }
const plots = result.plots || [];
const passed = plots.filter((p: any) => p.is_compliant);

return {
  passed: {
    plots: passed.map((p: any) => ({
      name: p.plot_name,
      buildings: p.buildings?.map((b: any) => b.building_name) || [],
    })),
    totalPlots: passed.length,
    totalBuildings: passed.reduce((sum, p) => sum + (p.buildings?.length || 0), 0),
  },
  // ...
  summary: `总计：${plots.length} 个地块，${passed.length} 个通过，${failed.length} 个不符合`,
};
```

**效果**: 贴线率检测结果可以正确显示地块级别的统计信息。

---

### 5. 清理调试日志

**文件**: `frontend/features/export-checklist/dialog.tsx`

移除了以下调试日志：
- `console.log('Feature:', f.id, 'Stats:', detailedStats);`
- `console.log('Initial items:', initialItems);`
- `console.log('MiddlePreview items:', items);`

---

## 修复后的数据流

```
用户打开导出弹窗
  ↓
open = true 触发 useEffect
  ↓
通过 featuresRef.current 读取最新 features
  ↓
遍历 features，调用 getFeatureRawState(id)
  ↓
获取 store 中的原始数据（不包装）
  ↓
调用 convertResultToStats(id, rawResult)
  ↓
根据正确的 feature ID 匹配转换函数
  ↓
返回 DetailedStatistics 对象
  ↓
setItems(initialItems) 更新状态
  ↓
MiddlePreview 渲染 A4 预览内容
```

---

## 测试验证

### 功能测试
- [x] 打开导出弹窗，中间栏显示标题和日期
- [x] 中间栏显示所有检测项（10个）
- [x] 每个检测项显示详细统计信息（不再是 `null`）
- [x] 左侧栏显示检测项列表
- [x] 右侧栏显示功能按钮

### 布局测试
- [x] 弹窗尺寸为 90vw × 90vh
- [x] 中间栏可以正常滚动
- [x] A4 页面居中显示
- [x] 内容不被截断

### 数据测试
- [x] 所有检测项的 `detailedStats` 不为 `null`（如果有检测数据）
- [x] 通过/不通过地块信息正确显示
- [x] 建筑名称和数量正确
- [x] 总计信息准确

---

## 修改文件清单

| 文件 | 修改内容 | 行数 |
|------|---------|------|
| `frontend/features/export-checklist/dialog.tsx` | 修复 useEffect 依赖 + 高度约束 + 清理日志 | 3 处 |
| `frontend/features/export-checklist/utils.ts` | 修复功能 ID 不匹配 | 5 处 |
| `frontend/components/approval-checklist-panel.tsx` | 修复数据结构包装 | 8 处 |
| `docs/plans/2026-02-28-export-checklist-display-issue-analysis.md` | 更新状态为"已修复" | 1 处 |

---

## 关键经验总结

1. **React Hooks 依赖数组**: 当 prop 是对象/数组时，父组件每次渲染都会创建新引用。使用 `useRef` 可以避免不必要的 effect 触发。

2. **Flexbox 高度计算**: `flex-1` 需要父容器有明确高度才能正确计算。使用 `h-[90vh]` 而不是 `max-h-[90vh]`，并添加 `min-h-0` 确保子元素不会撑开父容器。

3. **数据结构一致性**: 确保数据提供方（store）和数据消费方（转换函数）的结构一致。不要在中间层添加不必要的包装。

4. **功能 ID 命名**: 保持 feature ID 在整个代码库中的一致性。使用 TypeScript 的 union type 可以在编译时捕获不匹配。

---

## 后续建议

1. **类型安全**: 为 `getFeatureRawState` 添加返回类型，确保与转换函数的输入类型匹配。

2. **单元测试**: 为 `convertResultToStats` 添加单元测试，覆盖所有 10 个功能的数据转换。

3. **性能优化**: 考虑使用 `useMemo` 缓存 `features` 数组（在父组件中），避免每次渲染都创建新对象。

4. **错误处理**: 当 store 数据为空时，显示更友好的提示信息（如"请先运行检测"）。

---

**修复完成时间**: 2026-02-28
**修复人员**: Claude Opus 4.6
**文档版本**: v1.0
