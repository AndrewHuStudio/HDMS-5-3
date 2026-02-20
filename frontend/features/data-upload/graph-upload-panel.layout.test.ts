import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("graph dialog layout", () => {
  it("keeps graph dialog container clipped to avoid detached graph canvas", () => {
    const text = readFileSync(resolve(__dirname, "graph-upload-panel.tsx"), "utf8");
    expect(text).toContain("w-[calc(100vw-4rem)]");
    expect(text).toContain("h-[calc(100vh-4rem)]");
    expect(text).toContain("flex flex-col overflow-hidden");
    expect(text).toContain("flex-1 min-h-0 px-6 py-3 overflow-hidden");
  });

  it("supports ESC key to close the graph dialog", () => {
    const text = readFileSync(resolve(__dirname, "graph-upload-panel.tsx"), "utf8");
    expect(text).toContain('event.key === "Escape"');
    expect(text).toContain("setShowGraphDialog(false)");
    expect(text).toContain("window.addEventListener(\"keydown\", onEsc)");
  });

  it("anchors force-graph canvas inside a positioned container", () => {
    const text = readFileSync(resolve(__dirname, "..", "..", "components", "knowledge-graph.tsx"), "utf8");
    expect(text).toContain("relative flex-1 min-h-0 overflow-hidden");
  });

  it("shows a progress column in graph build table", () => {
    const text = readFileSync(resolve(__dirname, "graph-upload-panel.tsx"), "utf8");
    expect(text).toContain(">进度<");
    expect(text).toContain("getGraphProgressValue");
    expect(text).toContain("<Progress value={progressValue}");
    expect(text).toContain("{progressValue}%");
  });

  it("renders node and relation counters in the graph dialog top board", () => {
    const text = readFileSync(resolve(__dirname, "graph-upload-panel.tsx"), "utf8");
    expect(text).toContain("graph-counter-board");
    expect(text).toContain("节点数");
    expect(text).toContain("关系数");
    expect(text).toContain("展示节点数");
    expect(text).not.toContain("初始节点数");
    expect(text).not.toContain("htmlFor=\"graph-limit\"");
    expect(text).not.toContain("知识图谱展示");
    expect(text).toContain("h-12 min-w-[4rem] rounded-md border");
  });

  it("keeps legend fixed at the left side of graph panel", () => {
    const text = readFileSync(resolve(__dirname, "..", "..", "components", "knowledge-graph.tsx"), "utf8");
    expect(text).toContain("graph-legend-rail");
    expect(text).toContain("h-full shrink-0 border-r");
    expect(text).toContain("EyeOff");
    expect(text).toContain("onToggleNodeType");
    expect(text).not.toContain("点击节点可在左侧查看详情");
    expect(text).not.toContain("ID: {selectedNode.id}");
    expect(text).toContain("const [legendWidth, setLegendWidth]");
    expect(text).toContain("onMouseDown={startResizeLegend}");
    expect(text).toContain("cursor-col-resize");
    expect(text).toContain("for (const node of rawGraphData.nodes)");
  });

  it("uses icon-only refresh action and removes legacy sort hint text", () => {
    const text = readFileSync(resolve(__dirname, "graph-upload-panel.tsx"), "utf8");
    expect(text).toContain("size=\"icon\"");
    expect(text).toContain("aria-label=\"刷新图谱\"");
    expect(text).not.toContain("按连接数排序加载");
  });

  it("enforces numeric clamp and blur correction for displayed node count input", () => {
    const text = readFileSync(resolve(__dirname, "graph-upload-panel.tsx"), "utf8");
    expect(text).toContain('inputMode="numeric"');
    expect(text).toContain("handleGraphLimitBlur();");
    expect(text).toContain("Math.min(maxAvailableNodes, Math.max(1, Math.floor(n)))");
  });

  it("does not truncate related node list to a fixed top-N", () => {
    const text = readFileSync(resolve(__dirname, "..", "..", "components", "knowledge-graph.tsx"), "utf8");
    expect(text).not.toContain(".slice(0, 10)");
  });

  it("keeps top counters in one row and highlights edited node input", () => {
    const text = readFileSync(resolve(__dirname, "graph-upload-panel.tsx"), "utf8");
    expect(text).toContain("graph-counter-board flex items-end gap-2 flex-nowrap");
    expect(text).not.toContain("graph-counter-board flex items-end gap-2 flex-nowrap overflow-x-auto");
    expect(text).toContain("isGraphLimitDirty");
    expect(text).toContain("bg-amber-50");
    expect(text).toContain("mt-0.5 h-5 flex items-end");
    expect(text).toContain("h-5 w-20 self-end");
  });

  it("uses border-only hover for legend eye icon and relation flow layout", () => {
    const text = readFileSync(resolve(__dirname, "..", "..", "components", "knowledge-graph.tsx"), "utf8");
    expect(text).toContain("hover:bg-transparent");
    expect(text).toContain("hover:border-border/70");
    expect(text).toContain("relation-flow");
    expect(text).toContain("hexToRgba(");
    expect(text).toContain("neighborType");
    expect(text).toContain("{item.fromLabel} - {item.type} - {item.toLabel}");
    expect(text).not.toContain("类型关系：");
    expect(text).not.toContain("{item.fromLabel} · {item.toLabel}");
  });

  it("applies force tuning and lighter link visuals for dense graph readability", () => {
    const text = readFileSync(resolve(__dirname, "..", "..", "components", "knowledge-graph.tsx"), "utf8");
    expect(text).toContain("graphRef.current?.d3Force(\"charge\")?.strength");
    expect(text).toContain("graphRef.current?.d3Force(\"link\")?.distance");
    expect(text).toContain("graphRef.current?.d3Force(\"link\")?.strength");
    expect(text).toContain("graphRef.current?.d3Force(");
    expect(text).toContain("\"collide\"");
    expect(text).toContain("forceCollide(");
    expect(text).toContain("linkWidth={(link: any)");
    expect(text).toContain("linkDirectionalArrowLength={3.2}");
    expect(text).toContain("linkColor={(link: any)");
  });

  it("renders node labels inside the node body", () => {
    const text = readFileSync(resolve(__dirname, "..", "..", "components", "knowledge-graph.tsx"), "utf8");
    expect(text).toContain("ctx.textBaseline = \"middle\";");
    expect(text).toContain("const labelY = ny;");
  });

  it("uses the research SCI palette for nodes, legend and node detail cards", () => {
    const text = readFileSync(resolve(__dirname, "..", "..", "components", "knowledge-graph.tsx"), "utf8");
    expect(text).toContain('法规: "#274753"');
    expect(text).toContain('标准: "#297270"');
    expect(text).toContain('空间要素: "#299d8f"');
    expect(text).toContain('片区: "#8ab07c"');
    expect(text).toContain('Document: "#e7c66b"');
    expect(text).toContain('导则: "#f3a361"');
    expect(text).toContain('地块: "#e66d50"');
    expect(text).toContain("selectedNodeColor = selectedNode ? NODE_COLORS[selectedNode.label]");
    expect(text).toContain("style={{ backgroundColor: NODE_COLORS[type] || \"#6b7280\" }}");
  });
});
