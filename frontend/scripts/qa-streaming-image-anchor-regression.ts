import assert from "node:assert/strict";
import { buildAnswerMarkdown } from "../features/qa/render/answer-markdown-pipeline";
import type { SourceInfo } from "../features/qa/types";

const imageUrl = "/api/rag/documents/demo/image?ref=street.png";
const sources: SourceInfo[] = [{
  type: "document",
  name: "城市设计导则.pdf",
  source: "vector",
  citation_label: "1-1",
  doc_id: "demo",
  image_url: imageUrl,
  image_captions: ["街道空间示意图"],
}];

const beforeAnchor = buildAnswerMarkdown({
  content: "街道空间应连续，并处理好界面关系（见图1）。[1-1]",
  sources,
  isStreaming: true,
  renderPhase: "streaming",
  precedingQuestion: "城市设计如何进行？",
});

assert.doesNotMatch(
  beforeAnchor,
  new RegExp(imageUrl.replace(/[.?]/g, "\\$&")),
  `expected source images to wait for a streamed image anchor, got:\n${beforeAnchor}`,
);

const afterAnchor = buildAnswerMarkdown({
  content: "街道空间应连续，并处理好界面关系。[1-1]\n\n[[IMG:1-1#1]]",
  sources,
  isStreaming: true,
  renderPhase: "streaming",
  precedingQuestion: "城市设计如何进行？",
});

assert.match(
  afterAnchor,
  new RegExp(imageUrl.replace(/[.?]/g, "\\$&")),
  `expected the image to appear with its streamed anchor, got:\n${afterAnchor}`,
);

console.log("qa-streaming-image-anchor-regression passed");
