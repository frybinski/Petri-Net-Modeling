/**
 * Colors and fonts of the domain view. The painter never reads the page: the caller passes the
 * palette of the current theme.
 */
export interface ScenePalette {
  /** Around the sheet. */
  bg: string;
  /** The sheet itself (the floor of the hall or building). */
  sheet: string;
  sheetBorder: string;
  grid: string;
  ink: string;
  ink2: string;
  inkMuted: string;
  /** Cards (stations) and other raised surfaces. */
  surface: string;
  surface2: string;
  line: string;
  accent: string;
  accentSoft: string;
  ok: string;
  okSoft: string;
  warn: string;
  danger: string;
  belt: string;
  beltEdge: string;
  roller: string;
  room: string;
  roomEdge: string;
  wall: string;
  zone: string;
  zoneEdge: string;
  area: string;
  furniture: string;
  furnitureEdge: string;
  /** Behind text, so that labels stay readable on belts and lines. */
  halo: string;
  shadow: string;
  parcel: string;
  parcelEdge: string;
  person: string;
  personEdge: string;
  vehicle: string;
  vehicleEdge: string;
  document: string;
  documentEdge: string;
  dot: string;
  dotEdge: string;
  fontSans: string;
  fontMono: string;
}

/** The names of the colors, as used by the draw commands. */
export type Tone = Exclude<keyof ScenePalette, 'fontSans' | 'fontMono'>;

const FONT_SANS = "'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace";

export const LIGHT_PALETTE: ScenePalette = {
  bg: '#f4f4f5',
  sheet: '#fafafa',
  sheetBorder: '#d4d4d8',
  grid: '#d9d9de',
  ink: '#27272a',
  ink2: '#52525b',
  inkMuted: '#8b8b95',
  surface: '#ffffff',
  surface2: '#f1f1f3',
  line: '#c4c4cc',
  accent: '#4f46e5',
  accentSoft: '#eef2ff',
  ok: '#16a34a',
  okSoft: '#dcfce7',
  warn: '#b45309',
  danger: '#dc2626',
  belt: '#52525b',
  beltEdge: '#3f3f46',
  roller: '#7c7c87',
  room: '#ffffff',
  roomEdge: '#d4d4d8',
  wall: '#52525b',
  zone: '#e0e7ff',
  zoneEdge: '#818cf8',
  area: '#f1f5f9',
  furniture: '#e4e4e7',
  furnitureEdge: '#c4c4cc',
  halo: '#fafafa',
  shadow: 'rgba(24, 24, 27, 0.20)',
  parcel: '#d9a860',
  parcelEdge: '#8a5a1f',
  person: '#0d9488',
  personEdge: '#115e59',
  vehicle: '#3b82f6',
  vehicleEdge: '#1e3a8a',
  document: '#ffffff',
  documentEdge: '#71717a',
  dot: '#6366f1',
  dotEdge: '#312e81',
  fontSans: FONT_SANS,
  fontMono: FONT_MONO,
};

export const DARK_PALETTE: ScenePalette = {
  bg: '#0b0b0d',
  sheet: '#131316',
  sheetBorder: '#3a3a42',
  grid: '#2a2a31',
  ink: '#f4f4f5',
  ink2: '#c4c4cc',
  inkMuted: '#8b8b95',
  surface: '#1e1e23',
  surface2: '#27272d',
  line: '#4a4a53',
  accent: '#818cf8',
  accentSoft: '#23234a',
  ok: '#4ade80',
  okSoft: '#14301f',
  warn: '#fbbf24',
  danger: '#f87171',
  belt: '#3b3b43',
  beltEdge: '#72727e',
  roller: '#5b5b66',
  room: '#1a1a1f',
  roomEdge: '#3a3a42',
  wall: '#9a9aa6',
  zone: '#23234a',
  zoneEdge: '#6366f1',
  area: '#1b1b21',
  furniture: '#2c2c33',
  furnitureEdge: '#4a4a53',
  halo: '#131316',
  shadow: 'rgba(0, 0, 0, 0.55)',
  parcel: '#d9a860',
  parcelEdge: '#6b4513',
  person: '#2dd4bf',
  personEdge: '#0f766e',
  vehicle: '#60a5fa',
  vehicleEdge: '#1e3a8a',
  document: '#e4e4e7',
  documentEdge: '#71717a',
  dot: '#a5b4fc',
  dotEdge: '#4338ca',
  fontSans: FONT_SANS,
  fontMono: FONT_MONO,
};
