import type { SourceInfo } from "@/features/qa/types";

type CandidateImage = {
  url: string;
  name: string;
  figure: string;
  caption: string;
};

const FIGURE_REF_RE = /图\s*([0-9]+(?:[.\-][0-9]+){1,3})/g;
const GUIDE_HINT_RE = /(如下图|下图|见下图|如图所示|流程图如下|示意图如下)/;
const IMAGE_MENTION_RE = /(控制图|示意图|图示|图注|剖面|总图|平面图|流程图|附图|配图)/;
// Matches user-facing inline refs like:
// - （见图1）
// - （见图3.0.1）
// - （见图3.0.3流程图）
// Also tolerates missing parentheses to avoid partial replacements that leave ".0.1）" fragments.
const INLINE_SEE_FIGURE_RE =
  /[（(]?\s*见图\s*\d+(?:[.\-]\d+){0,3}(?:[^)）]{0,20})?\s*[)）]?/u;
const INLINE_SEE_FIGURE_GLOBAL_RE =
  /[（(]?\s*见图\s*\d+(?:[.\-]\d+){0,3}(?:[^)）]{0,20})?\s*[)）]?/gu;
const IMAGE_PLACEHOLDER_RE =
  /\[([^\]]{2,80})\][（(][^)\n]*?(此处应插入|未见附图)[^)\n]*[)）]?/;
