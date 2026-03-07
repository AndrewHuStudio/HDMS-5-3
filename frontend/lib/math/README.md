# 公式处理模块

独立的数学公式处理模块，确保公式在流式输出和最终渲染时都能正确显示。

## 功能特性

### 1. 流式显示优化
- 流式输出时，如果公式不完整，显示原始文本（不渲染）
- 等答案完整后，再统一渲染所有公式
- 避免公式渲染一半导致的乱码问题

### 2. 自动修复格式
- 自动修复不配对的 `$` 符号
- 转义 Markdown 特殊字符（`_` `*`）
- 转换不支持的 LaTeX 语法（如 `\begin{align}` → `\begin{aligned}`）
- 确保块级公式前后有空行

### 3. 错误处理
- KaTeX 渲染失败时显示友好提示
- 提供图片渲染兜底方案（在线 LaTeX 渲染服务）

## 模块结构

```
lib/math/
├── parser.ts       # 公式解析和提取
├── validator.ts    # 公式验证和修复
├── renderer.tsx    # React 渲染组件
├── index.ts        # 统一导出
└── __tests__/      # 单元测试
    ├── parser.test.ts
    └── validator.test.ts
```

## 使用方式

### 基础用法

```tsx
import { MathRenderer } from '@/lib/math'

// 流式显示时
<MathRenderer content={streamingContent} isStreaming={true} />

// 完成后
<MathRenderer content={finalContent} isStreaming={false} />
```

### 在 QAMarkdownRenderer 中使用

```tsx
import { isMathComplete, fixUnpairedDelimiters, extractMathBlocks, fixMathInText, ensureBlockMathSpacing } from '@/lib/math';

// 处理公式
const processedMarkdown = useMemo(() => {
  if (!markdown) return '';

  // 流式显示时，如果公式不完整，直接返回原始文本
  if (isStreaming && !isMathComplete(markdown)) {
    return markdown;
  }

  // 完成后，修复公式格式
  let processed = markdown;
  processed = fixUnpairedDelimiters(processed);
  const mathBlocks = extractMathBlocks(processed);
  processed = fixMathInText(processed, mathBlocks);
  processed = ensureBlockMathSpacing(processed);

  return processed;
}, [markdown, isStreaming]);
```

## API 文档

### parser.ts

#### `extractMathBlocks(text: string): MathBlock[]`
从文本中提取所有数学公式块。

**返回值**：
```typescript
interface MathBlock {
  type: 'inline' | 'block';  // 行内或块级
  content: string;            // 公式内容（不含 $ 符号）
  start: number;              // 起始位置
  end: number;                // 结束位置
  raw: string;                // 原始文本（含 $ 符号）
}
```

#### `isMathComplete(text: string): boolean`
检查文本中的公式是否完整（所有 `$` 符号都配对）。

#### `hasMath(text: string): boolean`
检测文本中是否包含数学公式。

### validator.ts

#### `sanitizeFormula(formula: string): string`
修复公式格式问题：
- 转义 Markdown 特殊字符
- 转换不支持的 LaTeX 语法
- 移除多余空格

#### `validateFormula(formula: string): { valid: boolean; error?: string }`
验证公式是否可以被 KaTeX 渲染。

#### `fixMathInText(text: string, blocks: MathBlock[]): string`
修复文本中的所有公式。

#### `ensureBlockMathSpacing(text: string): string`
确保块级公式前后有空行。

#### `fixUnpairedDelimiters(text: string): string`
修复不配对的公式分隔符（自动补全缺失的 `$`）。

### renderer.tsx

#### `<MathRenderer />`
主渲染组件。

**Props**：
```typescript
interface MathRendererProps {
  content: string;              // 文本内容
  isStreaming?: boolean;        // 是否正在流式输出
  components?: Partial<Components>;  // 自定义组件
  className?: string;           // 样式类名
}
```

#### `<MathErrorFallback />`
公式渲染失败时的友好提示组件。

#### `<MathImageFallback />`
使用在线服务渲染公式为图片的兜底方案。

## 工作原理

### 流式显示流程

```
1. AI 开始输出答案（一个字一个字）
   ↓
2. 检测到公式开始符号 $
   ↓
3. 判断公式是否完整（isMathComplete）
   ├─ 不完整 → 显示原始文本 "$x^2 +"
   └─ 完整   → 渲染公式
   ↓
4. 答案输出完成（isStreaming = false）
   ↓
5. 修复所有公式格式
   ↓
6. 统一渲染
```

### 公式修复流程

```
原始文本: "公式 $x_2 + y_3$ 结束"
   ↓
1. fixUnpairedDelimiters
   检查 $ 符号配对 → 通过
   ↓
2. extractMathBlocks
   提取公式块: [{ type: 'inline', content: 'x_2 + y_3', ... }]
   ↓
3. fixMathInText
   修复每个公式:
   - sanitizeFormula('x_2 + y_3')
   - 转义下划线: 'x\_2 + y\_3'
   ↓
4. ensureBlockMathSpacing
   确保块级公式前后有空行（此例无块级公式）
   ↓
最终文本: "公式 $x\_2 + y\_3$ 结束"
```

## 测试

运行单元测试：

```bash
npm test lib/math
```

测试覆盖：
- 公式提取（行内/块级/多个）
- 公式完整性检测
- 格式修复（转义/配对/空行）
- 边界情况（空公式/嵌套/转义）

## 注意事项

1. **流式显示时不要渲染不完整的公式**
   - 会导致 KaTeX 报错或显示乱码
   - 使用 `isMathComplete` 检测

2. **修复顺序很重要**
   - 先修复配对 → 再提取公式 → 再修复内容 → 最后调整空行

3. **不要过度转义**
   - 只转义会被 Markdown 解析的字符
   - LaTeX 命令中的特殊字符不要转义

4. **兜底方案**
   - KaTeX 失败 → 显示友好提示
   - 如果需要 100% 渲染 → 使用图片兜底

## 未来优化

- [ ] 支持更多 LaTeX 语法转换
- [ ] 缓存公式渲染结果
- [ ] 支持自定义渲染器（MathJax）
- [ ] 公式编辑器集成
