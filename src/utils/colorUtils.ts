/**
 * Color utilities for theme-aware rendering.
 */

/**
 * Convert a hex color (with or without #, 3 or 6 digits) to an rgba() string.
 * If the input is already rgba/rgb, it is returned as-is.
 *
 * Examples:
 *   hexToRgba('#0b0f19', 0.85)  →  'rgba(11, 15, 25, 0.85)'
 *   hexToRgba('#8f3ba7', 1)      →  'rgba(143, 59, 167, 1)'
 *   hexToRgba('#abc', 0.5)        →  'rgba(170, 187, 204, 0.5)'
 */
export function hexToRgba(hex: string, alpha: number = 1): string {
  if (!hex) {
    return `rgba(0, 0, 0, ${alpha})`;
  }

  // Already rgba/rgb — extract values and apply alpha
  const rgbaMatch = hex.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i,
  );
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1], 10);
    const g = parseInt(rgbaMatch[2], 10);
    const b = parseInt(rgbaMatch[3], 10);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Strip # prefix
  let h = hex.replace(/^#/, '');

  // Expand shorthand (e.g., "03F" → "0033FF")
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }

  if (h.length !== 6) {
    return `rgba(0, 0, 0, ${alpha})`;
  }

  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
