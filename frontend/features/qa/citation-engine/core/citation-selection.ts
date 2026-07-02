export interface CitationSelection {
  label: string;
  originId?: string | null;
}

export function normalizeCitationSelection(
  selection: string | CitationSelection,
): Required<CitationSelection> {
  if (typeof selection === "string") {
    return { label: selection, originId: null };
  }

  return {
    label: selection.label,
    originId: selection.originId ?? null,
  };
}
