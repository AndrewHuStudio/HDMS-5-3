import {
  buildCitationTargetId,
  buildCitationTargetMessageToken,
} from "./dom-targets";

type ScrollContainer = Pick<HTMLElement, "scrollTop" | "clientHeight" | "getBoundingClientRect" | "scrollTo"> &
  Partial<Pick<HTMLElement, "contains" | "parentElement" | "scrollHeight">>;
type DocumentRef = Pick<Document, "getElementById"> & Partial<Pick<Document, "querySelector">>;
type ScrollTarget = Pick<HTMLElement, "getBoundingClientRect"> &
  Partial<Pick<HTMLElement, "offsetHeight" | "clientHeight">>;
type Containment = "contains" | "outside" | "unknown";

function resolveTargetCitationLabel(target: HTMLElement, fallbackLabel: string): string {
  const getAttribute = (target as { getAttribute?: (name: string) => string | null }).getAttribute;
  if (typeof getAttribute === "function") {
    const resolvedLabel = getAttribute.call(target, "data-citation-target-label")?.trim();
    if (resolvedLabel) {
      return resolvedLabel;
    }
  }
  return fallbackLabel;
}

function isHTMLElementLike(value: unknown): value is HTMLElement {
  return Boolean(
    value &&
      typeof value === "object" &&
      "getBoundingClientRect" in value &&
      "classList" in value,
  );
}

function isBrowserHTMLElement(value: unknown): value is HTMLElement {
  return typeof HTMLElement !== "undefined" && value instanceof HTMLElement;
}

function shouldUseSourceScrollContainer(container: ScrollContainer): boolean {
  if (typeof window !== "undefined" && typeof window.getComputedStyle === "function" && isBrowserHTMLElement(container)) {
    const overflowY = window.getComputedStyle(container).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
      return true;
    }
    if (overflowY === "visible" || overflowY === "clip") {
      return false;
    }
  }

  if (typeof container.scrollHeight === "number") {
    return container.scrollHeight > container.clientHeight + 1;
  }

  return true;
}

function canScrollContainer(container: ScrollContainer): boolean {
  return shouldUseSourceScrollContainer(container);
}

function resolveContainment(container: ScrollContainer, target: HTMLElement): Containment {
  if (typeof container.contains === "function") {
    return container.contains(target) ? "contains" : "outside";
  }

  let sawParentLink = false;
  let current: unknown = target;
  while (current && typeof current === "object") {
    if (current === container) {
      return "contains";
    }

    if (!("parentElement" in current)) {
      return sawParentLink ? "outside" : "unknown";
    }

    const parentElement = (current as { parentElement?: unknown }).parentElement;
    if (parentElement === undefined) {
      return sawParentLink ? "outside" : "unknown";
    }

    sawParentLink = true;
    current = parentElement;
  }

  return sawParentLink ? "outside" : "unknown";
}

function isScrollContainerLike(value: unknown): value is HTMLElement {
  return Boolean(
    value &&
      typeof value === "object" &&
      "getBoundingClientRect" in value &&
      "scrollTo" in value,
  );
}

function getParentElement(element: unknown): HTMLElement | null {
  if (!element || typeof element !== "object") {
    return null;
  }

  const parentElement = (element as { parentElement?: unknown }).parentElement;
  return isBrowserHTMLElement(parentElement) || isScrollContainerLike(parentElement)
    ? parentElement
    : null;
}

function findNearestScrollableContainer(target: HTMLElement): ScrollContainer | null {
  let parent = getParentElement(target);
  while (parent) {
    if (shouldUseSourceScrollContainer(parent)) {
      return parent;
    }
    parent = getParentElement(parent);
  }

  return null;
}

function isContainerVisibleInViewport(
  container: ScrollContainer,
  viewport: ScrollContainer,
): boolean {
  const containerRect = container.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  const visibleHeight = Math.min(containerRect.bottom, viewportRect.bottom) - Math.max(containerRect.top, viewportRect.top);
  return visibleHeight > 24;
}

function flashElement(
  element: HTMLElement,
  className: string,
  durationMs: number,
) {
  element.classList.add(className);
  if (durationMs <= 0) {
    element.classList.remove(className);
    return;
  }
  setTimeout(() => element.classList.remove(className), durationMs);
}

function resolveTargetHeight(target: ScrollTarget): number {
  if (typeof target.offsetHeight === "number" && target.offsetHeight > 0) {
    return target.offsetHeight;
  }

  if (typeof target.clientHeight === "number" && target.clientHeight > 0) {
    return target.clientHeight;
  }

  return target.getBoundingClientRect().height;
}

function scrollElementIntoContainer(
  container: ScrollContainer,
  element: ScrollTarget,
  behavior: ScrollBehavior,
) {
  const containerRect = container.getBoundingClientRect();
  const targetRect = element.getBoundingClientRect();
  const targetOffsetInContainer = targetRect.top - containerRect.top + container.scrollTop;
  const targetHeight = resolveTargetHeight(element);
  const scrollTo = targetOffsetInContainer - container.clientHeight / 2 + targetHeight / 2;
  container.scrollTo({ top: scrollTo, behavior });
  return scrollTo;
}

