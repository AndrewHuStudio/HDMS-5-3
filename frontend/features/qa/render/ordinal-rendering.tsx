import React from "react";
import type { ReactNode } from "react";
import { isValidElement } from "react";

type OrdinalKind = "cn_major" | "cn_nested" | "arabic" | "circled";

interface ParsedOrdinalPrefix {
  kind: OrdinalKind;
  prefix: string;
  body: string;
}

const ORDINAL_PATTERNS: Array<{ kind: OrdinalKind; re: RegExp }> = [
  { kind: "cn_major", re: /^([一二三四五六七八九十]+[、.．]\s*)(.+)$/u },
  { kind: "cn_nested", re: /^([（(][一二三四五六七八九十]+[)）]\s*)(.+)$/u },
  { kind: "arabic", re: /^(\d{1,2}[.)．、]\s*)(.+)$/u },
  { kind: "circled", re: /^([\u2460-\u2469]\s*)(.+)$/u },
];

function toPlainTextIfSafe(node: ReactNode): string | null {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) {
    let out = "";
    for (const child of node) {
      const normalized = toPlainTextIfSafe(child);
      if (normalized == null) return null;
      out += normalized;
    }
    return out;
  }
  if (isValidElement(node)) return null;
  return null;
}

export function parseOrdinalPrefix(text: string): ParsedOrdinalPrefix | null {
  const input = String(text || "").trim();
  if (!input || input.includes("|")) return null;

  for (const { kind, re } of ORDINAL_PATTERNS) {
    const match = input.match(re);
    if (!match) continue;
    const prefix = (match[1] || "").trim();
    const body = (match[2] || "").trim();
    if (!prefix || !body) continue;
    return { kind, prefix, body };
  }
  return null;
}

export function renderOrdinalParagraph(children: ReactNode): ReactNode | null {
  const raw = toPlainTextIfSafe(children);
  if (raw == null) return null;
  const text = raw.trim();
  const parsed = parseOrdinalPrefix(text);
  if (!parsed) return null;

  return (
    <>
      <span className={`qa-ordinal-prefix qa-ordinal-prefix--${parsed.kind}`}>{parsed.prefix}</span>
      <span className="qa-ordinal-body">{parsed.body}</span>
    </>
  );
}
