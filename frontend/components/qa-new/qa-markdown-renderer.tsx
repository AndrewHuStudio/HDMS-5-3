/**
 * QA Markdown 渲染器
 * 使用 ReactMarkdown + rehype-katex 渲染答案内容，
 * 组合表格/图片/引用三个独立子模块的渲染组件。
 */
"use client";

import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import type { PluggableList } from "unified";
import { QA_REMARK_PLUGINS } from "@/lib/qa-markdown-plugins";
import { cn } from "@/lib/utils";
import { isMathComplete, fixUnpairedDelimiters, extractMathBlocks, fixMathInText, ensureBlockMathSpacing } from "@/lib/math";
import { QA_HEADING_COMPONENTS } from "@/features/qa/render/heading-components";
import { renderOrdinalParagraph } from "@/features/qa/render/ordinal-rendering";
import { QA_TABLE_COMPONENTS } from "./md-table-components";
import { buildImageComponent } from "./md-image-components";
import {
  FIGURE_CAPTION_TEXT_RE,
  TABLE_NOTE_TEXT_RE,
  highlightRetrievalDocNames,
  flattenReactText,
  stripLeadingFigcaptionPrefix,
} from "./md-reference-components";

/* ------------------------------------------------------------------ */
/*  QAMarkdownRenderer                                                */
/* ------------------------------------------------------------------ */

interface QAMarkdownRendererProps {
  markdown: string;
  remarkPlugins?: PluggableList;
  rehypePlugins?: PluggableList;
  /** Extra component overrides merged on top of built-in defaults */
  componentOverrides?: Partial<Components>;
  showStreamingCursor?: boolean;
  onImageClick?: (src: string) => void;
  className?: string;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
}

