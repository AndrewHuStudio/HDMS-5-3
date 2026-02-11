"use client";

import { useMemo, useState } from "react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Network, List } from "lucide-react";
import type { CityElement } from "@/lib/city-data";

// 动态导入 ForceGraph2D 以避免 SSR 问题
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

interface GraphNode {
  id: string;
  name: string;
  type: "element" | "control" | "knowledge";
  val?: number;
}

interface GraphLink {
  source: string;
  target: string;
}

interface KnowledgeGraphProps {
  selectedElement: CityElement | null;
}

const defaultControls = [
  { id: "control-height", name: "建筑限高", description: "控制天际线与城市风貌" },
  { id: "control-setback", name: "建筑退线", description: "保障街道尺度与公共安全" },
  { id: "control-far", name: "容积率", description: "衡量开发强度与用地效率" },
  { id: "control-density", name: "建筑密度", description: "平衡建设量与开放空间" },
  { id: "control-greenspace", name: "绿地率", description: "提升生态与景观品质" },
  { id: "control-parking", name: "停车配建", description: "匹配交通与停车需求" },
  { id: "control-sunlight", name: "日照要求", description: "保障居住舒适度" },
  { id: "control-fire", name: "消防通道", description: "满足应急安全要求" },
  { id: "control-view", name: "视廊保护", description: "维护城市景观视线" },
  { id: "control-traffic", name: "交通影响", description: "评估路网承载" },
];

const defaultKnowledgePoints = [
  { id: "knowledge-skyline", name: "风貌控制", description: "天际线与城市特色" },
  { id: "knowledge-safety", name: "公共安全", description: "疏散与应急保障" },
  { id: "knowledge-ecology", name: "生态品质", description: "绿地与舒适度" },
  { id: "knowledge-transport", name: "交通承载", description: "出行效率与停车" },
  { id: "knowledge-intensity", name: "开发强度", description: "建设量与用地效率" },
  { id: "knowledge-openness", name: "空间开放度", description: "公共空间与通行尺度" },
];

