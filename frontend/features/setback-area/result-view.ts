export interface SetbackAreaNameLike {
  id?: string | null;
  name?: string | null;
  plot_name?: string | null;
}

export interface SetbackAreaViewItem extends SetbackAreaNameLike {
  selectionId: string;
  displayName: string;
}

const normalizeText = (value?: string | null): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
};

export function buildSetbackAreaSelectionId(
  scope: string,
  index: number,
  id?: string | null,
  name?: string | null
): string {
  const normalizedId = normalizeText(id);
  if (normalizedId) return normalizedId;
  const normalizedName = normalizeText(name) ?? "area";
  return `${scope}-area-${index + 1}-${normalizedName}`;
}

export function buildSetbackAreaViewItems<T extends SetbackAreaNameLike>(
  items: T[],
  scope: string
): Array<T & SetbackAreaViewItem> {
  return items.map((item, index) => {
    const fallbackName = normalizeText(item.name) ?? `${scope}${index + 1}`;
    return {
      ...item,
      selectionId: buildSetbackAreaSelectionId(scope, index, item.id, fallbackName),
      displayName: normalizeText(item.plot_name) ?? fallbackName,
    };
  });
}
