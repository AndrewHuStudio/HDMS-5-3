import fs from "node:fs";
import path from "node:path";


function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = process.cwd();
const deletedComponents = [
  "components/qa-thinking.tsx",
  "components/qa-thinking-collapse.ts",
  "components/qa-thinking-status.ts",
  "components/qa-thinking-ellipsis.ts",
];

for (const relativePath of deletedComponents) {
  assert(!fs.existsSync(path.resolve(root, relativePath)), `expected ${relativePath} to be deleted`);
}

const activeFiles = [
  "lib/sse-client.ts",
  "features/qa/qa-view.tsx",
  "features/qa/types.ts",
  "features/qa/render/assistant-render-state-machine.ts",
  "lib/stores/qa-store.ts",
  "lib/stream-source-utils.ts",
  "components/qa-new/qa-assistant-content.tsx",
  "app/globals.css",
];
const forbidden = [
  /thinking_done/,
  /ThinkingProcess/,
  /thinkingDone/,
  /onThinking/,
  /showThinking/,
  /hasThinking/,
  /mergeThinkingIntoAnswer/,
  /qa-thinking/,
  /\bthinking\b/,
  /\breasoning\b/,
];

for (const relativePath of activeFiles) {
  const source = fs.readFileSync(path.resolve(root, relativePath), "utf8");
  for (const pattern of forbidden) {
    assert(!pattern.test(source), `expected ${relativePath} not to contain ${pattern}`);
  }
}

console.log("qa-no-thinking-pipeline-regression passed");
