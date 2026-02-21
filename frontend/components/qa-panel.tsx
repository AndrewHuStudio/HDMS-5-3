"use client";

import { QAView } from "@/features/qa";

interface QAPanelProps {
  selectedElement?: unknown;
}

/**
 * Legacy entry kept for compatibility with existing page wiring.
 * Old panel implementation is removed; the unified QAView is reused.
 */
export function QAPanel(_props: QAPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <QAView embedded />
    </div>
  );
}
