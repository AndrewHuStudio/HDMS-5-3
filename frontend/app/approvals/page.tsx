"use client";

import "@/features";
import { AppShell } from "@/components/app-shell";
import { ApprovalChecklistPanel } from "@/components/approval-checklist-panel";
import { ThemeToggle } from "@/components/theme-toggle";

export default function ApprovalsPage() {
  return (
    <AppShell>
      <section className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <header className="h-12 border-b border-border bg-card flex items-center justify-between px-4 flex-shrink-0">
          <h2 className="font-medium">管控审批清单</h2>
          <ThemeToggle />
        </header>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          <ApprovalChecklistPanel />
        </div>
      </section>
    </AppShell>
  );
}
