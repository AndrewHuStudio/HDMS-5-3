export function shouldRenderFeatureVisuals(isVisible: boolean, resultCount: number): boolean {
  return isVisible && resultCount > 0;
}

export function shouldRenderSetbackRateVisuals(isVisible: boolean): boolean {
  return isVisible;
}
