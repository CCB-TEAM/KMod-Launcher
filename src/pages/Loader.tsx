import { useEffect, useRef, useState } from "react";
import { api, errText, fmtSize, onProgress, type Asset, type Progress, type Release } from "../api";
import { useToast } from "../toast";
import type { Shared } from "../App";

export default function Loader({ config, setConfig, state, refresh }: Shared) {
  const toast = useToast();
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [open, setOpen] = useState<string>("");
  const [confirmForeign, setConfirmForeign] = useState<{ a: Asset; tag: string } | null>(null);
  const alive = useRef(true);

  const load = async () => {
    setError("");
    setReleases(null);
    try {
      setReleases(await api.listReleases());
    } catch (e) {
      setError(errText(e));
    }
  };

  useEffect(() => {
    alive.current = true;
    void load();
    const un = onProgress((p) => alive.current && setProgress(p));
    return () => {
      alive.current = false;
      void un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.prereleases]);

  const flavor = config.flavor;
  const pick = (r: Release) => r.assets.find((a) => a.flavor === flavor);

  const run = async (a: Asset, tag: string, replaceForeign = false) => {
    setBusy(true);
    setProgress({ stage: "download", done: 0, total: a.size });
    try {
      await api.installLoader(a, tag, replaceForeign);
      toast("ok", `已安装 ${tag}`);
      await refresh();
    } catch (e) {
      const t = errText(e);
      if (t === "FOREIGN_PROXY") setConfirmForeign({ a, tag });
      else toast("err", t);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const uninstall = async (removeData: boolean) => {
    try {
      await api.uninstallLoader(removeData);
      toast("ok", "已卸载");
      await refresh();
    } catch (e) {
      toast("err", errText(e));
    }
  };

  const latest = releases?.find((r) => pick(r));
  const upToDate = !!state?.installed && !!latest && state.tag === latest.tag && state.flavor === flavor;
  const pct = progress && progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0;

  return (
    <div className="page">
      <h1>加载器</h1>

      <section className="card">
        <div className="between">
          <h2>安装的版本</h2>
          <div className="seg">
            {(["release", "dev"] as const).map((f) => (
              <button key={f} className={flavor === f ? "on" : ""} onClick={() => setConfig({ ...config, flavor: f })}>
                {f === "release" ? "正式版" : "开发版"}
              </button>
            ))}
          </div>
        </div>
        <p className="muted">
          {state?.installed
            ? `当前：${state.tag || state.log_version || "未知版本"}（${state.flavor === "dev" ? "开发版" : state.flavor === "release" ? "正式版" : "来源未知"}）`
            : "未安装"}
          {flavor === "dev" && "　开发版会多开一个控制台窗口，写模组时用。"}
        </p>
        {busy && (
          <div className="bar">
            <div style={{ width: `${progress?.stage === "download" ? pct : 100}%` }} />
            <span>
              {progress?.stage === "extract" ? "正在解压…" : `下载中 ${fmtSize(progress?.done ?? 0)} / ${fmtSize(progress?.total ?? 0)}`}
            </span>
          </div>
        )}
        <div className="row">
          {latest && (
            <button className="primary" disabled={busy} onClick={() => run(pick(latest)!, latest.tag)}>
              {!state?.installed ? `安装 ${latest.tag}` : upToDate ? `重新安装 ${latest.tag}` : `更新到 ${latest.tag}`}
            </button>
          )}
          {state?.installed && (
            <>
              <button disabled={busy} onClick={() => uninstall(false)}>
                卸载（保留模组和数据）
              </button>
              <button className="danger" disabled={busy} onClick={() => confirm("会删除 kmod 文件夹里的全部内容，包括模组和日志。继续？") && uninstall(true)}>
                卸载并删除数据
              </button>
            </>
          )}
        </div>
      </section>

      {confirmForeign && (
        <section className="card warn">
          <h2>游戏目录里已经有别的 dwmapi.dll</h2>
          <p>通常是 UE4SS。两个加载器不能同时用这个名字。继续的话，原文件会改名为 dwmapi.dll.disabled，卸载 KMod 时会改回来。</p>
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                const c = confirmForeign;
                setConfirmForeign(null);
                void run(c.a, c.tag, true);
              }}
            >
              改名并继续
            </button>
            <button onClick={() => setConfirmForeign(null)}>取消</button>
          </div>
        </section>
      )}

      <section className="card">
        <div className="between">
          <h2>所有版本</h2>
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={config.prereleases} onChange={(e) => setConfig({ ...config, prereleases: e.target.checked })} />
              包含预发布
            </label>
            <button onClick={load}>刷新</button>
          </div>
        </div>
        {error && <p className="err">{error}</p>}
        {!error && !releases && <p className="muted">正在获取…</p>}
        {releases?.length === 0 && <p className="muted">没有可用的版本。</p>}
        {releases?.map((r) => {
          const a = pick(r);
          const expanded = open === r.tag;
          return (
            <div key={r.tag} className="rel">
              <div className="between">
                <div>
                  <b>{r.tag}</b>
                  {r.prerelease && <span className="tag">预发布</span>}
                  {state?.tag === r.tag && <span className="tag on">已安装</span>}
                  <span className="muted small">　{r.published.slice(0, 10)}</span>
                </div>
                <div className="row">
                  <button onClick={() => setOpen(expanded ? "" : r.tag)}>{expanded ? "收起" : "更新说明"}</button>
                  <button disabled={busy || !a} onClick={() => a && run(a, r.tag)}>
                    {a ? `安装（${fmtSize(a.size)}）` : "没有此版本类型"}
                  </button>
                </div>
              </div>
              {expanded && <pre className="notes">{r.notes || "（没有说明）"}</pre>}
            </div>
          );
        })}
        <div className="row">
          <button onClick={() => api.openUrl("https://github.com/CCB-TEAM/KMod-Loader-Windows/releases")}>在 GitHub 打开</button>
        </div>
      </section>
    </div>
  );
}
