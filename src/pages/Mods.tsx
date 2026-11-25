import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errText, type ModInfo } from "../api";
import { useToast } from "../toast";
import type { Shared } from "../App";
import { IconSearch } from "../Icons";

export default function Mods({ state }: Shared) {
  const toast = useToast();
  const [mods, setMods] = useState<ModInfo[] | null>(null);
  const [q, setQ] = useState("");

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

  const needle = q.trim().toLowerCase();
  const shown = mods?.filter((m) => !needle || `${m.name} ${m.id} ${m.author} ${m.description}`.toLowerCase().includes(needle));
  const enabledCount = mods?.filter((m) => m.enabled).length ?? 0;

  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>模组管理</h1>
          <small className="muted">
            {enabledCount} / {mods?.length ?? 0} 个模组已启用
          </small>
        </div>
        <label className="search">
          <IconSearch />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索名称、id、作者或说明…" />
        </label>
        <div className="row">
          <button className="primary" onClick={add}>安装 .kmod</button>
          <button onClick={addFolder}>安装文件夹</button>
          <button onClick={() => api.openPath("mods")}>Mods 文件夹</button>
        </div>
      </div>
      {!state?.installed && <p className="muted">加载器还没有安装，模组在安装后才会生效。</p>}
      {mods === null && <p className="muted">正在读取…</p>}
      {mods?.length === 0 && <p className="muted">还没有模组。把 .kmod 文件装进来，或者放进 mods 文件夹。</p>}
      <div className="list">
        {shown?.map((m) => (
          <div key={m.file} className="mod">
            <button className={m.enabled ? "pill on" : "pill"} onClick={() => toggle(m)}>
              {m.enabled ? "已启用" : "已禁用"}
            </button>
            <div className="info">
              <div>
                <b>{m.name}</b>
                <span className="muted small"> {m.version}</span>
                {m.author && <span className="chip">{m.author}</span>}
                {m.kind === "folder" && <span className="chip">文件夹</span>}
              </div>
              <div className="muted small">{m.description || m.id}</div>
            </div>
            <button className="ghost danger" onClick={() => remove(m)}>删除</button>
          </div>
        ))}
      </div>
      <p className="muted small">启用或停用在下次启动游戏时生效；游戏里的 Mods 页也可以即时切换。</p>
    </div>
  );
}
