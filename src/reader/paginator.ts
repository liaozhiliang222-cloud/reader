export function pageGeometry(
  width: number,
  height: number,
  fontSize: number,
  margin: number,
  lineHeight = 1.8,
  reservedHeight = 112,
) {
  const line = Math.round(fontSize * lineHeight * 100) / 100;
  return {
    width: Math.max(1, width - margin * 2),
    height: Math.max(line, Math.floor((height - reservedHeight) / line) * line),
    stride: width,
    gap: margin * 2,
    line,
  };
}
export const pageCount = (scrollWidth: number, stride: number) =>
  Math.max(1, Math.ceil((scrollWidth - 1) / Math.max(1, stride)));