export function KnowledgeGraph({ selectedElement }: KnowledgeGraphProps) {
  const [viewMode, setViewMode] = useState<"graph" | "list">("list");
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const graphBackground = isDark ? "#0f172a" : "#ffffff";
  const graphLabelBackground = isDark ? "rgba(15, 23, 42, 0.85)" : "rgba(255, 255, 255, 0.8)";
  const graphLabelColor = isDark ? "#e2e8f0" : "#1f2937";
  const graphLinkColor = isDark ? "#334155" : "#cbd5e1";

  // 将选中元素的数据转换为图谱数据
  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    if (selectedElement) {
      nodes.push({
        id: selectedElement.id,
        name: selectedElement.name,
        type: "element",
        val: 20,
      });

      selectedElement.controls.forEach((control) => {
        nodes.push({
          id: control.id,
          name: control.name,
          type: "control",
          val: 10,
        });
        links.push({
          source: selectedElement.id,
          target: control.id,
        });
      });

      selectedElement.knowledgeBase.forEach((kb, index) => {
        const kbId = `kb-${selectedElement.id}-${index}`;
        nodes.push({
          id: kbId,
          name: kb.substring(0, 30) + (kb.length > 30 ? "..." : ""),
          type: "knowledge",
          val: 8,
        });
        links.push({
          source: selectedElement.id,
          target: kbId,
        });
      });

      return { nodes, links };
    }

    nodes.push({
      id: "city-control",
      name: "城市管控要素",
      type: "element",
      val: 22,
    });

    defaultControls.forEach((control) => {
      nodes.push({
        id: control.id,
        name: control.name,
        type: "control",
        val: 10,
      });
      links.push({ source: "city-control", target: control.id });
    });

    defaultKnowledgePoints.forEach((point) => {
      nodes.push({
        id: point.id,
        name: point.name,
        type: "knowledge",
        val: 8,
      });
    });

    links.push(
      { source: "control-height", target: "knowledge-skyline" },
      { source: "control-view", target: "knowledge-skyline" },
      { source: "control-sunlight", target: "knowledge-ecology" },
      { source: "control-greenspace", target: "knowledge-ecology" },
      { source: "control-parking", target: "knowledge-transport" },
      { source: "control-traffic", target: "knowledge-transport" },
      { source: "control-fire", target: "knowledge-safety" },
      { source: "control-setback", target: "knowledge-safety" },
      { source: "control-far", target: "knowledge-intensity" },
      { source: "control-density", target: "knowledge-intensity" },
      { source: "control-setback", target: "knowledge-openness" },
      { source: "control-density", target: "knowledge-openness" }
    );

    return { nodes, links };
  }, [selectedElement]);

  // 节点颜色配置
  const getNodeColor = (node: GraphNode) => {
    switch (node.type) {
      case "element":
        return "#3b82f6"; // 蓝色 - 城市要素
      case "control":
        return "#10b981"; // 绿色 - 管控指标
      case "knowledge":
        return "#f59e0b"; // 橙色 - 知识库
      default:
        return "#6b7280";
    }
  };

  return (
    <div className="space-y-4">
      {/* 视图切换按钮 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">知识图谱</h3>
        <div className="flex gap-2">
          <Button
            variant={viewMode === "list" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("list")}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "graph" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("graph")}
          >
            <Network className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 列表视图 */}
      {viewMode === "list" && (
        <div className="space-y-4">
          {selectedElement ? (
            <>
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                  管控指标 ({selectedElement.controls.length})
                </h4>
                <div className="space-y-2">
                  {selectedElement.controls.map((control) => (
                    <div
                      key={control.id}
                      className="p-3 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800 rounded-lg text-sm"
                    >
                      <p className="font-medium text-emerald-900 dark:text-emerald-100">{control.name}</p>
                      <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                        当前: {control.currentValue}
                        {control.unit} / 限制: {control.limitValue}
                        {control.unit}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                  知识库 ({selectedElement.knowledgeBase.length})
                </h4>
                <div className="space-y-2">
                  {selectedElement.knowledgeBase.map((kb, index) => (
                    <div
                      key={index}
                      className="p-3 bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800 rounded-lg text-sm"
                    >
                      <p className="text-amber-900 dark:text-amber-100">{kb}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                  核心管控要素 ({defaultControls.length})
                </h4>
                <div className="space-y-2">
                  {defaultControls.map((control) => (
                    <div
                      key={control.id}
                      className="p-3 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800 rounded-lg text-sm"
                    >
                      <p className="font-medium text-emerald-900 dark:text-emerald-100">{control.name}</p>
                      <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">{control.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">
                  知识点关联 ({defaultKnowledgePoints.length})
                </h4>
                <div className="space-y-2">
                  {defaultKnowledgePoints.map((point) => (
                    <div
                      key={point.id}
                      className="p-3 bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800 rounded-lg text-sm"
                    >
                      <p className="font-medium text-amber-900 dark:text-amber-100">{point.name}</p>
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">{point.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* 图谱视图 */}
      {viewMode === "graph" && (
        <div className="space-y-2">
          <div className="h-[500px] border border-border rounded-lg bg-card overflow-hidden">
            <ForceGraph2D
              graphData={graphData}
              nodeLabel="name"
              nodeColor={getNodeColor as any}
              nodeRelSize={6}
              linkColor={() => graphLinkColor}
              linkWidth={2}
              width={320}
              height={500}
              backgroundColor={graphBackground}
              nodeCanvasObject={(node: any, ctx, globalScale) => {
                const label = node.name;
                const fontSize = 12 / globalScale;
                ctx.font = `${fontSize}px Sans-Serif`;
                const textWidth = ctx.measureText(label).width;
                const bckgDimensions = [textWidth, fontSize].map(
                  (n) => n + fontSize * 0.4
                );

                // 绘制节点圆圈
                ctx.fillStyle = getNodeColor(node);
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.val || 5, 0, 2 * Math.PI, false);
                ctx.fill();

                // 绘制文字背景
                ctx.fillStyle = graphLabelBackground;
                ctx.fillRect(
                  node.x - bckgDimensions[0] / 2,
                  node.y - bckgDimensions[1] / 2 + (node.val || 5) + 5,
                  bckgDimensions[0],
                  bckgDimensions[1]
                );

                // 绘制文字
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = graphLabelColor;
                ctx.fillText(
                  label,
                  node.x,
                  node.y + (node.val || 5) + 5 + fontSize / 2
                );
              }}
              onNodeClick={(node: any) => {
                console.log("点击节点:", node);
              }}
            />
          </div>

          {/* 图例 */}
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-muted-foreground">城市要素</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500" />
              <span className="text-muted-foreground">管控指标</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-amber-500" />
              <span className="text-muted-foreground">知识库</span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            提示: 可以拖拽节点、滚轮缩放、点击节点查看详情
          </p>
        </div>
      )}
    </div>
  );
}
