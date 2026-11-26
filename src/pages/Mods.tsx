import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { pickFiles } from "../pick";
import { api, errText, pakPlan, type ModInfo, type PakPlan } from "../api";
import { useToast } from "../toast";
import type { Shared } from "../App";
import { IconSearch } from "../Icons";
import NativeWarning from "../NativeWarning";
import { DeleteWithPaks, PakWarning } from "../PakDialogs";

const KIND_LABEL = { lua: "Lua", native: "原生 C++", pak: "Pak" } as const;

export default function Mods({ state, platform }: Shared) {
  const android = platform === "android";
  const toast = useToast();
  const [mods, setMods] = useState<ModInfo[] | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState<"all" | ModInfo["kind"]>("all");
  const [asking, setAsking] = useState<{ name: string; answer: (ok: boolean) => void } | null>(null);

  const [pakAsk, setPakAsk] = useState<{ plan: PakPlan; answer: (ok: boolean) => void } | null>(null);
  const [removing, setRemoving] = useState<ModInfo | null>(null);

  /** Installs a file or folder; asks first for a native mod and before pak files are overwritten. */
  const installOne = async (path: string) => {
    const name = path.split(/[\\/]/).pop() ?? path;
    let native = false;
    let paks = false;
    for (;;) {
      try {
        return toast("ok", `已安装 ${await api.installMod(path, native, paks)}`);
      } catch (e) {
        const plan = pakPlan(e);
        if (errText(e) === "NATIVE_CONFIRM" && !native) {
          native = await new Promise<boolean>((answer) => setAsking({ name, answer }));
          setAsking(null);
          if (!native) return;
        } else if (plan && !paks) {
          paks = await new Promise<boolean>((answer) => setPakAsk({ plan, answer }));
          setPakAsk(null);
          if (!paks) return;
        } else return toast("err", errText(e));
      }
    }
  };

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
      await api.setModEnabled(m.id, !m.enabled, m.kind);
      setMods((l) => l?.map((x) => (x === m ? { ...x, enabled: !m.enabled } : x)) ?? null);
    } catch (e) {
      toast("err", errText(e));
    }
  };

  const add = async () => {
    let files: string[] = [];
    try {
      files = await pickFiles(platform, { multiple: true, title: "选择模组", name: "KMod 模组 / Pak", exts: ["kmod", "pak"] });
    } catch (e) {
      toast("err", errText(e));
      return;
    }
    for (const path of files) await installOne(path);
    await load();
  };

  const addFolder = async () => {
    const d = await open({ directory: true, title: "选择模组文件夹（里面要有 mod.json）" });
    if (typeof d !== "string") return;
    await installOne(d);
    await load();
  };

  const remove = async (m: ModInfo, deletePaks?: boolean) => {
    if (deletePaks === undefined) {
      if (m.paks.length) return setRemoving(m);
      if (!confirm(`删除模组“${m.name}”？`)) return;
    }
    setRemoving(null);
    try {
      await api.deleteMod(m.file, m.id, m.kind, m.pending, !!deletePaks);
      await load();
    } catch (e) {
      toast("err", errText(e));
    }
  };

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const needle = q.trim().toLowerCase();
  const count = (k: ModInfo["kind"]) => mods?.filter((m) => m.kind === k).length ?? 0;
  const shown = mods
    ?.filter((m) => type === "all" || m.kind === type)
    .filter((m) => !needle || `${m.name} ${m.id} ${m.author} ${m.description}`.toLowerCase().includes(needle));
  const enabledCount = mods?.filter((m) => m.enabled).length ?? 0;

  return (
    <div className="page">
      {asking && <NativeWarning mod={{ name: asking.name }} onCancel={() => asking.answer(false)} onConfirm={() => asking.answer(true)} />}
      {pakAsk && <PakWarning plan={pakAsk.plan} onCancel={() => pakAsk.answer(false)} onConfirm={() => pakAsk.answer(true)} />}
      {removing && <DeleteWithPaks name={removing.name} paks={removing.paks} onCancel={() => setRemoving(null)} onConfirm={(also) => void remove(removing, also)} />}
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
          <button className="primary" onClick={add}>安装模组</button>
          <button disabled={refreshing} onClick={() => void refresh()}>{refreshing ? "刷新中…" : "刷新"}</button>
          {!android && <button onClick={addFolder}>安装文件夹</button>}
          {!android && <button onClick={() => api.openPath("mods")}>Mods 文件夹</button>}
          {!android && <button onClick={() => api.openPath("paks")}>Paks 文件夹</button>}
        </div>
      </div>
      <div className="seg types">
        <button className={type === "all" ? "on" : ""} onClick={() => setType("all")}>全部 {mods?.length ?? 0}</button>
        <button className={type === "lua" ? "on" : ""} onClick={() => setType("lua")}>Lua {count("lua")}</button>
        <button className={type === "native" ? "on" : ""} onClick={() => setType("native")}>原生 {count("native")}</button>
        <button className={type === "pak" ? "on" : ""} onClick={() => setType("pak")}>Pak {count("pak")}</button>
      </div>
      {android && platform === "android" && !state?.installed && (
        <p className="muted">还没有找到 kmod 文件夹：先在「安装器」里装好打过补丁的游戏并启动一次，再回来管理模组。</p>
      )}
      {!android && !state?.installed && <p className="muted">加载器还没有安装，Lua 和原生模组在安装后才会生效（Pak 模组由游戏自己加载，不依赖加载器）。</p>}
      {mods === null && <p className="muted">正在读取…</p>}
      {mods?.length === 0 && <p className="muted">还没有模组。点「安装模组」选一个 .kmod 或 .pak 文件。</p>}
      <div className="list">
        {shown?.map((m) => (
          <div key={`${m.kind}:${m.file}`} className={`mod k-${m.kind}${m.enabled ? "" : " off"}`}>
            <div className="mod-head">
              {m.icon && <img className="modicon" src={m.icon} alt="" />}
              <div className="mod-title">
                <b>{m.name}</b>
                <div className="mod-meta">
                  <span className={`kind ${m.kind}`}>{KIND_LABEL[m.kind]}</span>
                  {m.version && <span>{m.version}</span>}
                  {m.author && <span>{m.author}</span>}
                  {m.pack === "folder" && <span className="chip">文件夹</span>}
                  {m.paks.length > 0 && <span className="chip">含 Pak</span>}
                  {m.pending && <span className="chip wait">下次启动游戏时安装</span>}
                </div>
              </div>
              <button className={m.enabled ? "pill on" : "pill"} onClick={() => toggle(m)} disabled={m.pending}>
                {m.enabled ? "已启用" : "已禁用"}
              </button>
            </div>
            <div className="mod-foot">
              <p>{m.description || m.id}</p>
              <button className="ghost danger small" onClick={() => void remove(m)}>删除</button>
            </div>
          </div>
        ))}
      </div>
      <p className="muted small">{android
          ? "Lua / 原生模组在下次启动游戏时生效，游戏里的 Mods 页也可以即时切换；Pak 模组的启用、停用、删除要在游戏关闭时进行，改完需重启游戏。"
          : "Lua / 原生模组的启用状态在下次启动游戏时生效，游戏里的 Mods 页也可以即时切换；Pak 模组要在游戏关闭时启用、停用或删除。"}</p>
    </div>
  );
}
