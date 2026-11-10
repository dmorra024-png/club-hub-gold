/** CSS-pixel bounds: move only the portion outside the visible viewport. */
export function focusedFieldDelta(
  top: number,
  bottom: number,
  fieldTop: number,
  fieldBottom: number,
) {
  if (![top, bottom, fieldTop, fieldBottom].every(Number.isFinite) || bottom <= top) return 0;
  if (fieldBottom - fieldTop > bottom - top) return fieldTop - top;
  if (fieldBottom > bottom) return fieldBottom - bottom;
  if (fieldTop < top) return fieldTop - top;
  return 0;
}
export function keyboardGeometry(
  baseline: number,
  layout: number,
  visible: number,
  offset: number,
  focused: boolean,
  scale = 1,
) {
  const physicalVisible = visible * Math.max(1, scale);
  return {
    open:
      focused && (baseline - physicalVisible >= 100 || layout - physicalVisible - offset >= 100),
    top: offset + 12,
    bottom: offset + visible - 20,
  };
}
