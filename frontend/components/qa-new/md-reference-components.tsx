/**
 * QA Markdown 引用/参考文献渲染组件
 * 独立模块：图注检测、表格注释检测、文档名高亮、引用锚点等文本级渲染逻辑。
 */
import React, { Fragment, isValidElement } from "react";
import type { ReactNode } from "react";

const RETRIEVAL_DOC_NAME_PATTERN = /([A-Za-z0-9\u4e00-\u9fff_\-（）()《》【】·、]+\.pdf)/giu;

export const FIGURE_CAPTION_TEXT_RE =
  /^(?:FIGCAPTION\s+)?(?:图\s*\d+(?:[.\-]\d+){0,3}\s*[：:.]|[（(]?\s*(?:图示|图注|图例)\s*[：:])/u;

/** Detect table boundary notes like "注：...", "说明：...", "备注：..." */
export const TABLE_NOTE_TEXT_RE =
  /^(?:注|备注|说明|注释|数据来源|资料来源)\s*[：:]/u;

export function highlightRetrievalDocNames(node: ReactNode, keyPrefix = "doc"): ReactNode {
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

export function flattenReactText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((child) => flattenReactText(child)).join("");
  if (isValidElement(node)) {
    const withChildren = node as { props?: { children?: ReactNode } };
    return flattenReactText(withChildren.props?.children);
  }
  return "";
}

function unwrapSingleChild(node: ReactNode): ReactNode {
  if (Array.isArray(node) && node.length === 1) return node[0];
  return node;
}

function isCitationPillNode(node: ReactNode): boolean {
  const value = unwrapSingleChild(node);
  if (!isValidElement(value)) return false;
  const withType = value as { type?: { displayName?: string } | string };
  const displayName = typeof withType.type === "object" ? withType.type?.displayName : undefined;
  if (displayName === "CitationPill" || displayName === "AnswerCitationAnchor") return true;

  const withProps = value as { props?: { href?: string; children?: ReactNode } };
  if (typeof withProps.props?.href === "string" && /^#source-/.test(withProps.props.href)) return true;
  return false;
}

export function stripCitationWrapperParentheses(children: ReactNode): ReactNode {
  if (!Array.isArray(children) || children.length !== 3) return children;
  const [before, middle, after] = children;
  if (typeof before !== "string" || typeof after !== "string") return children;
  if (!before.endsWith("（") && !before.endsWith("(")) return children;
  if (!after.startsWith("）") && !after.startsWith(")")) return children;
  if (!isCitationPillNode(middle)) return children;

  const normalizedBefore = before.slice(0, -1);
  const normalizedAfter = after.slice(1);
  return [
    normalizedBefore,
    middle,
    normalizedAfter,
  ];
}

export function stripCitationWrapperBrackets(children: ReactNode): ReactNode {
  if (!Array.isArray(children) || children.length !== 3) return children;
  const [before, middle, after] = children;
  if (typeof before !== "string" || typeof after !== "string") return children;
  if (!before.endsWith("[")) return children;
  if (!after.startsWith("]")) return children;
  if (!isCitationPillNode(middle)) return children;

  const normalizedBefore = before.slice(0, -1);
  const normalizedAfter = after.slice(1);
  return [
    normalizedBefore,
    middle,
    normalizedAfter,
  ];
}

export function stripCitationWrapperDelimiters(children: ReactNode): ReactNode {
  return stripCitationWrapperBrackets(stripCitationWrapperParentheses(children));
}

/** Strip leading "FIGCAPTION " prefix from mixed ReactNode children (text + anchors). */
export function stripLeadingFigcaptionPrefix(children: ReactNode): ReactNode {
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
      if (child.trim()) break;
    } else {
      break;
    }
  }
  return result;
}
