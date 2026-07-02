import type { CitationSelection } from "./citation-selection";

export interface PendingCitationSelection extends Required<CitationSelection> {
  attempts: number;
}

export function createPendingCitationSelection(
  selection: Required<CitationSelection>,
): PendingCitationSelection {
  return {
    ...selection,
    attempts: 0,
  };
}

export function advancePendingCitationSelection({
  pendingSelection,
  found,
  sourceTargetsEnabled,
  maxAttempts,
}: {
  pendingSelection: PendingCitationSelection;
  found: boolean;
  sourceTargetsEnabled: boolean;
  maxAttempts: number;
}): PendingCitationSelection | null {
  if (found) {
    return null;
  }

  if (!sourceTargetsEnabled) {
    return pendingSelection;
  }

  if (pendingSelection.attempts + 1 >= maxAttempts) {
    return null;
  }

  return {
    ...pendingSelection,
    attempts: pendingSelection.attempts + 1,
  };
}
