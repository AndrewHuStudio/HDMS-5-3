"use client";

import { useEffect, useRef, useState } from "react";

export const TRANSIENT_HIGHLIGHT_DURATION_MS = 2000;

export function useTransientHighlight<T>(
  value: T | null | undefined,
  durationMs: number = TRANSIENT_HIGHLIGHT_DURATION_MS
) {
  const [highlightedValue, setHighlightedValue] = useState<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value === null || value === undefined) return;

    setHighlightedValue(value);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setHighlightedValue(null);
      timerRef.current = null;
    }, durationMs);
  }, [value, durationMs]);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    []
  );

  return highlightedValue;
}
