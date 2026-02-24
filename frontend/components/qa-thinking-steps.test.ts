import { describe, expect, it } from "vitest";

import { buildThinkingSteps } from "./qa-thinking-steps";

describe("buildThinkingSteps", () => {
  it("starts at understanding by default", () => {
    const steps = buildThinkingSteps({});

    expect(steps[0].state).toBe("active");
    expect(steps[0].detail).toBe("正在理解你的问题...");
    expect(steps[1].state).toBe("pending");
    expect(steps[2].state).toBe("pending");
  });

  it("marks retrieval as active when stage is retrieving", () => {
    const steps = buildThinkingSteps({
      stage: "retrieving",
      statusMessage: "正在检索相关资料...",
    });

    expect(steps[0].state).toBe("done");
    expect(steps[1].state).toBe("active");
    expect(steps[1].detail).toBe("正在检索相关资料...");
  });

  it("shows retrieval summary and reasoning active at reasoning stage", () => {
    const steps = buildThinkingSteps({
      stage: "reasoning",
      statusMessage: "正在进行智能研判...",
      retrievalStats: {
        vector_count: 6,
        graph_count: 2,
        keyword_count: 4,
        fused_count: 5,
        reranked: true,
        cached: false,
        weights: {},
      },
    });

    expect(steps[1].state).toBe("done");
    expect(steps[1].detail).toBe("已检索 12 条候选，融合 5 条内容");
    expect(steps[2].state).toBe("active");
    expect(steps[2].detail).toBe("正在进行智能研判...");
  });
});
