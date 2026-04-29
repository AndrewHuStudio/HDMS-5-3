export function buildCitationTargetId(
  label: string,
  messageId?: string,
): string {
  return messageId ? `source-${messageId}-${label}` : `source-${label}`;
}

export function buildCitationTargetHref(
  label: string,
  messageId?: string,
): string {
  return `#${buildCitationTargetId(label, messageId)}`;
}
