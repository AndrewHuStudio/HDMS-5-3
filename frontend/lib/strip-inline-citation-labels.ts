/**
 * Remove inline citation labels like [1-2] from answer body rendering.
 *
 * Keep code spans/fences untouched so examples remain faithful.
 */
export function stripInlineCitationLabels(text: string): string {
  if (!text) return text;

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
        const m = line.slice(i).match(/^\[\d{1,2}-\d{1,2}\]/);
        if (m) {
          i += m[0].length;
          continue;
        }
      }

      out += ch;
      i += 1;
    }

    // Cleanup empty wrappers/spaces after marker removal.
    out = out
      .replace(/（\s*）/g, "")
      .replace(/\(\s*\)/g, "")
      .replace(/\s+([，。！？；：,.!?;:）)])/g, "$1")
      .replace(/([（(])\s+/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .trimEnd();

    outLines.push(out);
  }

  return outLines.join("\n");
}
