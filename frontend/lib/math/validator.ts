/**
 * 公式验证和修复器
 * 自动修复常见的公式格式错误
 */

import type { MathBlock } from './parser';

/**
 * 修复公式格式问题
 * @param formula - 原始公式内容（不含 $ 符号）
 * @returns 修复后的公式
 */
export function sanitizeFormula(formula: string): string {
  let cleaned = formula;

  // 注意：不要转义 _ 和 *，它们在 LaTeX 中是合法的（下标、上标等）。
  // remark-math 已经保护了 $...$ 区域不被 Markdown 解析器处理。

  // 1. 修复常见的 LaTeX 语法错误
  // 将 \begin{align} 转换为 \begin{aligned}（KaTeX 支持）
  cleaned = cleaned.replace(/\\begin\{align\}/g, '\\begin{aligned}');
  cleaned = cleaned.replace(/\\end\{align\}/g, '\\end{aligned}');

  // 将 \begin{equation} 转换为去掉环境（KaTeX 在 $$ 内不需要 equation 环境）
  cleaned = cleaned.replace(/\\begin\{equation\*?\}/g, '');
  cleaned = cleaned.replace(/\\end\{equation\*?\}/g, '');

  // 2. 移除多余的空格（但保留必要的空格）
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * 验证公式是否可以被 KaTeX 渲染
 * @param formula - 公式内容
 * @returns 验证结果
 */
export function validateFormula(formula: string): {
  valid: boolean;
  error?: string;
} {
  // 基本检查：不能为空
  if (!formula.trim()) {
    return { valid: false, error: '公式内容为空' };
  }

  // 检查括号配对
  const brackets = {
    '{': '}',
    '[': ']',
    '(': ')',
  };
  const stack: string[] = [];

  for (const char of formula) {
    if (char in brackets) {
      stack.push(brackets[char as keyof typeof brackets]);
    } else if (Object.values(brackets).includes(char)) {
      if (stack.length === 0 || stack.pop() !== char) {
        return { valid: false, error: '括号不配对' };
      }
    }
  }

  if (stack.length > 0) {
    return { valid: false, error: '括号不配对' };
  }

  return { valid: true };
}

/**
 * 修复文本中的所有公式
 * @param text - 包含公式的文本
 * @param blocks - 提取的公式块
 * @returns 修复后的文本
 */
export function fixMathInText(text: string, blocks: MathBlock[]): string {
  if (blocks.length === 0) return text;

  let result = text;
  let offset = 0;

  for (const block of blocks) {
    const sanitized = sanitizeFormula(block.content);
    let fixed: string;
    if (block.type === 'block') {
      // remark-math 要求块级公式 $$ 独占一行，内容在中间行
      fixed = `$$\n${sanitized}\n$$`;
    } else {
      fixed = `$${sanitized}$`;
    }

    const start = block.start + offset;
    const end = block.end + offset;

    result = result.slice(0, start) + fixed + result.slice(end);
    offset += fixed.length - (block.end - block.start);
  }

  return result;
}

/**
 * 确保块级公式前后有空行
 * @param text - 文本
 * @returns 格式化后的文本
 */
export function ensureBlockMathSpacing(text: string): string {
  // 找到所有 $$...$$ 块，只在块的前后添加空行，不修改块内部
  return text.replace(/\$\$[\s\S]*?\$\$/g, (match, offset, full) => {
    let result = match;
    // 块级公式前确保有空行（前面不是行首或已有空行）
    const before = full.slice(0, offset);
    const needBlankBefore = before.length > 0 && !/\n\s*\n\s*$/.test(before) && !before.endsWith('\n\n');
    // 块级公式后确保有空行
    const after = full.slice(offset + match.length);
    const needBlankAfter = after.length > 0 && !/^\s*\n\s*\n/.test(after) && !after.startsWith('\n\n');

    if (needBlankBefore) result = '\n' + result;
    if (needBlankAfter) result = result + '\n';
    return result;
  });
}

/**
 * 修复不配对的公式分隔符
 * @param text - 文本
 * @returns 修复后的文本
 */
export function fixUnpairedDelimiters(text: string): string {
  let result = text;

  // 修复块级公式（$$）
  const blockCount = (result.match(/\$\$/g) || []).length;
  if (blockCount % 2 !== 0) {
    // 如果是奇数个，在末尾补上
    result += '\n$$';
  }

  // 修复行内公式（$），但要排除已经被块级公式包含的部分
  const cleanText = result;
  const blockRegex = /\$\$[\s\S]*?\$\$/g;
  const blocks: Array<{ start: number; end: number }> = [];

  let match;
  while ((match = blockRegex.exec(result)) !== null) {
    blocks.push({ start: match.index, end: match.index + match[0].length });
  }

  // 统计不在块级公式内的 $ 数量
  let inlineCount = 0;
  for (let i = 0; i < result.length; i++) {
    if (result[i] === '$' && result[i + 1] !== '$' && result[i - 1] !== '$') {
      // 检查是否在块级公式内
      const inBlock = blocks.some(b => i >= b.start && i < b.end);
      if (!inBlock) {
        inlineCount++;
      }
    }
  }

  if (inlineCount % 2 !== 0) {
    // 如果是奇数个，在末尾补上
    result += '$';
  }

  return result;
}
