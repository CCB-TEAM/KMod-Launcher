import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Config {
  game_dir: string;
  flavor: "release" | "dev";
  prereleases: boolean;
  proxy: string;
  mirror: string;
  theme: string;
  custom_themes: unknown[];
  icon: string;
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
}

export interface Release {
  tag: string;
  name: string;
  prerelease: boolean;
  published: string;
  notes: string;
  assets: Asset[];
}

export interface ModInfo {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  enabled: boolean;
  kind: "lua" | "native" | "pak";
  pack: "folder" | "kmod" | "pak";
  file: string;
}

export type Folder = "game" | "kmod" | "mods" | "paks" | "logs";

export const api = {
  getConfig: () => invoke<Config>("get_config"),
  saveConfig: (config: Config) => invoke<Config>("save_config", { config }),
  detectGames: () => invoke<string[]>("detect_games"),
  checkGame: (path: string) => invoke<string | null>("check_game", { path }),
  gameRunning: () => invoke<boolean>("game_running"),
  launchGame: () => invoke<void>("launch_game"),
  getInstalled: () => invoke<InstallState>("get_installed"),
  listReleases: () => invoke<Release[]>("list_releases"),
  installLoader: (a: Asset, tag: string, replaceForeign: boolean) =>
    invoke<void>("install_loader", { url: a.url, size: a.size, tag, flavor: a.flavor, replaceForeign }),
  uninstallLoader: (removeData: boolean) => invoke<void>("uninstall_loader", { removeData }),
  listMods: () => invoke<ModInfo[]>("list_mods"),
  setModEnabled: (id: string, enabled: boolean, kind: string) => invoke<void>("set_mod_enabled", { id, enabled, kind }),
  installMod: (source: string) => invoke<string>("install_mod", { source }),
  deleteMod: (file: string, id: string, kind: string) => invoke<void>("delete_mod", { file, id, kind }),
  readLog: (name: "kmod" | "proxy") => invoke<string>("read_log", { name }),
  openPath: (which: Folder) => invoke<void>("open_path", { which }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  getIcon: () => invoke<string | null>("get_icon"),
  setIcon: (source: string) => invoke<void>("set_icon", { source }),
  resetIcon: () => invoke<void>("reset_icon"),
};

export interface Progress {
  stage: "download" | "extract" | "done";
  done: number;
  total: number;
}

export const onProgress = (fn: (p: Progress) => void) => listen<Progress>("install-progress", (e) => fn(e.payload));

export const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));

export const fmtSize = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