export function QAMarkdownRenderer({
  markdown,
  remarkPlugins = QA_REMARK_PLUGINS,
  rehypePlugins,
  componentOverrides,
  showStreamingCursor,
  onImageClick,
  className,
  isStreaming = false,
}: QAMarkdownRendererProps) {
  const markdownRef = useRef<HTMLDivElement>(null);

  // 处理公式：流式时如果公式不完整则不渲染，完成后自动修复格式
  const processedMarkdown = useMemo(() => {
    if (!markdown) return '';

    // 流式显示时，如果公式不完整，直接返回原始文本
    if (isStreaming && !isMathComplete(markdown)) {
      return markdown;
    }

    // 完成后，修复公式格式
    let processed = markdown;

    // 1. 修复不配对的分隔符
    processed = fixUnpairedDelimiters(processed);

    // 2. 提取公式块并修复
    const mathBlocks = extractMathBlocks(processed);
    processed = fixMathInText(processed, mathBlocks);

    // 3. 确保块级公式前后有空行
    processed = ensureBlockMathSpacing(processed);

    return processed;
  }, [markdown, isStreaming]);

  // Detect overflowing KaTeX display formulas and add scroll-hint class.
  useEffect(() => {
    const el = markdownRef.current;
    if (!el) return;
    const displays = el.querySelectorAll<HTMLElement>(".katex-display");
    displays.forEach((d) => {
      if (d.scrollWidth > d.clientWidth + 2) {
        d.classList.add("katex-overflow");
      } else {
        d.classList.remove("katex-overflow");
      }
    });
  }, [processedMarkdown]);

  const defaultComponents: Partial<Components> = useMemo(() => ({
    ...QA_HEADING_COMPONENTS,
    ...QA_TABLE_COMPONENTS,
    img: buildImageComponent(onImageClick),
    p: ({ children }: { children?: ReactNode }) => {
      const flattened = flattenReactText(children).trim();
      const isPlainTextOnly =
        typeof children === "string" ||
        (Array.isArray(children) && children.every((c) => typeof c === "string"));
      const plain = isPlainTextOnly
        ? String(Array.isArray(children) ? children.join("") : children).trim()
        : "";
      const isFigureCaption = FIGURE_CAPTION_TEXT_RE.test(flattened);

      if (isFigureCaption) {
        const shown = (plain || flattened).replace(/^FIGCAPTION\s+/u, "");
        const strippedChildren = isPlainTextOnly
          ? shown
          : stripLeadingFigcaptionPrefix(children);
        return (
          <p className="mt-1 mb-5 text-[11px] leading-snug text-center text-muted-foreground/75 italic">
            {strippedChildren}
          </p>
        );
      }

      // Table boundary notes: "注：...", "说明：...", "备注：..." etc.
      if (TABLE_NOTE_TEXT_RE.test(flattened)) {
        return (
          <p className="qa-table-note -mt-1 mb-3 rounded-b-md border border-t-0 border-border/60 bg-amber-50/60 px-3 py-1.5 text-[11px] leading-relaxed text-muted-foreground dark:bg-amber-500/5">
            {children}
          </p>
        );
      }

      const ordinalNode = renderOrdinalParagraph(children);
      if (ordinalNode) {
        return <p className="qa-ordinal-paragraph mb-3 last:mb-0">{ordinalNode}</p>;
      }

      return <p className="mb-3 last:mb-0">{children}</p>;
    },
    ul: ({ children }: { children?: ReactNode }) => <ul className="mb-2 list-disc pl-5">{children}</ul>,
    ol: ({ children }: { children?: ReactNode }) => <ol className="mb-2 list-decimal pl-5">{children}</ol>,
    li: ({ children }: { children?: ReactNode }) => {
      const plainText =
        typeof children === "string"
          ? children
          : Array.isArray(children)
            ? children.filter((c) => typeof c === "string").join("").trim()
            : "";
      const isRetrievalReason = plainText.startsWith("资料调用理由（");
      const isRetrievalList = plainText.startsWith("检索资料清单");
      const content = (isRetrievalReason || isRetrievalList)
        ? highlightRetrievalDocNames(children, "retrieval-doc")
        : children;
      const ordinalNode = renderOrdinalParagraph(content);
      if (ordinalNode) {
        return <li className="qa-ordinal-list-item mb-1.5 last:mb-0">{ordinalNode}</li>;
      }
      return <li className="mb-1.5 last:mb-0">{content}</li>;
    },
    strong: ({ children }: { children?: ReactNode }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }: { children?: ReactNode }) => <em className="italic text-sky-700/80">{children}</em>,
    code: ({ children, className: codeClassName }: { children?: ReactNode; className?: string }) => {
      const isBlock = codeClassName?.includes("language-");
      return isBlock ? (
        <code className={`${codeClassName ?? ""} block whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs`}>
          {children}
        </code>
      ) : (
        <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
      );
    },
    pre: ({ children }: { children?: ReactNode }) => <pre className="mb-2 whitespace-pre-wrap break-words">{children}</pre>,
    blockquote: ({ children }: { children?: ReactNode }) => (
      <blockquote className="rounded-md border border-border/55 bg-background/85 px-3 py-2 text-xs leading-relaxed text-muted-foreground shadow-sm">
        {children}
      </blockquote>
    ),
  }), [onImageClick]);

  const mergedComponents = useMemo(
    () => ({ ...defaultComponents, ...componentOverrides }),
    [defaultComponents, componentOverrides],
  );

  // 流式显示时，如果公式不完整，显示原始文本（不渲染公式）
  if (isStreaming && !isMathComplete(markdown)) {
    return (
      <div ref={markdownRef} className={cn("qa-markdown prose prose-sm max-w-none break-words dark:prose-invert", className)}>
        <div className="whitespace-pre-wrap break-words">
          {processedMarkdown}
        </div>
        {showStreamingCursor && (
          <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground" />
        )}
      </div>
    );
  }

  return (
    <div ref={markdownRef} className={cn("qa-markdown prose prose-sm max-w-none break-words dark:prose-invert", className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins ?? [[rehypeKatex, { strict: false, throwOnError: false }]]}
        components={mergedComponents}
      >
        {processedMarkdown}
      </ReactMarkdown>
      {showStreamingCursor && (
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground" />
      )}
    </div>
  );
}
