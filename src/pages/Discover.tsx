import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errText, fmtSize, onProgress, pakPlan, type Catalog, type CatalogMod, type CatalogVersion, type ModInfo, type PakPlan, type Progress } from "../api";
import { useToast } from "../toast";
import type { Shared } from "../App";
import { IconFilter, IconGrid, IconList, IconSearch } from "../Icons";
import NativeWarning from "../NativeWarning";
import { PakWarning } from "../PakDialogs";
import { bestVersion, hereOf, isNewer, problem } from "../compat";
import { cachedCatalog, getCatalog } from "../catalog";

type Kind = "all" | "lua" | "native";
type Sort = "updated" | "downloads" | "stars" | "name";
const SORTS: [Sort, string][] = [["updated", "最近更新"], ["downloads", "下载量"], ["stars", "星标数"], ["name", "名称"]];

/** 1234 -> "1234", 23456 -> "2.3万" */
const fmtCount = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n));

export default function Discover({ config, state, ainfo, platform, go }: Shared) {
  const toast = useToast();
  const [catalog, setCatalog] = useState<Catalog | null>(cachedCatalog());
  const [loading, setLoading] = useState(false);
  const [installed, setInstalled] = useState<ModInfo[]>([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [sort, setSort] = useState<Sort>("updated");
  const [onlyCompatible, setOnlyCompatible] = useState(true);
  const [filters, setFilters] = useState(false);
  const [list, setList] = useState(false);
  const [detail, setDetail] = useState<CatalogMod | null>(null);
  const [asking, setAsking] = useState<{ m: CatalogMod; v: CatalogVersion } | null>(null);
  const [pakAsk, setPakAsk] = useState<{ m: CatalogMod; v: CatalogVersion; native: boolean; plan: PakPlan } | null>(null);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const alive = useRef(true);

  const here = hereOf(platform, state, ainfo);

  const readInstalled = useCallback(() => api.listMods().then((l) => alive.current && setInstalled(l)).catch(() => {}), []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const c = await getCatalog(true);
      if (alive.current) setCatalog(c);
    } catch (e) {
      toast("err", errText(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    alive.current = true;
    void readInstalled();
    if (!cachedCatalog()) void load();
    const un = onProgress((p) => alive.current && setProgress(p));
    return () => {
      alive.current = false;
      void un.then((f) => f());
    };
  }, [load, readInstalled, config.index_url]);

  const have = (m: CatalogMod) => installed.find((x) => x.id === m.id);

  const install = async (m: CatalogMod, v: CatalogVersion, allowNative = false, allowPaks = false) => {
    if (v.native && !allowNative) return setAsking({ m, v });
    const old = have(m);
    if (old?.pack === "folder" && !allowPaks && !confirm(`“${m.name}”现在是以文件夹安装的，会被下载的版本替换。继续？`)) return;
    setBusy(m.id);
    setProgress({ stage: "download", done: 0, total: v.size });
    try {
      await api.installRemote(m.id, v, allowNative, allowPaks);
      toast("ok", `已安装 ${m.name} ${v.version}，下次启动游戏时生效`);
      await readInstalled();
    } catch (e) {
      const t = errText(e);
      const plan = pakPlan(e);
      if (t === "NATIVE_CONFIRM") setAsking({ m, v: { ...v, native: true } });
      else if (plan) setPakAsk({ m, v, native: allowNative, plan });
      else toast("err", t);
    } finally {
      setBusy("");
      setProgress(null);
    }
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (catalog?.mods ?? [])
      .filter((m) => !needle || `${m.name} ${m.id} ${m.author} ${m.description}`.toLowerCase().includes(needle))
      .filter((m) => kind === "all" || (bestVersion(m, here).native ? "native" : "lua") === kind)
      .filter((m) => !onlyCompatible || !problem(bestVersion(m, here), here))
      .sort((a, b) =>
        sort === "stars" ? (b.stars ?? 0) - (a.stars ?? 0)
        : sort === "downloads" ? (b.downloads ?? 0) - (a.downloads ?? 0)
        : sort === "name" ? a.name.localeCompare(b.name)
        : (b.updated ?? "").localeCompare(a.updated ?? ""));
  }, [catalog, q, kind, sort, onlyCompatible, here.kmod, here.kards]); // eslint-disable-line react-hooks/exhaustive-deps

  // say so when the "compatible only" filter is what hides mods, instead of showing an empty page
  const hidden = onlyCompatible ? (catalog?.mods ?? []).filter((m) => problem(bestVersion(m, here), here)) : [];
  const takenDown = installed.filter((m) => catalog?.blocked.includes(m.id));

  const action = (m: CatalogMod, v: CatalogVersion) => {
    const old = have(m);
    const why = problem(v, here);
    if (busy === m.id) {
      const pct = progress?.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
      return <button className="get" disabled>{pct}%</button>;
    }
    if (old && !isNewer(v.version, old.version)) return <button className="get done" disabled>已安装</button>;
    return (
      <button className="get primary" disabled={!!busy || !!why || !state?.installed} title={why || (!state?.installed ? "先安装加载器" : "")} onClick={() => install(m, v)}>
        {why ? "不兼容" : old ? "更新" : "安装"}
      </button>
    );
  };

  return (
    <div className="page store">
      <div className="store-bar">
        <label className="search">
          <IconSearch />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索模组" />
        </label>
        <button className="tool" title="刷新" disabled={loading} onClick={load}>⟳</button>
        <button className="tool" title={list ? "网格" : "列表"} onClick={() => setList(!list)}>{list ? <IconGrid /> : <IconList />}</button>
        <button className={filters ? "tool on" : "tool"} title="筛选" onClick={() => setFilters(!filters)}><IconFilter /></button>
      </div>
      {filters && (
        <div className="store-filters">
          <div className="seg">
            {(["all", "lua", "native"] as const).map((k) => (
              <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{k === "all" ? "全部" : k === "lua" ? "Lua" : "原生"}</button>
            ))}
          </div>
          <div className="seg">
            {SORTS.map(([k, label]) => (
              <button key={k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{label}</button>
            ))}
          </div>
          <label className="check"><input type="checkbox" checked={onlyCompatible} onChange={(e) => setOnlyCompatible(e.target.checked)} />只看兼容的</label>
        </div>
      )}
      {takenDown.length > 0 && <p className="warnline">已安装的 {takenDown.map((m) => m.name).join("、")} 已被索引下架，建议到「模组」页删除。</p>}
      {!state?.installed && <p className="muted">加载器还没有安装，装好后才能安装模组。<button className="inline" onClick={() => go("loader")}>去安装</button></p>}
      {catalog?.errors.map((e) => (
        <p key={e} className="err small">读取索引失败：{e}</p>
      ))}
      {loading && !catalog && <p className="muted">正在获取模组列表…</p>}
      {catalog && !loading && shown.length === 0 && (
        <p className="muted">{catalog.mods.length === 0 ? "索引里还没有模组。" : "没有符合条件的模组。"}</p>
      )}
      {hidden.length > 0 && (
        <p className="muted">
          有 {hidden.length} 个模组和当前版本不兼容，已隐藏（{problem(bestVersion(hidden[0], here), here)}）。
          <button className="inline" onClick={() => setOnlyCompatible(false)}>显示</button>
        </p>
      )}
      <div className={list ? "store-grid as-list" : "store-grid"}>
        {shown.map((m) => {
          const v = bestVersion(m, here);
          const old = have(m);
          return (
            <div key={m.id} className={`scard ${v.native ? "native" : "lua"}`}>
              <button className="scover" onClick={() => setDetail(m)} aria-label={`${m.name} 详情`}>
                {m.cover ? <img className="cover" src={m.cover} alt="" /> : m.icon ? <img className="center" src={m.icon} alt="" /> : null}
                <span className="badges">
                  {old && <span className="badge done">{isNewer(v.version, old.version) ? "有更新" : "已安装"}</span>}
                  <span className={`badge ${v.native ? "native" : "lua"}`}>{v.native ? "原生 C++" : "Lua"}</span>
                  {v.paks && <span className="badge">含 Pak</span>}
                  {m.verified && <span className="badge">已验证</span>}
                </span>
              </button>
              <div className="sinfo">
                <div className="stext" onClick={() => setDetail(m)}>
                  <b>{m.name}</b>
                  <small>{m.author || m.id}</small>
                  {list && <p>{m.description}</p>}
                  <div className="stats">
                    {m.repo && (
                      <button
                        className="star"
                        title="在 GitHub 上点星"
                        onClick={(e) => {
                          e.stopPropagation();
                          void api.openUrl(m.repo!);
                        }}
                      >
                        ★ {fmtCount(m.stars ?? 0)}
                      </button>
                    )}
                    {m.downloads !== undefined && <span title="下载量">↓ {fmtCount(m.downloads)}</span>}
                    <span>v{v.version}</span>
                    {m.updated && <span>{m.updated}</span>}
                    <span>{fmtSize(v.size)}</span>
                  </div>
                </div>
                <div className="sbtns">
                  {action(m, v)}
                  <button className="tool" title="详情" onClick={() => setDetail(m)}>…</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {detail && !asking && !pakAsk && (
        <div className="overlay" onClick={() => setDetail(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dhead">
              {detail.icon && <img className="modicon" src={detail.icon} alt="" />}
              <div>
                <h2>{detail.name}</h2>
                <small className="muted">{detail.author}　{detail.id}</small>
              </div>
            </div>
            <p>{detail.description || "（没有说明）"}</p>
            {detail.downloads !== undefined && <p className="muted small">总下载量 {fmtCount(detail.downloads)}</p>}
            {detail.versions.map((v) => {
              const why = problem(v, here);
              const old = have(detail);
              return (
                <div key={v.version} className="rel between">
                  <div>
                    <b>{v.version}</b>
                    <span className="muted small">
                      　{v.published}　{fmtSize(v.size)}
                      {v.downloads !== undefined && `　↓ ${fmtCount(v.downloads)}`}
                    </span>
                    {v.permissions?.length ? <div className="muted small">权限：{v.permissions.join("、")}</div> : null}
                    {why && <div className="err small">{why}</div>}
                  </div>
                  <button disabled={!!busy || !!why || !state?.installed || old?.version === v.version} onClick={() => install(detail, v)}>
                    {old?.version === v.version ? "已安装" : "安装"}
                  </button>
                </div>
              );
            })}
            <div className="row end">
              {detail.repo && <button onClick={() => api.openUrl(detail.repo!)}>★ {fmtCount(detail.stars ?? 0)}　去 GitHub 点星</button>}
              <button className="primary" onClick={() => setDetail(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
      {pakAsk && (
        <PakWarning
          plan={pakAsk.plan}
          onCancel={() => setPakAsk(null)}
          onConfirm={() => {
            const a = pakAsk;
            setPakAsk(null);
            void install(a.m, a.v, a.native, true);
          }}
        />
      )}
      {asking && (
        <NativeWarning
          mod={{ name: asking.m.name, author: asking.m.author, repo: asking.m.repo || undefined, version: asking.v.version, verified: !!asking.m.verified }}
          onOpen={(u) => void api.openUrl(u)}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const a = asking;
            setAsking(null);
            void install(a.m, a.v, true);
          }}
        />
      )}
    </div>
  );
}
