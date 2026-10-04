/** Fit a bounding sphere inside both axes of a perspective viewport. */
export function overviewDistance(radius: number, verticalFovDegrees: number, aspect: number): number {
  const vertical = verticalFovDegrees * Math.PI / 360;
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(aspect, 0.01));
  return radius * 1.15 / Math.sin(Math.min(vertical, horizontal));
}
