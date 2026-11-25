import { open } from "@tauri-apps/plugin-dialog";
import { api, type Platform } from "./api";

/** File picker that works on both platforms: the desktop dialog, or the Android system picker (files come back as cache copies). */
export async function pickFiles(
  platform: Platform,
  o: { title: string; name: string; exts: string[]; multiple?: boolean },
): Promise<string[]> {
  if (platform === "android") {
    const files = await api.androidPick(o.exts);
    return o.multiple ? files : files.slice(0, 1);
  }
  const f = await open({ title: o.title, multiple: !!o.multiple, filters: [{ name: o.name, extensions: o.exts }] });
  if (!f) return [];
  return Array.isArray(f) ? f : [f];
}
