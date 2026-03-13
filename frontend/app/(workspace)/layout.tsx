"use client";

import type { ReactNode } from "react";
import { PersistentWorkspaceShell } from "@/components/workspace/persistent-workspace-shell";

export default function WorkspaceLayout(_: { children: ReactNode }) {
  return <PersistentWorkspaceShell />;
}
