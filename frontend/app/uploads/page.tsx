"use client";

import "@/features";
import { AppShell } from "@/components/app-shell";
import { DataUploadPanel } from "@/components/data-upload-panel";
import { ThemeToggle } from "@/components/theme-toggle";

export default function UploadsPage() {
  return (
    <AppShell>
      <section className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <header className="h-12 border-b border-border bg-card flex items-center justify-between px-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="font-medium">管控资料上传</h2>
            <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
              严格串行
            </span>
          </div>
          <ThemeToggle />
        </header>
        <DataUploadPanel />
      </section>
    </AppShell>
  );
}
