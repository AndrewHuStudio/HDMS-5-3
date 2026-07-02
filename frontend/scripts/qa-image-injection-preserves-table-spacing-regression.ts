import assert from "node:assert/strict";
import { normalizeListItemBlocks } from "../lib/normalize-list-item-blocks";
import { normalizeAnswerTables } from "../lib/normalize-answer-tables";
import { normalizeAnswerMarkdownByPhase } from "../features/qa/render/markdown-normalization-pipeline";
import { processAnswerCitations } from "../features/qa/citation-engine/core/process-answer-citations";
import { injectAnswerImagesByPhase } from "../features/qa/render/image-injection-pipeline";
import type { SourceInfo } from "../features/qa/types";

const content = `## 详细解析

一、核心管控机制

1. 分层立体化控制 采用垂直分区模式明确各层功能定位（见图表）： | 空间层级 | 管控重点 | 对应图纸 |
| --- | --- | --- |
| 地下下一二层 | 设备用房/停车空间布局 | 图号05 |
| 地面下一层 | 商业衔接交通枢纽 | 图号04 |

1. 场所空间定制化
- 通过场所剖示图[1-5]解析公共空间的人流动线与生态节点
- 结合剖面设计控制视线通廊与绿色渗透（如空中连廊体系）[1-4]`;

const sources: SourceInfo[] = [
  { type: "vector", source: "vector", citation_label: "1-4", name: "空间控制图" },
  { type: "vector", source: "vector", citation_label: "1-5", name: "场所剖示图" },
];

const step1 = normalizeListItemBlocks(content);
const step2 = normalizeAnswerTables(step1);
const step3 = normalizeAnswerMarkdownByPhase({ content: step2, renderPhase: "final" });
const step4 = processAnswerCitations({ text: step3, sources, isStreaming: false });
const step5 = injectAnswerImagesByPhase({ markdown: step4, sources, renderPhase: "final" });

assert.match(step4, /\n\n\| 空间层级 \| 管控重点 \| 对应图纸 \|\n/u, "expected citation processing stage to preserve a blank-line boundary before the table");
assert.match(step4, /\|\n\n2\. 场所空间定制化/u, "expected citation processing stage to preserve a blank-line boundary after the table");
assert.match(step5, /\n\n\| 空间层级 \| 管控重点 \| 对应图纸 \|\n/u, "expected image injection stage to keep the blank-line boundary before the table when no images are injected");
assert.match(step5, /\|\n\n2\. 场所空间定制化/u, "expected image injection stage to keep the blank-line boundary after the table when no images are injected");

console.log("qa-image-injection-preserves-table-spacing-regression passed");
