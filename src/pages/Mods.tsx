import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errText, type ModInfo } from "../api";
import { useToast } from "../toast";
import type { Shared } from "../App";

export default function Mods({ state }: Shared) {
  const toast = useToast();
  const [mods, setMods] = useState<ModInfo[] | null>(null);

  const load = useCallback(async () => {
    try {
      setMods(await api.listMods());
    } catch (e) {
      toast("err", errText(e));
      setMods([]);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (m: ModInfo) => {
    try {
      await api.setModEnabled(m.id, !m.enabled);
      setMods((l) => l?.map((x) => (x.id === m.id ? { ...x, enabled: !m.enabled } : x)) ?? null);
    } catch (e) {
      toast("err", errText(e));
    }
  };

  const add = async () => {
    const f = await open({ multiple: true, title: "选择模组", filters: [{ name: "KMod 模组", extensions: ["kmod"] }] });
    if (!f) return;
    for (const path of Array.isArray(f) ? f : [f]) {
      try {
        toast("ok", `已安装 ${await api.installMod(path)}`);
      } catch (e) {
        toast("err", errText(e));
      }
    }
    await load();
  };

  const addFolder = async () => {
    const d = await open({ directory: true, title: "选择模组文件夹（里面要有 mod.json）" });
    if (typeof d !== "string") return;
    try {
      toast("ok", `已安装 ${await api.installMod(d)}`);
    } catch (e) {
      toast("err", errText(e));
    }
    await load();
  };

  const remove = async (m: ModInfo) => {
    if (!confirm(`删除模组“${m.name}”？`)) return;
    try {
      await api.deleteMod(m.file, m.id);
      await load();
    } catch (e) {
      toast("err", errText(e));
    }
  };

  return (
    <div className="page">
      <div className="between">
        <h1>模组</h1>
        <div className="row">
          <button className="primary" onClick={add}>
            安装 .kmod
          </button>
          <button onClick={addFolder}>安装文件夹</button>
          <button onClick={() => api.openPath("mods")}>打开 mods 文件夹</button>
        </div>
      </div>
      {!state?.installed && <p className="muted">加载器还没有安装，模组在安装后才会生效。</p>}
      {mods === null && <p className="muted">正在读取…</p>}
      {mods?.length === 0 && <p className="muted">还没有模组。把 .kmod 文件装进来，或者放进 mods 文件夹。</p>}
      <div className="list">
        {mods?.map((m) => (
          <div key={m.file} className="mod">
            <label className="switch">
              <input type="checkbox" checked={m.enabled} onChange={() => toggle(m)} />
              <i />
            </label>
            <div className="info">
              <div>
                <b>{m.name}</b>
                <span className="muted small">
                  {" "}
                  {m.version} {m.author && `· ${m.author}`}
                </span>
                {m.kind === "folder" && <span className="tag">文件夹</span>}
              </div>
              <div className="muted small">{m.description || m.id}</div>
            </div>
            <button className="danger" onClick={() => remove(m)}>
              删除
            </button>
          </div>
        ))}
      </div>
      <p className="muted small">启用或停用在下次启动游戏时生效；游戏里的 Mods 页也可以即时切换。</p>
    </div>
  );
}
