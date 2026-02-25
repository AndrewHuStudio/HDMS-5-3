export type ThinkingHeaderState = "thinking" | "history";

export function resolveThinkingHeaderState(input: {
  isStreaming: boolean;
  thinkingDone?: boolean;
  hasThinkingTokens: boolean;
}): ThinkingHeaderState {
  const shouldShowHistory = input.hasThinkingTokens;
  return shouldShowHistory ? "history" : "thinking";
}
