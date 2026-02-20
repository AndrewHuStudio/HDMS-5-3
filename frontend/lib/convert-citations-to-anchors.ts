/**
 * Convert bare [N-M] citation markers to [N-M](#source-N-M) markdown link anchors.
 *
 * This must run AFTER sanitizeAnswerCitations (which validates labels)
 * and BEFORE stripInlineCitationLabels (which removes bare markers).
 *
 * The resulting anchors survive stripInlineCitationLabels and are used by
 * injectSourceImages for citation-based image placement, and by the
 * ReactMarkdown `a` component handler for rendering clickable citation pills.
 */
export function convertCitationsToAnchors(
  text: string,
  validLabels: Set<string>,
): string {
  if (!text || validLabels.size === 0) return text;

  // Match [N-M] NOT already followed by '(' (i.e. not already a markdown link).
  // Skips code fences and inline code spans.
  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    out.push(
      line.replace(
        /\[(\d{1,2}-\d{1,2})\](?!\()/g,
        (match, label: string) => {
          if (!validLabels.has(label)) return match;
          return `[${label}](#source-${label})`;
        },
      ),
    );
  }

  return out.join("\n");
}
