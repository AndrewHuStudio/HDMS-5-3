/**
 * 引用工具函数
 * buildCitationLabelIndexMap: 构建 citation_label → source 索引映射
 * parseCitationLabelFromHref: 从 #source-1-2 格式的 href 中解析标签
 * collectValidCitationLabels: 收集所有有效的引用标签集合
 */
import type { SourceInfo } from "../../types";

const CITATION_HREF_RE = /^#source-(\d{1,2}-\d{1,2})$/;

/**
 * Build a map from citation_label (e.g. "1-1") to source index.
 */
export function buildCitationLabelIndexMap(sources: SourceInfo[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!sources) return map;

  for (let i = 0; i < sources.length; i++) {
    const label = sources[i].citation_label;
    if (label) map.set(label, i);
  }
  return map;
}

/**
 * Parse href like #source-1-2 and return citation label "1-2".
 */
export function parseCitationLabelFromHref(href?: string): string | null {
  if (!href) return null;
  const match = href.match(CITATION_HREF_RE);
  return match ? match[1] : null;
}

export function collectValidCitationLabels(sources: SourceInfo[]): Set<string> {
  return new Set(sources.map((s) => s.citation_label).filter((value): value is string => Boolean(value)));
}
