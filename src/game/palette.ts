// Shared color palette — keep in sync with index.html :root
export const PALETTE = {
  bg: 0x000000,
  cyan: 0x00f0ff,
  orange: 0xff6a00,
  magenta: 0xff00aa,
  green: 0x00ff88,
  red: 0xff2255,
  white: 0xffffff,
} as const;

// Convert hex int to [r,g,b] 0..1
export function hex2rgb(h: number): [number, number, number] {
  return [((h >> 16) & 0xff) / 255, ((h >> 8) & 0xff) / 255, (h & 0xff) / 255];
}

// Convert hex to CSS string
export function hex2css(h: number): string {
  return '#' + h.toString(16).padStart(6, '0');
}
