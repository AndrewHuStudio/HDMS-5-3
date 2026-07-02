import {
  STREAMING_OUTPUT_FRAME_CHAR_LIMIT,
  takeStreamingFrameChunk,
} from "../features/qa/streaming-output-buffer";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const largeTokenBatch = "深圳湾超级总部基地公共空间管控要求。".repeat(30);
const firstFrame = takeStreamingFrameChunk(largeTokenBatch);

assert(
  firstFrame.chunk.length <= STREAMING_OUTPUT_FRAME_CHAR_LIMIT + 1,
  `expected one UI frame to flush at most ${STREAMING_OUTPUT_FRAME_CHAR_LIMIT} chars, got ${firstFrame.chunk.length}`,
);
assert(
  firstFrame.remaining.length > 0,
  "expected a large network token batch to leave text for later frames",
);

let rebuilt = firstFrame.chunk;
let remaining = firstFrame.remaining;
let guard = 0;
while (remaining) {
  const next = takeStreamingFrameChunk(remaining);
  rebuilt += next.chunk;
  remaining = next.remaining;
  guard += 1;
  assert(guard < 100, "streaming frame chunker did not drain the buffer");
}

assert(rebuilt === largeTokenBatch, "expected frame chunks to preserve the original text exactly");

const emojiBatch = `${"规划指标".repeat(40)}😀后续文本`;
let cursor = emojiBatch;
let emojiRebuilt = "";
while (cursor) {
  const next = takeStreamingFrameChunk(cursor, emojiBatch.indexOf("😀") + 1);
  emojiRebuilt += next.chunk;
  cursor = next.remaining;
}

assert(emojiRebuilt === emojiBatch, "expected frame chunks not to split surrogate pairs");

console.log("qa-streaming-output-frame-budget-regression passed");
