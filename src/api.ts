import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Config {
  game_dir: string;
  flavor: "release" | "dev";
  prereleases: boolean;
  proxy: string;
  mirror: string;
  index_url: string;
  theme: string;
  custom_themes: unknown[];
  icon: string;
  package: string;
  /** the first-start guide has been finished or skipped */
  onboarded: boolean;
}

export interface InstallState {
  installed: boolean;
  tag: string;
  flavor: string;
  log_version: string;
  foreign_proxy: boolean;
}

export interface Asset {
  name: string;
  url: string;
  size: number;
  flavor: "release" | "dev";
  digest: string;
}

/** A newer version of the launcher itself. */
export interface Update {
  version: string;
  notes: string;
  page: string;
  size: number;
  /** false: only the release page can be offered */
  installable: boolean;
}

export interface Release {
  tag: string;
  name: string;
  prerelease: boolean;
  published: string;
  notes: string;
  assets: Asset[];
}

export interface CatalogVersion {
  version: string;
  url: string;
  sha256: string;
  size: number;
  published?: string;
  platforms?: string[];
  native?: boolean;
  permissions?: string[];
  depends?: string[];
  paks?: boolean;
  downloads?: number;
}

export interface CatalogMod {
  id: string;
  name: string;
  author: string;
  description: string;
  icon?: string | null;
  cover?: string | null;
  repo?: string;
  stars?: number;
  /** of all releases; absent in indexes that do not count them */
  downloads?: number;
  updated?: string;
  verified?: boolean;
  versions: CatalogVersion[];
}

export interface Catalog {
  mods: CatalogMod[];
  blocked: string[];
  errors: string[];
}

export interface ModInfo {
  icon: string;
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  enabled: boolean;
  kind: "lua" | "native" | "pak";
  pack: "folder" | "kmod" | "pak";
  file: string;
  pending: boolean;
  /** pak files this mod installed that are still there */
  paks: string[];
}

/** What installing a package would do to pak files: the player is asked before anything is overwritten or removed. */
export interface PakPlan {
  name: string;
  version: string;
  write: string[];
  remove: string[];
  conflicts: string[];
}

export interface AndroidInfo {
  access: boolean;
  /** the installed app list can be read */
  apps: boolean;
  installed: boolean;
  version: string;
}

export interface UnrealApp {
  label: string;
  pkg: string;
  path: string;
  split: boolean;
}

export interface InspectReport {
  ok: boolean;
  facts: [string, string][];
  warnings: string[];
  errors: string[];
  alreadyInjected: boolean;
}

export type Phase = "idle" | "working" | "need_uninstall" | "installing" | "done" | "error";

export interface InstallerStatus {
  phase: Phase;
  text: string;
  message: string;
  pkg: string;
  label: string;
  size: number;
}

export type Platform = "windows" | "android";

export type Folder = "game" | "kmod" | "mods" | "paks" | "logs";

export const api = {
  platform: () => invoke<Platform>("platform"),
  androidInfo: () => invoke<AndroidInfo>("android_info"),
  androidRequestAccess: () => invoke<void>("android_request_access"),
  androidRequestApps: () => invoke<void>("android_request_apps"),
  androidInstaller: <T>(cmd: string, args: Record<string, unknown> = {}) => invoke<T>("android_installer", { cmd, args }),
  androidPick: (exts: string[]) => invoke<string[]>("android_pick", { exts }),
  getConfig: () => invoke<Config>("get_config"),
  saveConfig: (config: Config) => invoke<Config>("save_config", { config }),
  detectGames: () => invoke<string[]>("detect_games"),
  checkGame: (path: string) => invoke<string | null>("check_game", { path }),
  gameRunning: () => invoke<boolean>("game_running"),
  launchGame: () => invoke<void>("launch_game"),
  getInstalled: () => invoke<InstallState>("get_installed"),
  listReleases: () => invoke<Release[]>("list_releases"),
  installLoader: (a: Asset, tag: string, replaceForeign: boolean) =>
    invoke<void>("install_loader", { url: a.url, size: a.size, digest: a.digest, tag, flavor: a.flavor, replaceForeign }),
  uninstallLoader: (removeData: boolean) => invoke<void>("uninstall_loader", { removeData }),
  listMods: () => invoke<ModInfo[]>("list_mods"),
  setModEnabled: (id: string, enabled: boolean, kind: string) => invoke<void>("set_mod_enabled", { id, enabled, kind }),
  installMod: (source: string, allowNative = false, allowPaks = false) => invoke<string>("install_mod", { source, allowNative, allowPaks }),
  fetchCatalog: () => invoke<Catalog>("fetch_catalog"),
  installRemote: (id: string, v: CatalogVersion, allowNative: boolean, allowPaks = false) =>
    invoke<string>("install_remote", { id, url: v.url, sha256: v.sha256, size: v.size, allowNative, allowPaks }),
  deleteMod: (file: string, id: string, kind: string, pending: boolean, deletePaks = false) =>
    invoke<void>("delete_mod", { file, id, kind, pending, deletePaks }),
  /** Android: pak files ("X.pak") in mount order, the last one wins */
  pakOrder: () => invoke<string[]>("pak_order"),
  setPakOrder: (names: string[]) => invoke<void>("set_pak_order", { names }),
  readLog:(name: "kmod" | "proxy") => invoke<string>("read_log", { name }),
  openPath: (which: Folder) => invoke<void>("open_path", { which }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  getIcon: () => invoke<string | null>("get_icon"),
  setIcon: (source: string) => invoke<void>("set_icon", { source }),
  resetIcon: () => invoke<void>("reset_icon"),
  checkUpdate: () => invoke<Update | null>("check_update"),
  installUpdate: () => invoke<void>("install_update"),
};

export interface Progress {
  stage: "download" | "extract" | "done";
  done: number;
  total: number;
}

export const onProgress = (fn: (p: Progress) => void) => listen<Progress>("install-progress", (e) => fn(e.payload));

export const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));

/** The plan behind a "PAK_CONFIRM:{…}" error, else null. */
export const pakPlan = (e: unknown): PakPlan | null => {
  const t = errText(e);
  return t.startsWith("PAK_CONFIRM:") ? (JSON.parse(t.slice("PAK_CONFIRM:".length)) as PakPlan) : null;
};

export const fmtSize = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
