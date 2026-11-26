import type { CatalogMod, CatalogVersion } from "./api";

/** Compares dotted version numbers ("0.10.1" > "0.9"). */
export function cmpVersion(a: string, b: string): number {
  const x = a.split(/[^\d]+/).filter(Boolean).map(Number);
  const y = b.split(/[^\d]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export interface Here {
  platform: "Android" | "Windows";
  /** installed loader and game version; empty = unknown (conditions on it are not checked) */
  kmod: string;
  kards: string;
}

/** Why a version cannot run here, or "" when it can. */
export function problem(v: CatalogVersion, here: Here): string {
  if (v.platforms?.length && !v.platforms.includes(here.platform)) return `不支持 ${here.platform}`;
  for (const d of v.depends ?? []) {
    const m = /^\s*(kmod|kards)\s*(>=|<=|==|=|>|<)\s*([\d.]+)/.exec(d);
    if (!m) continue;
    const have = m[1] === "kmod" ? here.kmod : here.kards;
    if (!have) continue;
    // "kards>=1.61" looks at as many parts as the condition names
    const c = cmpVersion(have.split(".").slice(0, m[3].split(".").length).join("."), m[3]);
    const ok = m[2] === ">=" ? c >= 0 : m[2] === ">" ? c > 0 : m[2] === "<=" ? c <= 0 : m[2] === "<" ? c < 0 : c === 0;
    if (!ok) return `需要 ${m[1] === "kmod" ? "加载器" : "游戏"} ${m[2]}${m[3]}（现在 ${have}）`;
  }
  return "";
}

/** The newest version that runs here, else the newest one. The index lists versions newest first. */
export const bestVersion = (m: CatalogMod, here: Here) => m.versions.find((v) => !problem(v, here)) ?? m.versions[0];

export const isNewer = (candidate: string, installed: string) => cmpVersion(candidate, installed) > 0;
