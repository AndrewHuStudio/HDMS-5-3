import type { RetrievalStats } from "@/features/qa/types";

export type ThinkingStepState = "pending" | "active" | "done";

export interface ThinkingStep {
  key: "understanding" | "retrieving" | "reasoning";
  label: string;
  state: ThinkingStepState;
  detail?: string;
}

function summarizeRetrieval(stats?: RetrievalStats): string | undefined {
  if (!stats) return undefined;
  const totalHits = stats.vector_count + stats.graph_count + stats.keyword_count;
  return `已检索 ${totalHits} 条候选，融合 ${stats.fused_count} 条内容`;
}

export function buildThinkingSteps(input: {
  stage?: string;
  statusMessage?: string;
  retrievalStats?: RetrievalStats;
}): ThinkingStep[] {
  const stage = (input.stage || "").trim().toLowerCase();
  const retrievalSummary = summarizeRetrieval(input.retrievalStats);

  const steps: ThinkingStep[] = [
    {
      key: "understanding",
      label: "分析问题",
      state: "pending",
      detail: "正在分析问题意图...",
    },
    {
      key: "retrieving",
      label: "检索结果",
      state: "pending",
    },
    {
      key: "reasoning",
      label: "智能研判",
      state: "pending",
      detail: "正在综合证据并形成判断...",
    },
  ];

  if (stage === "retrieving") {
    steps[0].state = "done";
    steps[1].state = "active";
    steps[1].detail = input.statusMessage || "正在检索相关资料...";
  } else if (stage === "reasoning" || stage === "generating") {
    steps[0].state = "done";
    steps[1].state = "done";
    steps[1].detail = retrievalSummary;
    steps[2].state = "active";
    steps[2].detail = input.statusMessage || "正在进行智能研判...";
  } else {
    steps[0].state = "active";
    steps[0].detail = input.statusMessage || "正在分析你的问题...";
  }

  if (!steps[1].detail && retrievalSummary) {
    steps[1].detail = retrievalSummary;
  }

  return steps;
}