const MARKDOWN_IMAGE_DEST_RE = /!\[[^\]]*\]\(([^)\n]+)\)/g;
const CITATION_ANCHOR_RE = /\[\d{1,2}-\d{1,2}\]\(#source-\d{1,2}-\d{1,2}\)/g;
const FIGURE_CONTEXT_PREFIX_RE = /^\s*[（(]?\s*(?:图示|图注|图例|示意图|附图)\s*[：:]/u;

function normalizeCaptionText(text: string): string {
  const t = String(text || "").trim();
  if (!t) return "";

  // Strip leading "图2 / 图3.0.1 / Fig. 3-1 / 3.1.2" style prefixes.
  let out = t
    .replace(/^\s*图\s*[0-9]+(?:[.\-][0-9]+){0,3}\s*[:：.\-]?\s*/i, "")
    .replace(/^\s*fig(?:ure)?\s*[0-9]+(?:[.\-][0-9]+){0,3}\s*[:：.\-]?\s*/i, "")
    .replace(/^\s*[0-9]+(?:\.[0-9]+){1,4}\s*[:：.\-]?\s*/i, "")
    .trim();

  // If the caption includes a "follow the steps in the figure" tail, drop it.
  out = out
    .replace(/\s*(应按照|按照|应按图|按图|参见|见|详见|如下|如图|下图).*$/u, "")
    .replace(/\s*的步骤\s*$/u, "")
    .trim();

  return out;
}

function parseMarkdownImageDest(raw: string): string {
  let cleaned = String(raw || "").trim();
  if (!cleaned) return "";
  if (cleaned.startsWith("<") && cleaned.endsWith(">")) {
    cleaned = cleaned.slice(1, -1).trim();
  } else {
    const titleMatch = cleaned.match(/^(.*?)(?:\s+["'][^"']*["'])\s*$/);
    if (titleMatch?.[1]) cleaned = titleMatch[1].trim();
  }
  cleaned = cleaned.replace(/\\ /g, " ").replace(/\\\\/g, "\\").trim();
  return cleaned;
}

function extractQuoteImageUrls(quote: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of quote.matchAll(MARKDOWN_IMAGE_DEST_RE)) {
    const url = parseMarkdownImageDest(match[1] || "");
    if (!url) continue;
    if (
      !url.startsWith("/rag/") &&
      !url.startsWith("/api/") &&
      !url.startsWith("http://") &&
      !url.startsWith("https://") &&
      !url.startsWith("data:")
    ) {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function deriveImageNameFromUrl(url: string, index: number): string {
  const fallback = `参考图片${index + 1}`;
  try {
    const parsed = new URL(url, "http://localhost");
    const ref = parsed.searchParams.get("ref");
    const byRef = (ref || "").split(/[\\/]/).pop();
    if (byRef) return byRef;
    const byPath = (parsed.pathname || "").split("/").pop();
    if (byPath) return byPath;
    return fallback;
  } catch {
    const byPath = String(url || "").split(/[\\/]/).pop();
    return byPath || fallback;
  }
}

function looksLikeOpaqueFilename(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  const base = t.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{2,5}$/i, "");
  if (base.length < 20) return false;
  // Mostly hex or hex-with-dashes (common for content-hash names).
  if (/^[a-f0-9-]{20,}$/i.test(base)) return true;
  // Pure alnum underscore hashes.
  if (/^[a-z0-9_]{24,}$/i.test(base)) return true;
  return false;
}

function pickDisplayText(image: CandidateImage): string {
  const caption = normalizeCaptionText(image.caption || "");
  if (caption && !looksLikeOpaqueFilename(caption)) return caption;

  const name = String(image.name || "").trim();
  if (name && !looksLikeOpaqueFilename(name)) return name;

  return "";
}

function extractCitationAnchors(line: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of String(line || "").matchAll(CITATION_ANCHOR_RE)) {
    const raw = match[0];
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

type FigureContextLineParseResult = {
  consumeLine: boolean;
  captionHint: string;
  citationAnchors: string[];
};

function parseStandaloneFigureContextLine(line: string): FigureContextLineParseResult {
  const raw = String(line || "");
  const citationAnchors = extractCitationAnchors(raw);
  const withoutAnchors = raw.replace(CITATION_ANCHOR_RE, "").trim();
  if (!withoutAnchors) {
    return { consumeLine: false, captionHint: "", citationAnchors };
  }

  const unwrapped = withoutAnchors
    .replace(/^\s*[（(]\s*/u, "")
    .replace(/\s*[)）]\s*$/u, "")
    .trim();

  if (!FIGURE_CONTEXT_PREFIX_RE.test(unwrapped)) {
    return { consumeLine: false, captionHint: "", citationAnchors };
  }

  const captionHint = normalizeCaptionText(
    unwrapped
      .replace(/^(?:图示|图注|图例|示意图|附图)\s*[：:]\s*/u, "")
      .replace(/\s*[，,；;。]?\s*(?:来源|见图|详见图|如图|参见图)\s*.*$/u, "")
      .replace(/[（(]\s*图\s*\d+(?:[.\-]\d+){0,3}\s*[)）]\s*$/u, "")
      .trim()
  );

  return { consumeLine: true, captionHint, citationAnchors };
}

function inferCaptionFromLine(line: string): string {
  const raw = String(line || "");
  if (!raw.trim()) return "";

  // Remove inline citation anchors first.
  const withoutAnchors = raw.replace(/\[\d{1,2}-\d{1,2}\]\(#source-\d{1,2}-\d{1,2}\)/g, "").trim();

  // Keep the part before "->" or ":" which often introduces the figure.
  const beforeArrow = withoutAnchors.split("->")[0] ?? withoutAnchors;
  const beforeColon = beforeArrow.split(/[:：]/)[0] ?? beforeArrow;

  // Drop "should follow the steps in fig..." tails.
  const head = beforeColon.replace(/\s*(应按照|按照|参见|见|详见|如下|如图|下图).*$/u, "").trim();

  return normalizeCaptionText(head).replace(/[（(]+$/u, "").trim();
}

function isGenericCaption(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return true;
  // Too generic to be helpful as a figure title.
  return /^(流程图|示意图|控制图|剖面图|总图|平面图|配图|图片)$/u.test(t);
}

function looksLikeFigureTitle(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (t.length < 6) return false;
  if (t.length > 60) return false;
  if (/[（(]$/.test(t)) return false;
  // Must contain at least one "title-ish" keyword to avoid using generic sentences as captions.
  return /(流程|示意|控制|剖面|总图|平面|框架|体系|结构|分类|判定|模型|地图|分区|路径|步骤)/u.test(t);
}

function appendFigureRefToLine(line: string, figLabel: string): string {
  const src = String(line || "");
  if (!src.trim()) return src;

  const ref = `（${figLabel}）`;
  if (INLINE_SEE_FIGURE_RE.test(src)) {
    return src.replace(INLINE_SEE_FIGURE_GLOBAL_RE, ref);
  }

  // Prefer inserting before the first citation anchor.
  const firstAnchor = src.match(/\[\d{1,2}-\d{1,2}\]\(#source-\d{1,2}-\d{1,2}\)/);
  if (firstAnchor?.[0]) {
    return src.replace(firstAnchor[0], `${ref}${firstAnchor[0]}`);
  }

  // Otherwise, keep it near sentence end (before trailing punctuation if present).
  if (/[。！？.!?]\s*$/.test(src)) {
    return src.replace(/([。！？.!?])\s*$/, `${ref}$1`);
  }

  return `${src}${ref}`;
}

function normalizeFigureToken(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/^图/i, "").replace(/-/g, ".");
}

function parseFigureTokens(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(FIGURE_REF_RE)) {
    const token = normalizeFigureToken(m[1] || "");
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function buildCandidates(src: SourceInfo): CandidateImage[] {
  const urlsFromMetadata = Array.isArray(src.image_urls)
    ? src.image_urls.filter(Boolean)
    : (src.image_url ? [src.image_url] : []);
  const urlsFromQuote = extractQuoteImageUrls(String(src.quote || ""));
  const urls = urlsFromMetadata.length > 0 ? urlsFromMetadata : urlsFromQuote;
  const names = Array.isArray(src.image_names)
    ? src.image_names
    : (src.image_name ? [src.image_name] : []);
  const figures = Array.isArray(src.image_figures) ? src.image_figures : [];
  const captions = Array.isArray(src.image_captions) ? src.image_captions : [];

  return urls.map((url, idx) => {
    const figure = String(figures[idx] || "").trim();
    const caption = String(captions[idx] || "").trim();
    const name = String(names[idx] || deriveImageNameFromUrl(url, idx)).trim();
    return { url, name, figure, caption };
  });
}

function pickImageByFigureOrHint(line: string, candidates: CandidateImage[]): CandidateImage | null {
  if (candidates.length === 0) return null;

  const figureTokens = parseFigureTokens(line);
  if (figureTokens.length > 0) {
    if (candidates.length === 1) return candidates[0];
    for (const token of figureTokens) {
      const matched = candidates.find((c) => normalizeFigureToken(c.figure || "").includes(token));
      if (matched) return matched;
    }

    // Fallback: try matching by filename patterns when backend figure meta is missing.
    for (const token of figureTokens) {
      const tokenVariants = [
        token,
        token.replace(/\./g, "_"),
        token.replace(/\./g, "-"),
      ];
      const matched = candidates.find((c) => {
        const name = (c.name || "").toLowerCase();
        return tokenVariants.some((v) => v && name.includes(v.toLowerCase()));
      });
      if (matched) return matched;
    }
  }

  if (GUIDE_HINT_RE.test(line)) return candidates[0];
  return null;
}

function pickImageByKeyword(lineOrKeyword: string, candidates: CandidateImage[]): CandidateImage | null {
  const q = String(lineOrKeyword || "").trim();
  if (!q || candidates.length === 0) return null;

  // Prefer caption match, then filename-ish match.
  const direct = candidates.find((c) => (c.caption || "").includes(q));
  if (direct) return direct;

  const softened = q.replace(/[【】[\]（）()]/g, "").replace(/\s+/g, "");
  if (softened) {
    const byCaption = candidates.find((c) => (c.caption || "").replace(/\s+/g, "").includes(softened));
    if (byCaption) return byCaption;
    const byName = candidates.find((c) => (c.name || "").replace(/\s+/g, "").includes(softened));
    if (byName) return byName;
  }

  // Token fallback (helps when the placeholder includes extra note text).
  const tokens = q
    .replace(/[【】[\]（）()]/g, " ")
    .split(/[\s,，。；;:：/\\|]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 2);

  if (tokens.length > 0) {
    for (const t of tokens) {
      const matched = candidates.find((c) => (c.caption || "").includes(t) || (c.name || "").includes(t));
      if (matched) return matched;
    }
  }

  return null;
}

type FigureCaptionLineOptions = {
  contextLine?: string;
  captionHint?: string;
  citationAnchors?: string[];
};

function buildFigureCaptionLine(
  figLabel: string,
  image: CandidateImage,
  options: FigureCaptionLineOptions = {}
): string {
  const base = pickDisplayText(image);
  const normalizedHint = normalizeCaptionText(options.captionHint || "");
  const inferredRaw = options.contextLine ? inferCaptionFromLine(options.contextLine) : "";
  const inferred = looksLikeFigureTitle(inferredRaw) ? inferredRaw : "";
  const contextual = normalizedHint && !isGenericCaption(normalizedHint) ? normalizedHint : inferred;

  // Prefer the backend-provided (and normalized) caption unless it's missing or too generic.
  const name =
    (!base || isGenericCaption(base)) && contextual && !isGenericCaption(contextual)
      ? contextual
      : (base || contextual || "参考配图");

  const sourceTrail =
    options.citationAnchors && options.citationAnchors.length > 0
      ? ` ${options.citationAnchors.join("")}`
      : "";

  // Keep caption lines as an explicit marker so downstream cleanup won't split/mutate them.
  return `FIGCAPTION ${figLabel}：${name}${sourceTrail}`;
}

function detectListContentIndent(line: string): string {
  const src = String(line || "");
  const ordered = src.match(/^(\s*)(\d+[.)])\s+/);
  if (ordered) {
    return `${ordered[1]}${" ".repeat(ordered[2].length + 1)}`;
  }

  const unordered = src.match(/^(\s*)([-+*])\s+/);
  if (unordered) {
    return `${unordered[1]}${" ".repeat(unordered[2].length + 1)}`;
  }

  return "";
}

function buildInjectedBlock(imageMarkdown: string, captionLine: string, indent: string): string[] {
  if (!indent) {
    return ["", imageMarkdown, "", captionLine, ""];
  }
  // Keep image + caption as separate paragraphs within the list item.
  return [`${indent}${imageMarkdown}`, indent, `${indent}${captionLine}`, indent];
}

function isUrlAlreadyPresent(url: string, lines: string[], injectedUrls: Set<string>): boolean {
  if (!url) return false;
  if (injectedUrls.has(url)) return true;
  return lines.some((l) => l.includes(url));
}

function pickFirstUnusedCandidate(
  candidates: CandidateImage[],
  lines: string[],
  injectedUrls: Set<string>
): CandidateImage | null {
  for (const c of candidates) {
    if (!c?.url) continue;
    if (isUrlAlreadyPresent(c.url, lines, injectedUrls)) continue;
    return c;
  }
  return null;
}

/**
 * Inject images into answer markdown with "figure-first" matching:
 * - Prefer matching by nearest figure number token (e.g. 图3.0.1)
 * - Fallback only when the line explicitly says "下图/如图所示"
 */
export function injectSourceImages(
  text: string,
  sources: SourceInfo[] | undefined,
  query?: string
): string {
  if (!text || !sources || sources.length === 0) return text;

  const sourceByLabel = new Map<string, SourceInfo>();
  for (const src of sources) {
    if (src.citation_label) sourceByLabel.set(src.citation_label, src);
  }

  const lines = text.split("\n");
  const injectedUrls = new Set<string>();
  const urlToFigLabel = new Map<string, string>();
  let figCount = 0;

  const allCandidates: CandidateImage[] = [];
  for (const src of sources) allCandidates.push(...buildCandidates(src));

  const queryKeywords = extractQueryKeywords(query || "");

  // 1) Handle explicit "should insert image here" placeholders by replacing them
  //    with a best-effort real image from the retrieved sources.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const placeholder = line.match(IMAGE_PLACEHOLDER_RE);
    if (!placeholder) continue;

    const title = (placeholder[1] || "").trim();
    const candidates = allCandidates;
    const chosen =
      pickImageByFigureOrHint(line, candidates) ||
      pickImageByKeyword(title, candidates) ||
      pickImageByKeyword(line, candidates) ||
      (candidates[0] ?? null);

    if (!chosen) {
      // Strip the placeholder note even if we can't find an image.
      lines[i] = line.replace(IMAGE_PLACEHOLDER_RE, "").trim();
      continue;
    }

    if (!isUrlAlreadyPresent(chosen.url, lines, injectedUrls)) {
      figCount += 1;
      const figLabel = `图${figCount}`;

      // Try attaching "(见图N)" to the closest meaningful text line above.
      for (let j = i - 1; j >= 0; j--) {
        const prev = lines[j]?.trim();
        if (!prev) continue;
        if (prev.startsWith("![")) continue; // image
        if (prev.startsWith("【图注】")) continue; // caption marker
        lines[j] = appendFigureRefToLine(lines[j], figLabel);
        break;
      }

      const alt = pickDisplayText(chosen) || "参考配图";
      const contextLine = (lines[i - 1] ?? "").trim() ? lines[i - 1] : "";
      const listIndent = detectListContentIndent(lines[i - 1] || "");
      const injectedBlock = buildInjectedBlock(
        `![${alt}](${chosen.url})`,
        buildFigureCaptionLine(figLabel, chosen, { contextLine }),
        listIndent
      );
      lines.splice(
        i,
        1,
        ...injectedBlock
      );
      injectedUrls.add(chosen.url);
      urlToFigLabel.set(chosen.url, figLabel);
      i += injectedBlock.length - 1;
    } else {
      // If the image is already present, at least remove the placeholder note.
      lines[i] = line.replace(IMAGE_PLACEHOLDER_RE, "").trim();
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const labelMatches = Array.from(line.matchAll(/\[(\d{1,2}-\d{1,2})\]\(#source-\1\)/g));
    if (labelMatches.length === 0) continue;

    const contextLineMeta = parseStandaloneFigureContextLine(line);
    let injected = false;
    let insertedLen = 0;
    for (const m of labelMatches) {
      const label = m[1];
      const src = sourceByLabel.get(label);
      if (!src) continue;

      const candidates = buildCandidates(src);
      const explicitSeeFigure = INLINE_SEE_FIGURE_RE.test(line);

      const chosen =
        pickImageByFigureOrHint(line, candidates) ||
        (explicitSeeFigure ? pickFirstUnusedCandidate(candidates, lines, injectedUrls) : null) ||
        (IMAGE_MENTION_RE.test(line)
          ? (pickImageByKeyword(line, candidates) || pickFirstUnusedCandidate(candidates, lines, injectedUrls))
          : null);
      if (!chosen) continue;

      if (isUrlAlreadyPresent(chosen.url, lines, injectedUrls)) {
        // If the image was already injected earlier, keep figure refs consistent.
        const existing = urlToFigLabel.get(chosen.url);
        if (existing) {
          if (contextLineMeta.consumeLine) {
            lines[i] = `（${existing}）${contextLineMeta.citationAnchors.join("")}`;
          } else {
            lines[i] = appendFigureRefToLine(lines[i], existing);
          }
        }
        injected = true;
        break;
      }

      figCount += 1;
      const figLabel = `图${figCount}`;
      const originalLine = lines[i];
      const alt = pickDisplayText(chosen) || "参考配图";
      const listIndent = detectListContentIndent(originalLine);
      const captionLine = buildFigureCaptionLine(figLabel, chosen, {
        contextLine: originalLine,
        captionHint: contextLineMeta.captionHint,
        citationAnchors: contextLineMeta.consumeLine ? contextLineMeta.citationAnchors : [],
      });
      const injectedBlock = buildInjectedBlock(
        `![${alt}](${chosen.url})`,
        captionLine,
        listIndent
      );

      if (contextLineMeta.consumeLine) {
        lines.splice(i, 1, ...injectedBlock);
      } else {
        lines[i] = appendFigureRefToLine(lines[i], figLabel);
        lines.splice(i + 1, 0, ...injectedBlock);
      }
      injectedUrls.add(chosen.url);
      urlToFigLabel.set(chosen.url, figLabel);
      injected = true;
      insertedLen = contextLineMeta.consumeLine ? injectedBlock.length - 1 : injectedBlock.length;
      break;
    }

    if (injected) {
      if (insertedLen > 0) i += insertedLen;
    }
  }

  let out = lines.join("\n");

  // If we can't provide any images at all, strip "见图" placeholders to avoid
  // dangling references that confuse users.
  if (allCandidates.length === 0) {
    out = out
      .replace(/[（(]\s*见图\s*\d{1,2}\s*[)）]/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+\n/g, "\n");
    return out;
  }

  // 3) Defensive cleanup: never show "此处应插入/未见附图" style placeholders to users.
  out = out.replace(/（注：[^）]*?(此处应插入|未见附图)[^）]*）/g, "");
  out = out.replace(/\(注：[^)]*?(此处应插入|未见附图)[^)]*\)/g, "");

  // 3.1) Cleanup legacy/partial replacements like:
  // "（见图1）.0.1）" or "（见图2）.0.3流程图）" -> keep only "（见图N）".
  out = out.replace(
    /(（见图\d+）)[.\-]\d+(?:[.\-]\d+){0,3}[^)）]{0,24}[)）]/g,
    "$1"
  );

  // 4) If the answer has no images yet, append remaining candidate images as a
  //    "related figures" section. This is the final safety net: even if the LLM
  //    didn't mention figures and inline injection didn't fire, users still see
  //    the diagrams from the retrieved sources.
  const alreadyHasImage = /!\[[^\]]*\]\([^)]+\)/.test(out);

  if (!alreadyHasImage && allCandidates.length > 0) {
    // If the answer explicitly references (见图N), try to provide at least N figures.
    let needed = 0;
    for (const m of out.matchAll(/[（(]\s*见图\s*(\d{1,2})\s*[)）]/g)) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > needed) needed = n;
    }
    if (needed <= 0) return out;

    // Try query-scored images first, fall back to all candidates.
    const scoredByQuery = queryKeywords.length > 0
      ? allCandidates
          .map((img) => ({ img, score: scoreImageByKeywords(img, queryKeywords) }))
          .filter((x) => x.score >= 2)
          .sort((a, b) => b.score - a.score)
      : [];

    const chosen = scoredByQuery.length > 0
      ? scoredByQuery.map((x) => x.img)
      : allCandidates;

    const cap = needed > 0 ? Math.min(needed, 6) : 3;
    const extra = chosen.filter((c) => !out.includes(c.url)).slice(0, cap);
    if (extra.length > 0) {
      const appendix: string[] = [];
      appendix.push("", "", "### 相关配图");
      for (const img of extra) {
        figCount += 1;
        const figLabel = `图${figCount}`;
        const alt = pickDisplayText(img) || "参考配图";
        appendix.push("", `![${alt}](${img.url})`, "", buildFigureCaptionLine(figLabel, img), "");
      }
      out = `${out}${appendix.join("\n")}`;
    }
  }

  return out;
}

function extractQueryKeywords(query: string): string[] {
  const src = String(query || "").trim();
  if (!src) return [];

  let s = src;
  // Remove punctuation/symbols to create coarse tokens.
  s = s.replace(/[？?。！!,，.;:：；、/\\|()[\]{}<>《》“”"'`]/g, " ");
  // Remove common question boilerplate.
  s = s.replace(/请问|请|帮我|一下|一下子|麻烦|能否|可以|是否/gu, " ");
  s = s.replace(/什么是|是什么|指什么|什么意思|如何|为什么|多少|怎么|定义|含义/gu, " ");
  // Split on common particles that glue Chinese phrases together.
  s = s.replace(/的/gu, " ");

  const raw = s.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  const out = new Set<string>();

  for (const token of raw) {
    const han = token.match(/[\p{Script=Han}]{2,}/gu) || [];
    for (const h of han) out.add(h);
    const alnum = token.match(/[A-Za-z0-9]{2,}/g) || [];
    for (const a of alnum) out.add(a);
  }

  return Array.from(out).sort((a, b) => b.length - a.length).slice(0, 10);
}

function scoreImageByKeywords(img: CandidateImage, keywords: string[]): number {
  if (!keywords || keywords.length === 0) return 0;

  const hay = (
    normalizeCaptionText(img.caption || "") +
    " " +
    String(img.figure || "") +
    " " +
    String(img.name || "")
  )
    .replace(/\s+/g, "")
    .toLowerCase();

  let score = 0;
  for (const kw of keywords) {
    const k = String(kw || "").replace(/\s+/g, "").toLowerCase();
    if (k.length < 2) continue;
    if (hay.includes(k)) score += Math.min(10, k.length);
  }
  return score;
}
