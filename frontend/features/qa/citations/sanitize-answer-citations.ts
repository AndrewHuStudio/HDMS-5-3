type SanitizeAnswerCitationsArgs = {
  text: string;
  validLabels: Set<string>;
};

function tryParseCitationAt(text: string, i: number): { label: string; raw: string; next: number } | null {
  if (text[i] !== "[") return null;
  let j = i + 1;

  // 1-2 digits
  let a = "";
  while (j < text.length && /[0-9]/.test(text[j]) && a.length < 2) {
    a += text[j++];
  }
  if (a.length === 0) return null;
  if (j >= text.length || text[j] !== "-") return null;
  j += 1;

  // 1-2 digits
  let b = "";
  while (j < text.length && /[0-9]/.test(text[j]) && b.length < 2) {
    b += text[j++];
  }
  if (b.length === 0) return null;
  if (j >= text.length || text[j] !== "]") return null;

  const label = `${a}-${b}`;
  const raw = text.slice(i, j + 1);
  return { label, raw, next: j + 1 };
}

export function sanitizeAnswerCitations(args: SanitizeAnswerCitationsArgs): string {
  const { text, validLabels } = args;
  if (!text) return text;

  const seen = new Set<string>();
  const lines = text.split("\n");
  const outLines: string[] = [];

  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      outLines.push(line);
      continue;
    }

    if (inFence) {
      outLines.push(line);
      continue;
    }

    let out = "";
    let i = 0;
    let inInline = false;

    while (i < line.length) {
      const ch = line[i];
      if (ch === "`") {
        inInline = !inInline;
        out += ch;
        i += 1;
        continue;
      }

      if (!inInline && ch === "[") {
        const parsed = tryParseCitationAt(line, i);
        if (parsed) {
          // Drop citations that don't exist in the reference list, and ensure each label appears only once.
          if (!validLabels.has(parsed.label) || seen.has(parsed.label)) {
            i = parsed.next;
            continue;
          }
          seen.add(parsed.label);
          out += parsed.raw;
          i = parsed.next;
          continue;
        }
      }

      out += ch;
      i += 1;
    }

    outLines.push(out);
  }

  return outLines.join("\n");
}

