import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { pickFiles } from "../pick";
import { api, errText, onProgress, pakPlan, type CatalogMod, type CatalogVersion, type ModInfo, type PakPlan, type Progress } from "../api";
import { useToast } from "../toast";
import type { Shared } from "../App";
import { IconDown, IconFolder, IconPlus, IconRefresh, IconSearch, IconTrash, IconUp, IconUpdate } from "../Icons";
import NativeWarning from "../NativeWarning";
import { DeleteWithPaks, PakWarning } from "../PakDialogs";
import { hereOf, updateFor } from "../compat";
import { cachedCatalog, getCatalog } from "../catalog";

const KIND_LABEL = { lua: "Lua", native: "原生 C++", pak: "Pak" } as const;
type Tab = "all" | ModInfo["kind"] | "updates";

/** Asks the player something through a dialog and waits for the answer. */
type Ask<T> = { value: T; answer: (ok: boolean) => void } | null;

export default function Mods({ state, platform, ainfo }: Shared) {
  const android = platform === "android";
  const toast = useToast();
  const [mods, setMods] = useState<ModInfo[] | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<CatalogMod[]>(cachedCatalog()?.mods ?? []);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(!!cachedCatalog());
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [nativeAsk, setNativeAsk] = useState<Ask<string>>(null);
  const [pakAsk, setPakAsk] = useState<Ask<PakPlan>>(null);
  const [removing, setRemoving] = useState<ModInfo | null>(null);
  const [busy, setBusy] = useState("");             // id of the mod being updated
  const [progress, setProgress] = useState<Progress | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);
  const here = hereOf(platform, state, ainfo);

  const ask = <T,>(set: (a: Ask<T>) => void, value: T) =>
    new Promise<boolean>((answer) => set({ value, answer })).finally(() => set(null));

  const load = useCallback(async () => {
    try {
      const list = await api.listMods();
      const o = await api.pakOrder().catch(() => []);
      if (!alive.current) return;
      setMods(list);
      setOrder(o);
    } catch (e) {
      toast("err", errText(e));
      setMods([]);
    }
  }, [toast]);

  const checkUpdates = useCallback(
    async (fresh: boolean, quiet = false) => {
      setChecking(true);
      try {
        const c = await getCatalog(fresh);
        if (!alive.current) return;
        setCatalog(c.mods);
        setChecked(true);
        if (!quiet && c.errors.length) toast("err", `读取索引失败：${c.errors[0]}`);
      } catch (e) {
        if (!quiet) toast("err", errText(e));
      } finally {
        if (alive.current) setChecking(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    alive.current = true;
    void load();
    void checkUpdates(false, true);
    const un = onProgress((p) => alive.current && setProgress(p));
    return () => {
      alive.current = false;
      void un.then((f) => f());
    };
  }, [load, checkUpdates]);

  /** Runs one installation; asks before a native mod and before pak files are overwritten. False when cancelled or failed. */
  const run = async (name: string, step: (native: boolean, paks: boolean) => Promise<string>) => {
    let native = false;
    let paks = false;
    for (;;) {
      try {
        await step(native, paks);
        return true;
      } catch (e) {
        const plan = pakPlan(e);
        if (errText(e) === "NATIVE_CONFIRM" && !native) {
          if (!(native = await ask(setNativeAsk, name))) return false;
        } else if (plan && !paks) {
          if (!(paks = await ask(setPakAsk, plan))) return false;
        } else {
          toast("err", `${name}：${errText(e)}`);
          return false;
        }
      }
    }
  };

  const installFile = (path: string) => {
    const name = path.split(/[\\/]/).pop() ?? path;
    return run(name, async (native, paks) => {
      const done = await api.installMod(path, native, paks);
      toast("ok", `已安装 ${done}`);
      return done;
    });
  };

  const update = async (m: ModInfo, v: CatalogVersion) => {
    setBusy(m.id);
    setProgress({ stage: "download", done: 0, total: v.size });
    const ok = await run(m.name, (native, paks) => api.installRemote(m.id, v, native, paks));
    setBusy("");
    setProgress(null);
    if (ok) toast("ok", `${m.name} 已更新到 ${v.version}，下次启动游戏时生效`);
    return ok;
  };

  const updateAll = async () => {
    for (const [m, v] of updates) if (!(await update(m, v))) break;
    await load();
  };

  const add = async () => {
    let files: string[] = [];
    try {
      files = await pickFiles(platform, { multiple: true, title: "选择模组", name: "KMod 模组 / Pak", exts: ["kmod", "pak"] });
    } catch (e) {
      return toast("err", errText(e));
    }
    for (const path of files) await installFile(path);
    await load();
  };

  const addFolder = async () => {
    const d = await open({ directory: true, title: "选择模组文件夹（里面要有 mod.json）" });
    if (typeof d !== "string") return;
    await installFile(d);
    await load();
  };

  const toggle = async (m: ModInfo) => {
    try {
      await api.setModEnabled(m.id, !m.enabled, m.kind);
      setMods((l) => l?.map((x) => (x === m ? { ...x, enabled: !m.enabled } : x)) ?? null);
    } catch (e) {
      toast("err", errText(e));
    }
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

  /** Moves a pak one place up or down in the mount order. */
  const move = async (m: ModInfo, by: -1 | 1) => {
    const name = `${m.file}.pak`;
    const next = [...order];
    const i = next.indexOf(name);
    const j = i + by;
    if (i < 0 || j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    try {
      await api.setPakOrder(next);
    } catch (e) {
      toast("err", errText(e));
    }
    if (!android) void load();          // the files were renamed
  };

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), checkUpdates(true)]);
    setRefreshing(false);
  };

  const updates = useMemo(
    () => (mods ?? []).flatMap((m) => {
      const v = updateFor(m, catalog, here);
      return v ? [[m, v] as const] : [];
    }),
    [mods, catalog, here.kmod, here.kards, here.platform], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const updateOf = (m: ModInfo) => updates.find(([x]) => x === m)?.[1];

  const needle = q.trim().toLowerCase();
  const count = (t: Tab) => (t === "all" ? mods?.length ?? 0 : t === "updates" ? updates.length : mods?.filter((m) => m.kind === t).length ?? 0);
  const pakRank = (m: ModInfo) => order.indexOf(`${m.file}.pak`);
  const ordering = tab === "pak" && !needle;
  const shown = (mods ?? [])
    .filter((m) => (tab === "all" ? true : tab === "updates" ? !!updateOf(m) : m.kind === tab))
    .filter((m) => !needle || `${m.name} ${m.id} ${m.author} ${m.description}`.toLowerCase().includes(needle));
  if (ordering) shown.sort((a, b) => pakRank(a) - pakRank(b));
  const enabledCount = mods?.filter((m) => m.enabled).length ?? 0;
  const pct = progress?.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  const tabs: [Tab, string][] = [["all", "全部"], ["lua", "Lua"], ["native", "原生"], ["pak", "Pak"]];
  if (updates.length) tabs.push(["updates", "可更新"]);

  return (
    <div className="page mods-page">
      {nativeAsk && <NativeWarning mod={{ name: nativeAsk.value }} onCancel={() => nativeAsk.answer(false)} onConfirm={() => nativeAsk.answer(true)} />}
      {pakAsk && <PakWarning plan={pakAsk.value} onCancel={() => pakAsk.answer(false)} onConfirm={() => pakAsk.answer(true)} />}
      {removing && <DeleteWithPaks name={removing.name} paks={removing.paks} onCancel={() => setRemoving(null)} onConfirm={(also) => void remove(removing, also)} />}

      <div className="mods-top">
        <div>
          <h1>模组管理</h1>
          <small className="muted">
            {mods === null ? "正在读取…" : `已启用 ${enabledCount} / ${mods.length}`}
            {updates.length > 0 && <span className="upd-count"> · {updates.length} 个可更新</span>}
          </small>
        </div>
        <div className="mods-actions">
          <button className="tool" title="刷新并检查更新" aria-label="刷新并检查更新" disabled={refreshing || checking} onClick={() => void refresh()}>
            <span className={refreshing || checking ? "spin" : ""}><IconRefresh /></span>
          </button>
          {!android && <button onClick={addFolder}><IconFolder />安装文件夹</button>}
          <button className="primary" onClick={add}><IconPlus />安装模组</button>
        </div>
      </div>

      {updates.length > 0 && (
        <div className="upd-banner">
          <div className="upd-icon"><IconUpdate /></div>
          <div className="upd-text">
            <b>{updates.length} 个模组有新版本</b>
            <small>{updates.map(([m, v]) => `${m.name} ${m.version} → ${v.version}`).join("　")}</small>
          </div>
          <button className="primary" disabled={!!busy || !state?.installed} title={!state?.installed ? "先安装加载器" : ""} onClick={() => void updateAll()}>
            {busy ? `更新中 ${pct}%` : "全部更新"}
          </button>
        </div>
      )}

      <div className="mods-bar">
        <label className="search">
          <IconSearch />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索名称、id、作者或说明…" />
        </label>
        <div className="seg types">
          {tabs.map(([t, label]) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {label}<span className="n">{count(t)}</span>
            </button>
          ))}
        </div>
      </div>

      {android && !state?.installed && <p className="note">还没有找到 kmod 文件夹：先在「安装器」里装好打过补丁的游戏并启动一次，再回来管理模组。</p>}
      {!android && !state?.installed && <p className="note">加载器还没有安装，Lua 和原生模组在安装后才会生效（Pak 模组由游戏自己加载，不依赖加载器）。</p>}
      {tab === "pak" && (
        <p className="note">
          {needle
            ? "清空搜索后可以调整加载顺序。"
            : android
              ? "按加载顺序排列：越靠下越晚加载，多个 Pak 改了同一个资源时以下面的为准。顺序在下次启动游戏时生效。"
              : "按优先级排列：越靠下优先级越高，多个 Pak 改了同一个资源时以下面的为准。游戏按文件名决定优先级，所以调整顺序会把文件改名为「原名.kmod_序号_P.pak」。要在游戏关闭时调整。"}
        </p>
      )}

      {mods?.length === 0 && (
        <div className="empty">
          <b>还没有模组</b>
          <p className="muted">到「发现」页下载，或者点「安装模组」选一个 .kmod 或 .pak 文件。</p>
        </div>
      )}
      {mods !== null && mods.length > 0 && shown.length === 0 && <p className="muted">没有符合条件的模组。</p>}

      <div className="mlist">
        {shown.map((m, i) => {
          const v = updateOf(m);
          return (
            <div key={`${m.kind}:${m.file}`} className={`mrow k-${m.kind}${m.enabled ? "" : " off"}`}>
              {ordering && <span className="rank">{i + 1}</span>}
              {m.icon ? <img className="micon" src={m.icon} alt="" /> : <span className="micon letter">{[...m.name][0]?.toUpperCase()}</span>}
              <div className="mbody">
                <div className="mname">
                  <b>{m.name}</b>
                  {m.version && <span className="ver">v{m.version}</span>}
                  {v && <span className="newver">→ v{v.version}</span>}
                </div>
                <div className="mmeta">
                  <span className={`kind ${m.kind}`}>{KIND_LABEL[m.kind]}</span>
                  {m.author && <span>{m.author}</span>}
                  {m.pack === "folder" && <span className="chip">文件夹</span>}
                  {m.paks.length > 0 && <span className="chip">含 {m.paks.length} 个 Pak</span>}
                  {m.pending && <span className="chip wait">下次启动游戏时安装</span>}
                </div>
                {(m.description || m.kind !== "pak") && <p className="mdesc">{m.description || m.id}</p>}
              </div>
              <div className="mside">
                <button
                  className={m.enabled ? "switch on" : "switch"}
                  role="switch"
                  aria-checked={m.enabled}
                  aria-label={m.enabled ? "已启用" : "已禁用"}
                  title={m.enabled ? "已启用，点一下禁用" : "已禁用，点一下启用"}
                  disabled={m.pending}
                  onClick={() => void toggle(m)}
                >
                  <i />
                </button>
                <div className="mbtns">
                  {v && (
                    <button className="small-btn primary" disabled={!!busy || !state?.installed} onClick={() => void update(m, v).then(() => load())}>
                      {busy === m.id ? `${pct}%` : "更新"}
                    </button>
                  )}
                  {ordering && (
                    <>
                      <button className="icon-btn" title="上移（更早加载）" aria-label="上移" disabled={i === 0} onClick={() => void move(m, -1)}><IconUp /></button>
                      <button className="icon-btn" title="下移（更晚加载，优先级更高）" aria-label="下移" disabled={i === shown.length - 1} onClick={() => void move(m, 1)}><IconDown /></button>
                    </>
                  )}
                  <button className="icon-btn danger" title="删除" aria-label={`删除 ${m.name}`} onClick={() => void remove(m)}><IconTrash /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mods-foot">
        <p className="muted small">
          {checking ? "正在检查更新…" : checked && !!mods?.length && !updates.length ? "已检查更新：模组都是最新的。" : ""}
          {android
            ? "Lua / 原生模组在下次启动游戏时生效，游戏里的 Mods 页也可以即时切换；Pak 模组的启用、停用、删除和顺序要在游戏关闭时调整，改完需重启游戏。"
            : "Lua / 原生模组的启用状态在下次启动游戏时生效，游戏里的 Mods 页也可以即时切换；Pak 模组要在游戏关闭时启用、停用、删除或调整顺序。"}
        </p>
        {!android && (
          <div className="row">
            <button className="ghost small-btn" onClick={() => api.openPath("mods")}><IconFolder />Mods 文件夹</button>
            <button className="ghost small-btn" onClick={() => api.openPath("paks")}><IconFolder />Paks 文件夹</button>
          </div>
        )}
      </div>
    </div>
  );
}
