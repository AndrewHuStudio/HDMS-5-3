import type { AnswerDocument, ImageEvidence } from "@/features/qa/types";

function cleanAlt(value: string): string {
  return String(value || "参考配图")
    .replace(/[\[\]\r\n]+/g, " ")
    .trim() || "参考配图";
}

function renderImage(image: ImageEvidence): string {
  const caption = cleanAlt(image.caption).replace(/([*_`])/g, "\\$1");
  return `![${cleanAlt(image.caption)}](${String(image.url).trim()})\n\n*${caption}*`;
}

export function composeAnswerDocumentMarkdown(document: AnswerDocument): string {
  const emitted = new Set<string>();
  const blocks: string[] = [];

  for (const section of document?.sections || []) {
    const markdown = String(section?.markdown || "").trim();
    if (markdown) blocks.push(markdown);

    const allowedSources = new Set(section?.source_labels || []);
    for (const image of section?.images || []) {
      const id = String(image?.id || "").trim();
      const url = String(image?.url || "").trim();
      const owner = String(image?.source_label || "").trim();
      if (!id || !url || !allowedSources.has(owner) || emitted.has(id)) continue;
      emitted.add(id);
      blocks.push(renderImage(image));
    }
  }

  return blocks.join("\n\n");
}
