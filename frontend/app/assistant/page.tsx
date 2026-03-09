"use client";

import "@/features";
import { AppShell } from "@/components/app-shell";
import { QAView } from "@/features/qa";

export default function AssistantPage() {
  return (
    <AppShell>
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
        <QAView />
      </div>
    </AppShell>
  );
}
