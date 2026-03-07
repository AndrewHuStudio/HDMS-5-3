/**
 * 公式渲染组件
 * 负责安全地渲染数学公式，支持流式显示和错误处理
 */
"use client";

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import { extractMathBlocks, isMathComplete } from './parser';
import {
  fixMathInText,
  ensureBlockMathSpacing,
  fixUnpairedDelimiters
} from './validator';

interface MathRendererProps {
  content: string;
  isStreaming?: boolean;
  components?: Partial<Components>;
  className?: string;
}

/**
 * 数学公式渲染器
 *
 * 核心特性：
 * 1. 流式显示时不渲染公式（显示原始文本）
 * 2. 完成后自动修复公式格式并渲染
 * 3. 渲染失败时显示友好提示
 */
export function MathRenderer({
  content,
  isStreaming = false,
  components,
  className,
}: MathRendererProps) {

  // 处理后的内容
  const processedContent = useMemo(() => {
    if (!content) return '';

    // 流式显示时，如果公式不完整，直接返回原始文本
    if (isStreaming && !isMathComplete(content)) {
      return content;
    }

    // 完成后，修复公式格式
    let processed = content;

    // 1. 修复不配对的分隔符
    processed = fixUnpairedDelimiters(processed);

    // 2. 提取公式块并修复
    const mathBlocks = extractMathBlocks(processed);
    processed = fixMathInText(processed, mathBlocks);

    // 3. 确保块级公式前后有空行
    processed = ensureBlockMathSpacing(processed);

    return processed;
  }, [content, isStreaming]);

  // 流式显示时，显示原始文本（不渲染公式）
  if (isStreaming) {
    return (
      <div className={className}>
        <div className="whitespace-pre-wrap break-words">
          {processedContent}
        </div>
      </div>
    );
  }

  // 完成后，渲染 Markdown + 公式
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[
          [remarkGfm, { singleTilde: false }],
          remarkMath,
        ]}
        rehypePlugins={[
          [rehypeKatex, {
            strict: false,
            trust: true,
            throwOnError: false,
            errorColor: '#cc0000',
          }],
        ]}
        components={components}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}

/**
 * 公式渲染错误处理组件
 * 当 KaTeX 渲染失败时显示友好提示
 */
export function MathErrorFallback({ formula }: { formula: string }) {
  return (
    <span
      className="inline-block bg-yellow-50 dark:bg-yellow-900/20 px-2 py-1 rounded text-xs text-yellow-800 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-800"
      title="公式渲染失败"
    >
      [公式: {formula}]
    </span>
  );
}

/**
 * 图片渲染兜底方案
 * 当 KaTeX 完全失败时，使用在线服务渲染公式为图片
 */
export function MathImageFallback({ formula, type = 'inline' }: {
  formula: string;
  type?: 'inline' | 'block';
}) {
  const encoded = encodeURIComponent(formula);
  const src = `https://latex.codecogs.com/svg.latex?${encoded}`;

  return (
    <img
      src={src}
      alt={formula}
      className={type === 'block' ? 'block my-4 mx-auto' : 'inline-block align-middle mx-1'}
      style={{ maxHeight: type === 'block' ? '300px' : '1.5em' }}
      onError={(e) => {
        // 如果图片也加载失败，显示文本兜底
        const target = e.target as HTMLImageElement;
        target.style.display = 'none';
        const fallback = document.createElement('span');
        fallback.className = 'text-red-500 text-xs';
        fallback.textContent = `[公式渲染失败: ${formula}]`;
        target.parentNode?.insertBefore(fallback, target);
      }}
    />
  );
}
