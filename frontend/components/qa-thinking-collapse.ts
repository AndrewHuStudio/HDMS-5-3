export function resolveThinkingFinishedState(input: {
  hasThinkingTokens: boolean;
  isStreaming: boolean;
  thinkingDone?: boolean;
}): boolean {
  return input.hasThinkingTokens && (Boolean(input.thinkingDone) || !input.isStreaming);
}

export function shouldAutoCollapseThinking(
  previousThinkingFinished: boolean,
  currentThinkingFinished: boolean,
): boolean {
  return !previousThinkingFinished && currentThinkingFinished;
}
