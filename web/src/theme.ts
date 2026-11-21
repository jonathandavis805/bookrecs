import { api } from "./api";

export const PALETTE_KEYS = ["bg", "card", "border", "text", "muted", "accent", "danger", "success"] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type Palette = Record<PaletteKey, string>;

export const PALETTE_LABELS: Record<PaletteKey, string> = {
  bg: "Background",
  card: "Surface",
  border: "Border",
  text: "Text",
  muted: "Muted text",
  accent: "Accent",
  danger: "Danger",
  success: "Success",
};

interface Preset {
  id: string;
  name: string;
  colors: Palette;
  // Exact token values that would otherwise be derived from `colors`
  overrides?: Record<string, string>;
}

const p = (
  bg: string,
  card: string,
  border: string,
  text: string,
  muted: string,
  accent: string,
  danger: string,
  success: string,
): Palette => ({ bg, card, border, text, muted, accent, danger, success });

// Paper mirrors the :root defaults in index.css. The rest are the themes that ship with herdr.
export const PRESETS: Preset[] = [
  {
    id: "paper",
    name: "Paper",
    colors: p("#f6f5f1", "#ffffff", "#e4e1d9", "#1d1c19", "#7a7568", "#1a1a1a", "#b34040", "#2f6b3a"),
    overrides: {
      "border-strong": "#c4c0b8",
      "accent-dark": "#000",
      "on-accent": "#fff",
      "danger-dark": "#9c3636",
      "danger-bg": "#fbeeee",
      "danger-border": "#f0d0d0",
      "danger-hover": "rgb(179 64 64 / 8%)",
      "success-bg": "#edf7ee",
      "success-border": "#cfe6d2",
      hover: "rgb(0 0 0 / 4%)",
      unread: "#f1efe9",
      "cover-bg": "#eae7df",
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    colors: p("#181825", "#1e1e2e", "#313244", "#cdd6f4", "#9399b2", "#cba6f7", "#f38ba8", "#a6e3a1"),
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    colors: p("#e6e9ef", "#eff1f5", "#ccd0da", "#4c4f69", "#6c6f85", "#8839ef", "#d20f39", "#40a02b"),
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    colors: p("#16161e", "#1a1b26", "#292e42", "#c0caf5", "#a9b1d6", "#7aa2f7", "#f7768e", "#9ece6a"),
  },
  {
    id: "tokyo-night-day",
    name: "Tokyo Night Day",
    colors: p("#e1e2e7", "#eeeef1", "#c4c8da", "#3760bf", "#6172b0", "#2e7de9", "#c64343", "#587539"),
  },
  {
    id: "dracula",
    name: "Dracula",
    colors: p("#21222c", "#282a36", "#44475a", "#f8f8f2", "#a4acc4", "#bd93f9", "#ff5555", "#50fa7b"),
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    colors: p("#1d2021", "#282828", "#3c3836", "#ebdbb2", "#a89984", "#fe8019", "#fb4934", "#b8bb26"),
  },
  {
    id: "gruvbox-light",
    name: "Gruvbox Light",
    colors: p("#f2e5bc", "#fbf1c7", "#d5c4a1", "#3c3836", "#7c6f64", "#af3a03", "#9d0006", "#79740e"),
  },
  {
    id: "one-dark",
    name: "One Dark",
    colors: p("#21252b", "#282c34", "#3e4451", "#abb2bf", "#8b919d", "#61afef", "#e06c75", "#98c379"),
  },
  {
    id: "one-light",
    name: "One Light",
    colors: p("#eaeaeb", "#fafafa", "#d3d3d4", "#383a42", "#696c77", "#4078f2", "#e45649", "#50a14f"),
  },
  {
    id: "solarized",
    name: "Solarized",
    colors: p("#002b36", "#073642", "#0f4a58", "#93a1a1", "#839496", "#268bd2", "#dc322f", "#859900"),
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    colors: p("#eee8d5", "#fdf6e3", "#ddd6c1", "#4f646b", "#657b83", "#268bd2", "#dc322f", "#859900"),
  },
  {
    id: "kanagawa",
    name: "Kanagawa",
    colors: p("#16161d", "#1f1f28", "#363646", "#dcd7ba", "#a6a69c", "#7e9cd8", "#e46876", "#98bb6c"),
  },
  {
    id: "kanagawa-lotus",
    name: "Kanagawa Lotus",
    colors: p("#e5ddb0", "#f2ecbc", "#d5cea3", "#545464", "#716e61", "#4d699b", "#c84053", "#6f894e"),
  },
  {
    id: "rose-pine",
    name: "Rose Pine",
    colors: p("#191724", "#1f1d2e", "#26233a", "#e0def4", "#908caa", "#c4a7e7", "#eb6f92", "#9ccfd8"),
  },
  {
    id: "rose-pine-dawn",
    name: "Rose Pine Dawn",
    colors: p("#faf4ed", "#fffaf3", "#dfdad9", "#575279", "#797593", "#907aa9", "#b4637a", "#286983"),
  },
  {
    id: "nord",
    name: "Nord",
    colors: p("#2e3440", "#3b4252", "#4c566a", "#eceff4", "#b8c0cf", "#88c0d0", "#bf616a", "#a3be8c"),
  },
  {
    id: "vesper",
    name: "Vesper",
    colors: p("#101010", "#161616", "#282828", "#ffffff", "#a0a0a0", "#ffc799", "#ff8080", "#99ffe4"),
  },
];

export const FONTS = [
  {
    id: "sans",
    name: "Sans",
    stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  { id: "serif", name: "Serif", stack: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif' },
  { id: "mono", name: "Mono", stack: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace' },
  {
    id: "rounded",
    name: "Rounded",
    stack: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif',
  },
  { id: "humanist", name: "Humanist", stack: 'Optima, Candara, "Gill Sans", "Noto Sans", sans-serif' },
  { id: "typewriter", name: "Typewriter", stack: '"American Typewriter", "Courier New", Courier, monospace' },
] as const;
type FontId = (typeof FONTS)[number]["id"];

export interface ThemeSetting {
  preset: string; // a preset id, or "custom" to use `colors`
  colors?: Palette;
  font: FontId;
}

const DEFAULT_THEME: ThemeSetting = { preset: "paper", font: "sans" };

// ---------- Color math ----------

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const isDark = (c: Palette) => luminance(c.bg) < 0.2;

// Accent and danger buttons share --on-accent, so pick whichever of bg/text reads better on both.
export function onAccent(c: Palette): string {
  const score = (fg: string) => Math.min(contrast(fg, c.accent), contrast(fg, c.danger));
  return score(c.bg) >= score(c.text) ? c.bg : c.text;
}

function hsl(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ---------- Random ("I'm feeling lucky") ----------

export function randomTheme(rand: () => number = Math.random): ThemeSetting {
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

  const dark = rand() < 0.5;
  const hue = between(0, 360);
  const tint = between(4, 22);
  const accentHue = (hue + pick([0, 30, -30, 150, 180, 210]) + between(-15, 15) + 360) % 360;

  const bg = hsl(hue, tint, dark ? between(6, 10) : between(92, 96));
  const card = hsl(hue, tint, dark ? between(12, 15) : between(98, 100));
  // HSL lightness is a poor proxy for luminance (yellow at 40% is far brighter than blue),
  // so walk lightness away from the surface until the color is legible on it.
  const legible = (h: number, s: number) => {
    let l = dark ? 55 : 50;
    while (contrast(hsl(h, s, l), card) < 4.5 && l > 0 && l < 100) l += dark ? 2 : -2;
    return hsl(h, s, l);
  };

  const colors: Palette = {
    bg,
    card,
    border: hsl(hue, tint, dark ? between(22, 26) : between(82, 86)),
    text: hsl(hue, Math.min(tint, 15), dark ? between(88, 94) : between(10, 16)),
    muted: hsl(hue, Math.min(tint, 15), dark ? between(64, 70) : between(36, 42)),
    accent: legible(accentHue, between(50, 80)),
    danger: legible(between(350, 370) % 360, 70),
    success: legible(between(110, 150), 50),
  };

  return { preset: "custom", colors, font: pick(FONTS).id };
}

// ---------- Applying ----------

function tokens(colors: Palette, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...colors,
    "border-strong": "color-mix(in srgb, var(--border), var(--text) 25%)",
    "accent-dark": "color-mix(in srgb, var(--accent) 85%, #000)",
    "on-accent": onAccent(colors),
    "danger-dark": "color-mix(in srgb, var(--danger) 85%, #000)",
    "danger-bg": "color-mix(in srgb, var(--danger) 10%, var(--card))",
    "danger-border": "color-mix(in srgb, var(--danger) 30%, var(--card))",
    "danger-hover": "color-mix(in srgb, var(--danger) 10%, transparent)",
    "success-bg": "color-mix(in srgb, var(--success) 10%, var(--card))",
    "success-border": "color-mix(in srgb, var(--success) 30%, var(--card))",
    hover: "color-mix(in srgb, var(--text) 6%, transparent)",
    unread: "color-mix(in srgb, var(--text) 5%, var(--bg))",
    "cover-bg": "color-mix(in srgb, var(--text) 10%, var(--bg))",
    ...overrides,
  };
}

// Each theme is scoped to [data-theme], so preview swatches can wear one regardless of the page's theme.
function block(id: string, colors: Palette, overrides?: Record<string, string>): string {
  const decls = Object.entries(tokens(colors, overrides)).map(([k, v]) => `--${k}:${v};`);
  return `[data-theme="${id}"]{color-scheme:${isDark(colors) ? "dark" : "light"};${decls.join("")}}`;
}

const STATIC_CSS = [
  ...PRESETS.map((t) => block(t.id, t.colors, t.overrides)),
  ...FONTS.map((f) => `[data-font="${f.id}"]{--font:${f.stack};font-family:var(--font);}`),
].join("\n");

export function paletteOf(setting: ThemeSetting): Palette {
  if (setting.preset === "custom" && setting.colors) return setting.colors;
  return (PRESETS.find((t) => t.id === setting.preset) ?? PRESETS[0]).colors;
}

let styleEl: HTMLStyleElement | null = null;

export function applyTheme(setting: ThemeSetting) {
  if (!styleEl) {
    styleEl = document.createElement("style");
    document.head.append(styleEl);
  }
  const custom = setting.colors ? block("custom", setting.colors) : "";
  styleEl.textContent = `${STATIC_CSS}\n${custom}`;
  document.documentElement.dataset.theme = setting.preset;
  document.documentElement.dataset.font = setting.font;
}

const STORAGE_KEY = "bookrecs-theme";
const HEX = /^#[0-9a-f]{6}$/i;

// biome-ignore lint/suspicious/noExplicitAny: validates untrusted JSON from storage or the account
function parseTheme(s: any): ThemeSetting | null {
  const font = FONTS.some((f) => f.id === s?.font) ? s.font : DEFAULT_THEME.font;
  const colors = s?.colors && PALETTE_KEYS.every((k) => HEX.test(s.colors[k])) ? (s.colors as Palette) : undefined;
  if (s?.preset === "custom" && colors) return { preset: "custom", colors, font };
  if (PRESETS.some((t) => t.id === s?.preset)) return { preset: s.preset, colors, font };
  return null;
}

export function loadTheme(): ThemeSetting {
  try {
    return parseTheme(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")) ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function cacheTheme(setting: ThemeSetting) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(setting));
  } catch {
    // Private mode or blocked storage: the theme still applies for this visit
  }
}

// The account's theme wins over this browser's cached one once the user is known.
export function adoptAccountTheme(raw: unknown) {
  const setting = parseTheme(raw);
  if (!setting) return;
  applyTheme(setting);
  cacheTheme(setting);
}

let syncTimer: ReturnType<typeof setTimeout> | undefined;

export function saveTheme(setting: ThemeSetting) {
  cacheTheme(setting);
  // Color pickers fire on every drag step; only the value they settle on is sent.
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    api("/api/me/theme", { method: "POST", body: JSON.stringify({ theme: setting }) }).catch(() => {});
  }, 600);
}
