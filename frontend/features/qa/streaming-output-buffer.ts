export const STREAMING_OUTPUT_FRAME_CHAR_LIMIT = 96;

export function takeStreamingFrameChunk(
  buffer: string,
  maxChars: number = STREAMING_OUTPUT_FRAME_CHAR_LIMIT,
): { chunk: string; remaining: string } {
  if (!buffer) {
    return { chunk: "", remaining: "" };
  }

  const safeLimit = Math.max(1, Math.floor(maxChars));
  if (buffer.length <= safeLimit) {
    return { chunk: buffer, remaining: "" };
  }

  let end = safeLimit;
  const previousCodeUnit = buffer.charCodeAt(end - 1);
  const nextCodeUnit = buffer.charCodeAt(end);
  if (
    previousCodeUnit >= 0xd800 &&
    previousCodeUnit <= 0xdbff &&
    nextCodeUnit >= 0xdc00 &&
    nextCodeUnit <= 0xdfff
  ) {
    end += 1;
  }

  return {
    chunk: buffer.slice(0, end),
    remaining: buffer.slice(end),
  };
}
