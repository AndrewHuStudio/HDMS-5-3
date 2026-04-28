import assert from "node:assert/strict";
import { splitAnswerSupplements } from "../features/qa/render/answer-supplements";

const retrievalOverviewLeak = `## 检索综述

> 检索资料清单与引用分析：检索资料清单：①*深圳湾科技生态园空间控制图*。引用定位：①命中章节“深圳湾科技生态城项目”。上述资料共同构成了本次回答的依据链条。
>
> 补充： 当前资料未包含具体管控指标（如密度/高度等），建议补充文本类管控文件深化分析。

## 详细解析

基于提供的图纸资料，可以确认其空间分层逻辑。`;

const splitFromOverview = splitAnswerSupplements(retrievalOverviewLeak);

assert.equal(
  splitFromOverview.supplements.length,
  1,
  `expected one supplement to be extracted, got ${splitFromOverview.supplements.length}`,
);
assert.match(
  splitFromOverview.supplements[0]?.markdown || "",
  /当前资料未包含具体管控指标/u,
  "expected supplement card body to keep the note content",
);
assert.doesNotMatch(
  splitFromOverview.markdown,
  />\s*补充[:：]/u,
  `expected retrieval overview supplement to be removed from main markdown, got:\n${splitFromOverview.markdown}`,
);
assert.match(
  splitFromOverview.markdown,
  />\s*检索资料清单与引用分析[:：]/u,
  "expected retrieval overview summary blockquote to stay in main markdown",
);
assert.match(
  splitFromOverview.markdown,
  /## 详细解析/u,
  "expected detailed-analysis section to remain in main markdown",
);

const trailingSupplement = `## 详细解析

主回答正文。

补充： 建议补充最新文本管控条件，以便进一步核对高度与强度指标。`;

const splitFromTail = splitAnswerSupplements(trailingSupplement);

assert.equal(
  splitFromTail.supplements.length,
  1,
  `expected one trailing supplement to be extracted, got ${splitFromTail.supplements.length}`,
);
assert.doesNotMatch(
  splitFromTail.markdown,
  /补充[:：]/u,
  `expected trailing supplement to be removed from main markdown, got:\n${splitFromTail.markdown}`,
);
assert.match(
  splitFromTail.markdown,
  /主回答正文/u,
  "expected main answer body to remain after trailing supplement extraction",
);

console.log("qa-supplement-placement-regression passed");
