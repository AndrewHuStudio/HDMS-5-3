/**
 * 数学公式处理模块
 *
 * 提供完整的公式解析、验证、修复和渲染功能
 *
 * 使用方式：
 * ```tsx
 * import { MathRenderer } from '@/lib/math'
 *
 * // 流式显示时
 * <MathRenderer content={streamingContent} isStreaming={true} />
 *
 * // 完成后
 * <MathRenderer content={finalContent} isStreaming={false} />
 * ```
 */

export { MathRenderer, MathErrorFallback, MathImageFallback } from './renderer';
export { extractMathBlocks, isMathComplete, hasMath } from './parser';
export {
  sanitizeFormula,
  validateFormula,
  fixMathInText,
  ensureBlockMathSpacing,
  fixUnpairedDelimiters,
} from './validator';
export type { MathBlock } from './parser';
