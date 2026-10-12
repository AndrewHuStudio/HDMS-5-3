import assert from "node:assert/strict";

import { streamChat } from "../lib/sse-client";
import type { AnswerDocument } from "../features/qa/types";


const payload: AnswerDocument = {
  sections: [
    {
      id: "section-1",
      markdown: "建筑退线要求。[1-1]",
      source_labels: ["1-1"],
      images: [{ id: "img-a", url: "/a.png", caption: "退线图", source_label: "1-1" }],
    },
  ],
};
const encoded = new TextEncoder().encode(
  `event: answer_document\ndata: ${JSON.stringify({ ...payload, sources: [] })}\n\n` +
  `event: done\ndata: {"model":"test"}\n\n`,
);

globalThis.fetch = async () => new Response(encoded, {
  status: 200,
  headers: { "Content-Type": "text/event-stream" },
});

async function main() {
  let received: AnswerDocument | undefined;
  await streamChat("question", [], {
    onSources: () => undefined,
    onRetrievalStats: () => undefined,
    onGraph: () => undefined,
    onAnswer: () => undefined,
    onAnswerDocument: (document) => { received = document; },
    onStatus: () => undefined,
    onDone: () => undefined,
    onError: (detail) => { throw new Error(detail); },
  });

  assert.deepEqual(received, payload);
  console.log("qa-structured-answer-sse-regression passed");
}

void main();
