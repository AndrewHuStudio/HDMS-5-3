import assert from "node:assert/strict";
import { buildAnswerMarkdown } from "../features/qa/render/answer-markdown-pipeline";
import type { SourceInfo } from "../features/qa/types";

const sources: SourceInfo[] = [
  {
    type: "document",
    name: "深圳湾科技生态园空间控制图.pdf",
    source: "vector_search",
    citation_label: "1-3",
    doc_id: "demo-doc",
    chunk_id: "demo-chunk-1-3",
    image_url: "/api/rag/documents/demo-doc/image?ref=overview.png",
    image_name: "overview.png",
    image_figures: ["图1"],
    image_captions: ["参考配图"],
  },
];

const input = `## 检索综述

> 检索资料清单与引用分析：检索资料清单：①*深圳湾科技生态园空间控制图*。引用定位：①命中章节“深圳湾科技生态城项目”。上述资料共同构成了本次回答的依据链条。
>
> 例如（图1）可能揭示高层空间布局逻辑[1-3]。

建议行动：

1. 获取[1-3]中空间控制图的完整图示（特别是（图1）和（图2））解析具体管控边界[1-3]。`;

const markdown = buildAnswerMarkdown({
  content: input,
  sources,
  isStreaming: false,
  renderPhase: "final",
  precedingQuestion: "请解释空间控制图中的图示内容",
});

const retrievalIndex = markdown.indexOf("## 检索综述");
const detailIndex = markdown.indexOf("## 详细解析");
assert(retrievalIndex >= 0, `expected retrieval overview heading, got:\n${markdown}`);
assert(detailIndex > retrievalIndex, `expected detailed-analysis heading after retrieval overview, got:\n${markdown}`);

const retrievalBlock = markdown.slice(retrievalIndex, detailIndex);
const detailBlock = markdown.slice(detailIndex);

assert.doesNotMatch(
  retrievalBlock,
  /!\[[^\]]*\]\([^)]+\)|FIGCAPTION|建议行动|例如（图1）/u,
  `expected retrieval overview to remain text-only, got:\n${retrievalBlock}`,
);
assert.match(
  detailBlock,
  /!\[[^\]]*\]\([^)]+\)/u,
  `expected image markdown to appear in detailed analysis, got:\n${detailBlock}`,
);
assert.match(
  detailBlock,
  /FIGCAPTION\s+图1/u,
  `expected figure caption to appear in detailed analysis, got:\n${detailBlock}`,
);
assert.match(
  detailBlock,
  /建议行动/u,
  `expected migrated action content to remain visible in detailed analysis, got:\n${detailBlock}`,
);

console.log("qa-retrieval-overview-image-boundary-regression passed");