export function jumpToCitationSource({
  label,
  messageId,
  documentRef,
  chatScrollContainer,
  sourceScrollContainer,
  behavior = "smooth",
  flashClassName = "qa-source-flash",
  flashDurationMs = 1200,
}: {
  label: string;
  messageId?: string;
  documentRef: DocumentRef;
  chatScrollContainer?: ScrollContainer | null;
  sourceScrollContainer?: ScrollContainer | null;
  behavior?: ScrollBehavior;
  flashClassName?: string;
  flashDurationMs?: number;
}) {
  const exactId = buildCitationTargetId(label, messageId);
  let target = documentRef.getElementById(exactId);
  let usedDocLevelFallback = false;
  let resolvedLabel = label;

  if (!target) {
    const docLabel = label.split("-")[0];
    if (docLabel && docLabel !== label) {
      target = documentRef.getElementById(buildCitationTargetId(docLabel, messageId));
      usedDocLevelFallback = Boolean(target);
    }
  }

  if (!target) {
    const messageToken = buildCitationTargetMessageToken(messageId);
    const exactSelector = `[data-citation-target-label="${label}"][data-citation-target-message="${messageToken}"]`;
    const fallbackTarget = documentRef.querySelector?.(exactSelector);
    if (isHTMLElementLike(fallbackTarget)) {
      target = fallbackTarget;
    }
  }

  if (!target) {
    const docLabel = label.split("-")[0];
    if (docLabel && docLabel !== label) {
      const messageToken = buildCitationTargetMessageToken(messageId);
      const docSelector = `[data-citation-target-label="${docLabel}"][data-citation-target-message="${messageToken}"]`;
      const fallbackTarget = documentRef.querySelector?.(docSelector);
      if (isHTMLElementLike(fallbackTarget)) {
        target = fallbackTarget;
        usedDocLevelFallback = true;
      }
    }
  }

  if (!target) {
    const docLabel = label.split("-")[0];
    if (docLabel && docLabel !== label) {
      const messageToken = buildCitationTargetMessageToken(messageId);
      const sameDocSelector = `[data-citation-target-label^="${docLabel}-"][data-citation-target-message="${messageToken}"]`;
      const fallbackTarget = documentRef.querySelector?.(sameDocSelector);
      if (isHTMLElementLike(fallbackTarget)) {
        target = fallbackTarget;
        usedDocLevelFallback = true;
      }
    }
  }

  if (!target) {
    return {
      found: false,
      targetId: exactId,
      usedContainer: null,
      usedDocLevelFallback,
      resolvedLabel: null,
    };
  }

  resolvedLabel = resolveTargetCitationLabel(target, resolvedLabel);

  if (
    sourceScrollContainer &&
    resolveContainment(sourceScrollContainer, target) !== "outside" &&
    shouldUseSourceScrollContainer(sourceScrollContainer)
  ) {
    scrollElementIntoContainer(sourceScrollContainer, target, behavior);
    if (chatScrollContainer && !isContainerVisibleInViewport(sourceScrollContainer, chatScrollContainer)) {
      scrollElementIntoContainer(chatScrollContainer, sourceScrollContainer, behavior);
    }
    flashElement(target, flashClassName, flashDurationMs);
    return {
      found: true,
      targetId: target.id,
      usedContainer: "source" as const,
      usedDocLevelFallback,
      resolvedLabel,
    };
  }

  const nearestScrollContainer = findNearestScrollableContainer(target);
  if (
    nearestScrollContainer &&
    nearestScrollContainer !== sourceScrollContainer &&
    nearestScrollContainer !== chatScrollContainer
  ) {
    scrollElementIntoContainer(nearestScrollContainer, target, behavior);
    flashElement(target, flashClassName, flashDurationMs);
    return {
      found: true,
      targetId: target.id,
      usedContainer: "nearest" as const,
      usedDocLevelFallback,
      resolvedLabel,
    };
  }

  if (
    chatScrollContainer &&
    canScrollContainer(chatScrollContainer) &&
    (resolveContainment(chatScrollContainer, target) !== "outside" || !nearestScrollContainer)
  ) {
    scrollElementIntoContainer(chatScrollContainer, target, behavior);
    flashElement(target, flashClassName, flashDurationMs);
    return {
      found: true,
      targetId: target.id,
      usedContainer: "chat" as const,
      usedDocLevelFallback,
      resolvedLabel,
    };
  }

  target.scrollIntoView({ behavior, block: "center" });
  flashElement(target, flashClassName, flashDurationMs);
  return {
    found: true,
    targetId: target.id,
    usedContainer: "native" as const,
    usedDocLevelFallback,
    resolvedLabel,
  };
}

export function jumpToCitationOrigin({
  originId,
  fallbackScrollTop,
  documentRef,
  chatScrollContainer,
  behavior = "smooth",
  flashClassName = "qa-source-flash",
  flashDurationMs = 1200,
}: {
  originId?: string | null;
  fallbackScrollTop?: number | null;
  documentRef: DocumentRef;
  chatScrollContainer?: ScrollContainer | null;
  behavior?: ScrollBehavior;
  flashClassName?: string;
  flashDurationMs?: number;
}) {
  if (originId) {
    const origin = documentRef.getElementById(originId);
    if (origin) {
      origin.scrollIntoView({ behavior, block: "center" });
      flashElement(origin, flashClassName, flashDurationMs);
      return true;
    }
  }

  if (chatScrollContainer && typeof fallbackScrollTop === "number") {
    chatScrollContainer.scrollTo({ top: fallbackScrollTop, behavior });
    return true;
  }

  return false;
}
