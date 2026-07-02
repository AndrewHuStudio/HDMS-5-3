export function sanitizeDomToken(value?: string | null): string {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "item";
}

export function buildCitationTargetId(
  label: string,
  messageId?: string,
): string {
  const safeLabel = sanitizeDomToken(label);
  return messageId
    ? `source-${sanitizeDomToken(messageId)}-${safeLabel}`
    : `source-${safeLabel}`;
}

export function buildCitationTargetHref(
  label: string,
  messageId?: string,
): string {
  return `#${buildCitationTargetId(label, messageId)}`;
}

export function buildCitationOriginId({
  label,
  messageId,
  instanceId,
}: {
  label: string;
  messageId?: string;
  instanceId: string;
}): string {
  return `citation-origin-${sanitizeDomToken(messageId)}-${sanitizeDomToken(label)}-${sanitizeDomToken(instanceId)}`;
}

export function buildCitationSourcePanelScrollerId(messageId?: string): string {
  return `citation-source-list-${sanitizeDomToken(messageId)}`;
}

export function buildCitationTargetMessageToken(messageId?: string): string {
  return sanitizeDomToken(messageId);
}
