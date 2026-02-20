import { describe, expect, it } from "vitest";

import { sanitizeAnswerCitations } from "./sanitize-answer-citations";

describe("sanitizeAnswerCitations", () => {
  it("keeps only the first occurrence of each valid citation label and removes invalid labels", () => {
    const out = sanitizeAnswerCitations({
      text: "A[1-1] B[1-1] C[2-1] D[9-9]",
      validLabels: new Set(["1-1", "2-1"]),
    });
    expect(out).toBe("A[1-1] B C[2-1] D");
  });

  it("does not touch citations inside fenced code blocks and does not count them as seen", () => {
    const out = sanitizeAnswerCitations({
      text: "```ts\nconst a = '[1-1]';\n```\nX[1-1]\nY[1-1]",
      validLabels: new Set(["1-1"]),
    });
    expect(out).toBe("```ts\nconst a = '[1-1]';\n```\nX[1-1]\nY");
  });

  it("does not touch citations inside inline code spans and does not count them as seen", () => {
    const out = sanitizeAnswerCitations({
      text: "a `x[1-1]` b[1-1] c[1-1]",
      validLabels: new Set(["1-1"]),
    });
    expect(out).toBe("a `x[1-1]` b[1-1] c");
  });
});

