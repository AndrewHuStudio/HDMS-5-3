import { prepareStreamingMarkdown } from "../features/qa/render/streaming-markdown-stability";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type PreparedLike = ReturnType<typeof prepareStreamingMarkdown> & {
  pendingRenderMode?: "markdown" | "plaintext" | "hidden";
};

function getPendingRenderMode(prepared: PreparedLike): "markdown" | "plaintext" | "hidden" {
  if (prepared.pendingRenderMode) return prepared.pendingRenderMode;
  return prepared.showPendingText ? "markdown" : "hidden";
}

const completeParagraph = `## 标题

深圳湾超级总部基地位于南山区，总用地面积约117公顷。
该区域规划定位为全球城市功能中心。
目前已完成一期建设。`;

const paragraphPrepared = prepareStreamingMarkdown(completeParagraph);
assert(
  paragraphPrepared.markdownForParser === completeParagraph,
  `expected complete paragraph block to remain stable.\n--- actual parser markdown ---\n${paragraphPrepared.markdownForParser}`,
);
assert(
  paragraphPrepared.pendingText === "",
  `expected no pending text for complete paragraph block.\n--- actual pending ---\n${paragraphPrepared.pendingText}`,
);
assert(
  getPendingRenderMode(paragraphPrepared) === "hidden",
  `expected complete paragraph block to have hidden pending mode, got ${getPendingRenderMode(paragraphPrepared)}`,
);

const completeTable = `## 指标对比

| 指标 | 深圳湾 | 前海 |
| --- | --- | --- |
| 容积率 | 6.5 | 4.0 |
| 建筑高度 | 300m | 250m |`;

const completeTablePrepared = prepareStreamingMarkdown(completeTable);
assert(
  completeTablePrepared.markdownForParser === completeTable,
  `expected complete table block to remain stable.\n--- actual parser markdown ---\n${completeTablePrepared.markdownForParser}`,
);
assert(
  completeTablePrepared.pendingText === "",
  `expected no pending text for complete table block.\n--- actual pending ---\n${completeTablePrepared.pendingText}`,
);
assert(
  getPendingRenderMode(completeTablePrepared) === "hidden",
  `expected complete table block to have hidden pending mode, got ${getPendingRenderMode(completeTablePrepared)}`,
);

const incompleteTable = `## 指标对比

| 指标 | 深圳湾 |
| --- | --- |
| MPE`;

const tablePrepared = prepareStreamingMarkdown(incompleteTable);
assert(
  tablePrepared.markdownForParser === "## 指标对比",
  `expected incomplete table block to be excluded from parser.\n--- actual parser markdown ---\n${tablePrepared.markdownForParser}`,
);
assert(
  tablePrepared.pendingText.startsWith("| 指标 | 深圳湾 |"),
  `expected table block to be isolated as pending text.\n--- actual pending ---\n${tablePrepared.pendingText}`,
);
assert(
  getPendingRenderMode(tablePrepared) === "plaintext",
  `expected incomplete table tail with visible text to downgrade to plaintext, got ${getPendingRenderMode(tablePrepared)}`,
);

const incompleteList = `## 详细解析

一、管控体系与方法差异

1. **深圳湾`;

const listPrepared = prepareStreamingMarkdown(incompleteList);
assert(
  listPrepared.markdownForParser === "## 详细解析\n\n一、管控体系与方法差异",
  `expected incomplete list tail to be excluded from parser.\n--- actual parser markdown ---\n${listPrepared.markdownForParser}`,
);
assert(
  listPrepared.pendingText === "1. **深圳湾",
  `expected incomplete list tail to be isolated as pending text.\n--- actual pending ---\n${listPrepared.pendingText}`,
);
assert(
  getPendingRenderMode(listPrepared) === "plaintext",
  `expected incomplete list tail with real text to render as plaintext, got ${getPendingRenderMode(listPrepared)}`,
);

const mathTail = `## 公式推导

稳定文本仍应保留。

面积为 $a+b`;

const mathPrepared = prepareStreamingMarkdown(mathTail);
assert(
  mathPrepared.markdownForParser === "## 公式推导\n\n稳定文本仍应保留。\n\n面积为",
  `expected unclosed inline math to be moved into pending text.\n--- actual parser markdown ---\n${mathPrepared.markdownForParser}`,
);
assert(
  mathPrepared.pendingText === "$a+b",
  `expected unclosed inline math suffix to remain pending.\n--- actual pending ---\n${mathPrepared.pendingText}`,
);
assert(
  getPendingRenderMode(mathPrepared) === "plaintext",
  `expected unclosed inline math suffix to render as plaintext, got ${getPendingRenderMode(mathPrepared)}`,
);

const pureSyntaxTail = `## 指标对比

| --- | --- |`;

const syntaxPrepared = prepareStreamingMarkdown(pureSyntaxTail);
assert(
  syntaxPrepared.markdownForParser === "## 指标对比",
  `expected pure syntax fragment to be excluded from parser.\n--- actual parser markdown ---\n${syntaxPrepared.markdownForParser}`,
);
assert(
  syntaxPrepared.pendingText === "| --- | --- |",
  `expected pure syntax fragment to stay in pending text.\n--- actual pending ---\n${syntaxPrepared.pendingText}`,
);
assert(
  getPendingRenderMode(syntaxPrepared) === "hidden",
  `expected pure syntax fragment to stay hidden, got ${getPendingRenderMode(syntaxPrepared)}`,
);

console.log("qa-streaming-stable-prefix-regression passed");
