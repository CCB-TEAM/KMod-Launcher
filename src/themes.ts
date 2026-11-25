// Theme system: a theme is a small set of opaque colors plus a corner radius.
// Everything else in the stylesheet (glass layers, borders, hover states, badges, glows)
// is derived from these tokens with color-mix(), so a theme only has to pick a handful of colors.

export const COLOR_KEYS = [
  "bg",
  "field",
  "btn",
  "fg",
  "muted",
  "accent",
  "ok",
  "danger",
  "lua",
  "native",
  "pak",
  "glow1",
  "glow2",
  "glow3",
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export const COLOR_LABELS: Record<ColorKey, string> = {
  bg: "背景",
  field: "输入框 / 凹槽",
  btn: "按钮",
  fg: "文字",
  muted: "次要文字",
  accent: "强调色",
  ok: "成功 / 已启用",
  danger: "危险",
  lua: "Lua 标签",
  native: "原生标签",
  pak: "Pak 标签",
  glow1: "背景光晕 1（右上）",
  glow2: "背景光晕 2（右下）",
  glow3: "背景光晕 3（左下）",
};

export interface Theme {
  id: string;
  name: string;
  mode: "dark" | "light";
  radius: number;
  colors: Record<ColorKey, string>;
  builtin?: boolean;
}

export const DEFAULT_THEME_ID = "violet";

const dark = (
  id: string,
  name: string,
  c: Partial<Record<ColorKey, string>>,
): Theme => ({
  id,
  name,
  mode: "dark",
  radius: 8,
  builtin: true,
  colors: {
    bg: "#161517",
    field: "#101011",
    btn: "#212123",
    fg: "#f1f1f3",
    muted: "#9a9aa4",
    accent: "#a58be0",
    ok: "#7bd6a0",
    danger: "#f08a82",
    lua: "#7cc0ff",
    native: "#ffb066",
    pak: "#ff8fc0",
    glow1: "#a06ec8",
    glow2: "#3096a0",
    glow3: "#c86e82",
    ...c,
  },
});

export const BUILTIN_THEMES: Theme[] = [
  dark("violet", "暮紫", {}),
  dark("ocean", "深海", {
    bg: "#0e151b",
    field: "#091016",
    btn: "#18232c",
    accent: "#4cc2d9",
    glow1: "#2f7fd0",
    glow2: "#1fb5a5",
    glow3: "#3a5fc0",
  }),
  dark("forest", "森林", {
    bg: "#111613",
    field: "#0b100d",
    btn: "#1c2420",
    accent: "#7dd07a",
    ok: "#9be38f",
    glow1: "#4a9a52",
    glow2: "#b0a040",
    glow3: "#2f7a6a",
  }),
  dark("sunset", "日落", {
    bg: "#1a1413",
    field: "#120d0c",
    btn: "#2a1f1d",
    accent: "#ff9a62",
    glow1: "#e0663a",
    glow2: "#d0508a",
    glow3: "#c09030",
  }),
  dark("midnight", "纯黑", {
    bg: "#000000",
    field: "#0b0b0b",
    btn: "#181818",
    accent: "#8ab4ff",
    glow1: "#3b4a80",
    glow2: "#243a50",
    glow3: "#40305a",
  }),
  {
    id: "paper",
    name: "纸白",
    mode: "light",
    radius: 8,
    builtin: true,
    colors: {
      bg: "#f2f0f6",
      field: "#ffffff",
      btn: "#e4e1ea",
      fg: "#1d1b22",
      muted: "#6b6775",
      accent: "#7a56d6",
      ok: "#1f9e62",
      danger: "#d04a42",
      lua: "#1f6fcf",
      native: "#c9690f",
      pak: "#c8307f",
      glow1: "#b79af0",
      glow2: "#7fcdd6",
      glow3: "#f0a8b8",
    },
  },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Turns untrusted JSON (a saved or pasted theme) into a valid theme, or null. */
export function parseTheme(raw: unknown): Theme | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim().slice(0, 24) : "";
  if (!name) return null;
  const mode = r.mode === "light" ? "light" : "dark";
  const base = (mode === "light" ? BUILTIN_THEMES.find((t) => t.id === "paper") : BUILTIN_THEMES[0])!;
  const src = (r.colors && typeof r.colors === "object" ? r.colors : {}) as Record<string, unknown>;
  const colors = { ...base.colors };
  for (const k of COLOR_KEYS) {
    const v = src[k];
    if (typeof v === "string" && HEX.test(v)) colors[k] = v.toLowerCase();
  }
  const radius = typeof r.radius === "number" ? Math.min(20, Math.max(0, Math.round(r.radius))) : 8;
  const id = typeof r.id === "string" && /^[\w-]{1,48}$/.test(r.id) ? r.id : `custom-${Date.now()}`;
  return { id, name, mode, radius, colors };
}

export function allThemes(custom: unknown[]): Theme[] {
  const mine = custom.map(parseTheme).filter((t): t is Theme => !!t && !BUILTIN_THEMES.some((b) => b.id === t.id));
  return [...BUILTIN_THEMES, ...mine];
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  for (const k of COLOR_KEYS) root.style.setProperty(`--${k}`, t.colors[k]);
  root.style.setProperty("--r", `${t.radius}px`);
  root.style.colorScheme = t.mode;
  root.dataset.theme = t.id;
}

export function exportTheme(t: Theme): string {
  const { id: _id, builtin: _b, ...rest } = t;
  return JSON.stringify(rest, null, 2);
}
