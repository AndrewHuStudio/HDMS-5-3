import { describe, expect, it, vi, afterEach } from "vitest";

import { streamChat, type SSECallbacks } from "./sse-client";

function createSseResponse(payload: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function createCallbacks() {
  const calls = {
    thinking: [] as string[],
    answer: [] as string[],
    done: 0,
  };

  const callbacks: SSECallbacks = {
    onSources: () => {},
    onRetrievalStats: () => {},
    onGraph: () => {},
    onThinking: (token) => calls.thinking.push(token),
    onThinkingDone: () => {},
    onAnswer: (token) => calls.answer.push(token),
    onAnswerReplaced: () => {},
    onStatus: () => {},
    onDone: () => {
      calls.done += 1;
    },
    onError: () => {},
  };

  return { callbacks, calls };
}

describe("streamChat batching", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("coalesces contiguous thinking and answer tokens before dispatch", async () => {
    const payload = [
      'event: thinking',
      'data: {"content":"思"}',
      '',
      'event: thinking',
      'data: {"content":"考"}',
      '',
      'event: thinking_done',
      'data: {}',
      '',
      'event: answer',
      'data: {"content":"A"}',
      '',
      'event: answer',
      'data: {"content":"B"}',
      '',
      'event: done',
      'data: {}',
      '',
    ].join("\n");

    vi.stubGlobal("fetch", vi.fn(async () => createSseResponse(payload)));
    const { callbacks, calls } = createCallbacks();

    await streamChat("q", [], callbacks);

    expect(calls.thinking).toEqual(["思考"]);
    expect(calls.answer).toEqual(["AB"]);
    expect(calls.done).toBe(1);
  });
});
