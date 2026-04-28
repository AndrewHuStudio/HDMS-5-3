function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type MarkdownShapeMetrics = {
  orderedListLines: number;
  bulletListLines: number;
  nestedOrderedListLines: number;
  nestedBulletListLines: number;
};

function inspectMarkdownShape(markdown: string): MarkdownShapeMetrics {
  const text = String(markdown || "");
  return {
    orderedListLines: (text.match(/^\s{0,3}\d+[.)]\s+\S+/gm) || []).length,
    bulletListLines: (text.match(/^\s{0,3}[-*+]\s+\S+/gm) || []).length,
    nestedOrderedListLines: (text.match(/^\s{4,}\d+[.)]\s+\S+/gm) || []).length,
    nestedBulletListLines: (text.match(/^\s{4,}[-*+]\s+\S+/gm) || []).length,
  };
}

function shouldAcceptAnswerReplacement(current: string, replacement: string): boolean {
  const cur = inspectMarkdownShape(current);
  const next = inspectMarkdownShape(replacement);

  if (
    cur.orderedListLines > 0 &&
    next.orderedListLines < cur.orderedListLines &&
    next.bulletListLines > cur.bulletListLines
  ) {
    return false;
  }

  if (
    cur.nestedOrderedListLines > 0 &&
    next.nestedOrderedListLines < cur.nestedOrderedListLines
  ) {
    return false;
  }

  if (
    cur.nestedBulletListLines > 0 &&
    next.nestedBulletListLines < cur.nestedBulletListLines
  ) {
    return false;
  }

  return true;
}

const current = `## 二、合规核查要点

1. 一级核查
    1. 二级核查
        - 细项A
2. 另一个一级核查
    - 细项B`;

const degraded = `## 二、合规核查要点

1. 一级核查
2. 二级核查
    - 细项A
3. 另一个一级核查
    - 细项B`;

const accepted = shouldAcceptAnswerReplacement(current, degraded);

assert(accepted === false, "expected list-shape guard to reject nested ordered-list flattening");

console.log("qa-answer-replacement-list-shape-guard-regression passed");

export {};
