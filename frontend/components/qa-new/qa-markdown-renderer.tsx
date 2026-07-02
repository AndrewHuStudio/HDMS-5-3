/**
 * QA Markdown 渲染器
 * 使用 ReactMarkdown + rehype-katex 渲染答案内容，
 * 组合表格/图片/引用三个独立子模块的渲染组件。
 */
"use client";

import React, { useEffect, useMemo, useRef } from "react";
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
import { prepareStreamingMarkdown } from "@/features/qa/render/streaming-markdown-stability";
import { QA_TABLE_COMPONENTS } from "./md-table-components";
import { buildImageComponent } from "./md-image-components";
import {
  FIGURE_CAPTION_TEXT_RE,
  TABLE_NOTE_TEXT_RE,
  highlightRetrievalDocNames,
  flattenReactText,
  stripCitationWrapperDelimiters,
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
  const streamingPrepared = useMemo(
    () => isStreaming
      ? prepareStreamingMarkdown(markdown)
      : { markdownForParser: markdown, pendingText: "", pendingRenderMode: "hidden" as const, showPendingText: false },
    [markdown, isStreaming],
  );

  // 处理公式：流式时如果公式不完整则不渲染，完成后自动修复格式
  const processedMarkdown = useMemo(() => {
    const source = streamingPrepared.markdownForParser;
    if (!source) return '';

    // 流式阶段优先依赖 prepareStreamingMarkdown 将未闭合公式切到 pending tail。
    if (isStreaming && !isMathComplete(source)) {
      return source;
    }

    // 完成后，修复公式格式
    let processed = source;

    // 1. 修复不配对的分隔符
    processed = fixUnpairedDelimiters(processed);

    // 2. 提取公式块并修复
    const mathBlocks = extractMathBlocks(processed);
    processed = fixMathInText(processed, mathBlocks);

    // 3. 确保块级公式前后有空行
    processed = ensureBlockMathSpacing(processed);

    return processed;
  }, [streamingPrepared.markdownForParser, isStreaming]);

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
    p: ({
      children,
      node,
    }: {
      children?: ReactNode;
      node?: {
        position?: {
          start?: {
            column?: number;
          };
        };
      };
    }) => {
      const normalizedChildren = stripCitationWrapperDelimiters(children);
      const flattened = flattenReactText(normalizedChildren).trim();
      const isPlainTextOnly =
        typeof normalizedChildren === "string" ||
        (Array.isArray(normalizedChildren) && normalizedChildren.every((c) => typeof c === "string"));
      const plain = isPlainTextOnly
        ? String(Array.isArray(normalizedChildren) ? normalizedChildren.join("") : normalizedChildren).trim()
        : "";
      const isFigureCaption = FIGURE_CAPTION_TEXT_RE.test(flattened);

      if (isFigureCaption) {
        const shown = (plain || flattened).replace(/^FIGCAPTION\s+/u, "");
        const strippedChildren = isPlainTextOnly
          ? shown
          : stripLeadingFigcaptionPrefix(children);
        const isNestedInList = Boolean((node?.position?.start?.column ?? 0) >= 4);
        return (
          <p className={cn(
            "qa-figure-caption mt-1 mb-5 rounded-lg bg-slate-50/80 px-3 py-2 text-[11px] leading-snug text-center text-slate-500 italic dark:bg-muted/25 dark:text-muted-foreground/80",
            isNestedInList && "qa-figure-caption--list-nested mx-auto mt-0 mb-4 max-w-[min(100%,34rem)] rounded-2xl border border-slate-200/90 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-4 py-2.5 text-slate-600 not-italic shadow-[0_10px_24px_rgba(15,23,42,0.06)] dark:border-border dark:bg-muted/20 dark:text-muted-foreground dark:shadow-none"
          )}>
            {strippedChildren}
          </p>
        );
      }

      // Table boundary notes: "注：...", "说明：...", "备注：..." etc.
      if (TABLE_NOTE_TEXT_RE.test(flattened)) {
        return (
          <div className="qa-table-note mb-4 rounded-2xl border border-sky-200/80 bg-gradient-to-r from-sky-50 via-white to-sky-50/70 px-4 py-3 text-[12px] leading-6 text-sky-900 shadow-[0_10px_24px_rgba(14,165,233,0.10)] dark:border-sky-400/20 dark:bg-gradient-to-r dark:from-sky-500/10 dark:via-background dark:to-sky-500/5 dark:text-sky-100/90 dark:shadow-none">
            <span className="mb-1 inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold tracking-[0.02em] text-sky-700 dark:bg-sky-400/15 dark:text-sky-200">
              备注说明
            </span>
            <div className="qa-table-note__body">
              {normalizedChildren}
            </div>
          </div>
        );
      }

      const ordinalNode = renderOrdinalParagraph(normalizedChildren);
      if (ordinalNode) {
        return <p className="qa-paragraph qa-ordinal-paragraph mb-3 last:mb-0">{ordinalNode}</p>;
      }

      return <p className="qa-paragraph mb-3 text-[14px] leading-7 text-slate-700 last:mb-0 dark:text-foreground/90">{normalizedChildren}</p>;
    },
    ul: ({ children }: { children?: ReactNode }) => (
      <ul className="qa-list qa-list--unordered mb-3 list-disc space-y-1.5 pl-5 text-[14px] text-slate-700 marker:text-sky-600 dark:text-foreground/90 dark:marker:text-sky-400">
        {children}
      </ul>
    ),
    ol: ({ children }: { children?: ReactNode }) => (
      <ol className="qa-list qa-list--ordered mb-3 list-decimal space-y-1.5 pl-5 text-[14px] text-slate-700 marker:font-semibold marker:text-slate-500 dark:text-foreground/90 dark:marker:text-muted-foreground">
        {children}
      </ol>
    ),
    li: ({ children }: { children?: ReactNode }) => {
      const normalizedChildren = stripCitationWrapperDelimiters(children);
      const plainText =
        typeof normalizedChildren === "string"
          ? normalizedChildren
          : Array.isArray(normalizedChildren)
            ? normalizedChildren.filter((c) => typeof c === "string").join("").trim()
            : "";
      const isRetrievalReason = plainText.startsWith("资料调用理由（");
      const isRetrievalList = plainText.startsWith("检索资料清单");
      const content = (isRetrievalReason || isRetrievalList)
        ? highlightRetrievalDocNames(normalizedChildren, "retrieval-doc")
        : normalizedChildren;
      return <li className="qa-list-item mb-1.5 last:mb-0">{content}</li>;
    },
    strong: ({ children }: { children?: ReactNode }) => (
      <strong className="qa-strong rounded-sm bg-amber-100/70 px-1 py-0.5 font-semibold text-slate-900 dark:bg-amber-400/15 dark:text-foreground">
        {children}
      </strong>
    ),
    em: ({ children }: { children?: ReactNode }) => <em className="qa-em italic text-sky-700/80 dark:text-sky-300">{children}</em>,
    code: ({ children, className: codeClassName }: { children?: ReactNode; className?: string }) => {
      const isBlock = codeClassName?.includes("language-");
      return isBlock ? (
        <code className={`qa-code-block ${codeClassName ?? ""} block whitespace-pre-wrap break-words rounded-xl bg-slate-950 px-3 py-2 text-[12px] leading-6 text-slate-100 dark:bg-slate-900`}>
          {children}
        </code>
      ) : (
        <code className="qa-inline-code rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-800 dark:border-border dark:bg-muted dark:text-foreground">{children}</code>
      );
    },
    pre: ({ children }: { children?: ReactNode }) => (
      <pre className="qa-pre-block mb-3 overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200/90 bg-slate-950/98 p-0 shadow-[0_12px_28px_rgba(15,23,42,0.12)] dark:border-border dark:shadow-none">
        {children}
      </pre>
    ),
    blockquote: ({ children }: { children?: ReactNode }) => (
      <blockquote className="qa-callout my-4 rounded-xl border border-sky-200/80 bg-gradient-to-r from-sky-50 via-white to-white px-4 py-3 text-[13px] leading-6 text-slate-700 shadow-[0_10px_24px_rgba(14,165,233,0.08)] dark:border-sky-400/20 dark:from-sky-500/5 dark:via-background dark:to-background dark:text-foreground/85 dark:shadow-none">
        {children}
      </blockquote>
    ),
  }), [onImageClick]);

  const mergedComponents = useMemo(
    () => ({ ...defaultComponents, ...componentOverrides }),
    [defaultComponents, componentOverrides],
  );

  const pendingNode = isStreaming && streamingPrepared.pendingText
    ? streamingPrepared.pendingRenderMode === "markdown"
      ? (
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins ?? [[rehypeKatex, { strict: false, throwOnError: false }]]}
          components={mergedComponents}
        >
          {streamingPrepared.pendingText}
        </ReactMarkdown>
      )
      : streamingPrepared.pendingRenderMode === "plaintext"
        ? (
          <div className="whitespace-pre-wrap break-words text-muted-foreground/80">
            {streamingPrepared.pendingText}
          </div>
        )
        : null
    : null;

  return (
    <div ref={markdownRef} className={cn("qa-markdown prose prose-sm max-w-none break-words dark:prose-invert", className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins ?? [[rehypeKatex, { strict: false, throwOnError: false }]]}
        components={mergedComponents}
      >
        {processedMarkdown}
      </ReactMarkdown>
      {pendingNode}
      {showStreamingCursor && (
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground" />
      )}
    </div>
  );
}
