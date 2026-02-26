"use client";

import { isValidElement, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import type { PluggableList } from "unified";
import { QA_REMARK_PLUGINS } from "@/lib/qa-markdown-plugins";
import { API_BASE, QA_API_BASE, normalizeApiBase } from "@/lib/api-base";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Helper functions (moved from qa-shell.tsx)                        */
/* ------------------------------------------------------------------ */

const RETRIEVAL_DOC_NAME_PATTERN = /([A-Za-z0-9\u4e00-\u9fff_\-（）()《》【】·、]+\.pdf)/giu;

function highlightRetrievalDocNames(node: ReactNode, keyPrefix = "doc"): ReactNode {
  if (typeof node === "string") {
    const parts: ReactNode[] = [];
    let last = 0;
    let index = 0;
    RETRIEVAL_DOC_NAME_PATTERN.lastIndex = 0;
    for (const match of node.matchAll(RETRIEVAL_DOC_NAME_PATTERN)) {
      const start = match.index ?? 0;
      const full = match[0];
      if (start > last) parts.push(node.slice(last, start));
      parts.push(
        <span key={`${keyPrefix}-${index}`} className="italic text-sky-600/80">
          {full}
        </span>
      );
      last = start + full.length;
      index += 1;
    }
    if (last === 0) return node;
    if (last < node.length) parts.push(node.slice(last));
    return parts;
  }
  if (Array.isArray(node)) {
    return node.map((child, idx) => highlightRetrievalDocNames(child, `${keyPrefix}-${idx}`));
  }
  return node;
}

/** Resolve image src: convert relative /rag/... paths to absolute URLs */
function resolveImageSrc(src: string): string {
  if (!src) return src;
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
    return src;
  }
  if (src.startsWith("/api/")) return src;
  // Keep document images on same-origin to avoid cross-origin/env drift.
  if (/^\/rag\/documents\/[^/?#]+\/image(?:\?|$)/i.test(src)) {
    return `/api${src}`;
  }
  const base = src.startsWith("/rag/")
    ? normalizeApiBase(QA_API_BASE)
    : normalizeApiBase(API_BASE);
  return src.startsWith("/") ? `${base}${src}` : `${base}/${src}`;
}

const FIGURE_CAPTION_TEXT_RE =
  /^(?:FIGCAPTION\s+)?(?:图\s*\d+(?:[.\-]\d+){0,3}\s*[：:.]|[（(]?\s*(?:图示|图注|图例)\s*[：:])/u;

function flattenReactText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((child) => flattenReactText(child)).join("");
  if (isValidElement(node)) {
    const withChildren = node as { props?: { children?: ReactNode } };
    return flattenReactText(withChildren.props?.children);
  }
  return "";
}

/** Strip leading "FIGCAPTION " prefix from mixed ReactNode children (text + anchors). */
function stripLeadingFigcaptionPrefix(children: ReactNode): ReactNode {
  if (typeof children === "string") {
    return children.replace(/^FIGCAPTION\s+/u, "");
  }
  if (!Array.isArray(children)) return children;
  const result = [...children];
  for (let i = 0; i < result.length; i++) {
    const child = result[i];
    if (typeof child === "string") {
      const stripped = child.replace(/^FIGCAPTION\s+/u, "");
      if (stripped !== child) {
        result[i] = stripped;
        return result;
      }
      // If this text node is non-empty but didn't have the prefix, stop looking.
      if (child.trim()) break;
    } else {
      // Non-string node encountered before finding prefix — stop.
      break;
    }
  }
  return result;
}

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
}

export function QAMarkdownRenderer({
  markdown,
  remarkPlugins = QA_REMARK_PLUGINS,
  rehypePlugins,
  componentOverrides,
  showStreamingCursor,
  onImageClick,
  className,
}: QAMarkdownRendererProps) {
  const markdownRef = useRef<HTMLDivElement>(null);

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
  }, [markdown]);

  const defaultComponents: Partial<Components> = useMemo(() => ({
    h2: ({ children }) => (
      <h2 className="qa-heading-1 mt-5 mb-2 text-base font-bold border-l-4 border-primary pl-2">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="qa-heading-2 mt-4 mb-1.5 text-[15px] font-semibold text-primary/85">
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="qa-heading-3 mt-3 mb-1 text-sm font-medium text-foreground/80">
        {children}
      </h4>
    ),
    p: ({ children }) => {
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
        // For mixed children (text + citation anchors), strip FIGCAPTION prefix
        // from the leading text node so it doesn't render as visible text.
        const strippedChildren = isPlainTextOnly
          ? shown
          : stripLeadingFigcaptionPrefix(children);
        return (
          <p className="mt-1 mb-5 text-[11px] leading-snug text-center text-muted-foreground/75 italic">
            {strippedChildren}
          </p>
        );
      }

      return <p className="mb-3 last:mb-0">{children}</p>;
    },
    ul: ({ children }) => <ul className="mb-2 list-disc pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="mb-2 list-decimal pl-5">{children}</ol>,
    li: ({ children }) => {
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
      return <li className="mb-1.5 last:mb-0">{content}</li>;
    },
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic text-sky-700/80">{children}</em>,
    code: ({ children, className: codeClassName }) => {
      const isBlock = codeClassName?.includes("language-");
      return isBlock ? (
        <code className={`${codeClassName ?? ""} block whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs`}>
          {children}
        </code>
      ) : (
        <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
      );
    },
    pre: ({ children }) => <pre className="mb-2 whitespace-pre-wrap break-words">{children}</pre>,
    blockquote: ({ children }) => (
      <blockquote className="rounded-md border border-border/55 bg-background/85 px-3 py-2 text-xs leading-relaxed text-muted-foreground shadow-sm">
        {children}
      </blockquote>
    ),
    table: ({ children }) => (
      <div className="qa-table-wrap mb-2 overflow-x-hidden rounded-md border border-border/80 bg-white/90 dark:bg-background/75">
        <table className="w-full table-fixed border-collapse text-xs">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-border bg-white/80 px-2 py-1 text-left font-semibold break-words dark:bg-muted/45">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-border bg-white/55 px-2 py-1 break-words dark:bg-transparent">{children}</td>
    ),
    img: ({ src, alt }) => {
      const resolved = resolveImageSrc(typeof src === "string" ? src : "");
      return (
        <img
          src={resolved}
          alt={alt ?? "参考图片"}
          className="my-4 max-h-80 cursor-zoom-in rounded border border-border object-contain transition-opacity hover:opacity-80"
          loading="lazy"
          onClick={() => onImageClick?.(resolved)}
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            img.removeAttribute("src");
            img.alt = "图片暂不可用";
            img.title = "参考图片暂不可用";
            img.style.cursor = "default";
            img.className = "my-4 flex h-20 w-full items-center justify-center rounded border border-dashed border-border bg-muted/40 text-xs text-muted-foreground";
          }}
        />
      );
    },
  }), [onImageClick]);

  const mergedComponents = useMemo(
    () => ({ ...defaultComponents, ...componentOverrides }),
    [defaultComponents, componentOverrides],
  );

  return (
    <div ref={markdownRef} className={cn("qa-markdown prose prose-sm max-w-none break-words dark:prose-invert", className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins ?? [rehypeKatex]}
        components={mergedComponents}
      >
        {markdown}
      </ReactMarkdown>
      {showStreamingCursor && (
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground" />
      )}
    </div>
  );
}
