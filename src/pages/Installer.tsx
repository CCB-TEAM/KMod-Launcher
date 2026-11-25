import { useCallback, useEffect, useRef, useState } from "react";
import { api, errText, fmtSize, type InspectReport, type InstallerStatus, type UnrealApp } from "../api";
import { useToast } from "../toast";
import type { Shared } from "../App";

type View = "list" | "detail" | "run";
const call = api.androidInstaller;

/** The kmod installer built into the Android app: pick an installed Unreal game, check it, inject the loader, install it. */
export default function Installer({ config, setConfig, refresh, refreshAndroid }: Shared) {
  const toast = useToast();
  const [view, setView] = useState<View>("list");
  const [apps, setApps] = useState<UnrealApp[] | null>(null);
  const [flavors, setFlavors] = useState<string[]>(["release"]);
  const [flavor, setFlavor] = useState("release");
  const [canInstall, setCanInstall] = useState(true);
  const [sel, setSel] = useState<UnrealApp | null>(null);
  const [report, setReport] = useState<InspectReport | null>(null);
  const [status, setStatus] = useState<InstallerStatus | null>(null);
  const waitingUninstall = useRef(false);

  const scan = useCallback(async () => {
    setApps(null);
    try {
      const r = await call<{ apps: UnrealApp[] }>("installerScan");
      setApps(r.apps);
    } catch (e) {
      toast("err", errText(e));
      setApps([]);
    }
  }, [toast]);

  const loadInfo = useCallback(async () => {
    try {
      const i = await call<{ flavors: string[]; canInstall: boolean }>("installerInfo");
      setFlavors(i.flavors.length ? i.flavors : ["release"]);
      setCanInstall(i.canInstall);
    } catch {
      /* keep defaults */
    }
  }, []);

  useEffect(() => {
    void loadInfo();
    void scan();
    // an installation may be running already (the app was in the background)
    call<InstallerStatus>("installerStatus")
      .then((s) => {
        if (s.phase !== "idle") {
          setStatus(s);
          setView("run");
        }
      })
      .catch(() => {});
  }, [loadInfo, scan]);

  // poll while running
  useEffect(() => {
    if (view !== "run") return;
    const t = setInterval(() => {
      call<InstallerStatus>("installerStatus").then(setStatus).catch(() => {});
    }, 700);
    return () => clearInterval(t);
  }, [view]);

  // back from the system uninstall dialog: carry on
  useEffect(() => {
    const on = () => {
      if (document.visibilityState !== "visible") return;
      void loadInfo();
      if (waitingUninstall.current) {
        waitingUninstall.current = false;
        void call("installerProceed");
      }
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [loadInfo]);

  // finished: remember the package so the home page launches this game
  useEffect(() => {
    if (status?.phase === "done" && status.pkg && status.pkg !== config.package) {
      void setConfig({ ...config, package: status.pkg });
    }
    if (status?.phase === "done") {
      void refresh();
      void refreshAndroid();
    }
  }, [status?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (a: UnrealApp) => {
    setSel(a);
    setReport(null);
    setView("detail");
    try {
      setReport(await call<InspectReport>("installerInspect", { path: a.path, split: a.split }));
    } catch (e) {
      toast("err", errText(e));
    }
  };

  const start = async () => {
    if (!sel) return;
    try {
      await call("installerStart", { pkg: sel.pkg, label: sel.label, path: sel.path, flavor });
      setStatus({ phase: "working", text: "准备", message: "", pkg: sel.pkg, label: sel.label, size: 0 });
      setView("run");
    } catch (e) {
      toast("err", errText(e));
      void loadInfo();
    }
  };

  const back = async () => {
    await call("installerReset").catch(() => {});
    waitingUninstall.current = false;
    setStatus(null);
    setView("list");
    void scan();
  };

  const uninstall = async () => {
    waitingUninstall.current = true;
    try {
      await call("installerUninstall");
    } catch (e) {
      waitingUninstall.current = false;
      toast("err", errText(e));
    }
  };

  const launch = async () => {
    try {
      await api.launchGame();
    } catch (e) {
      toast("err", errText(e));
    }
  };

  // ---------------------------------------------------------------- views
  if (view === "run" && status) {
    const busy = status.phase === "working" || status.phase === "installing";
    return (
      <div className="page">
        <h1>{status.phase === "done" ? "安装完成" : status.phase === "error" ? "出错了" : `正在注入 ${status.label}`}</h1>
        <p className="muted mono">{status.pkg}</p>
        <section className="card">
          {busy && <div className="spinner" />}
          <p><b>{status.text}</b></p>
          {status.message && <p className={status.phase === "error" ? "err" : "muted"}>{status.message}</p>}
          {status.phase === "working" && <p className="muted small">签名这一步要读写整个 APK，需要一两分钟，请不要离开应用。</p>}
          {status.size > 0 && status.phase !== "done" && <p className="muted small">注入后的安装包 {fmtSize(status.size)}</p>}

          {status.phase === "need_uninstall" && (
            <div className="row">
              <button className="primary" onClick={uninstall}>卸载原版</button>
              <button onClick={() => call("installerProceed")}>我已卸载，继续</button>
              <button onClick={back}>取消</button>
            </div>
          )}
          {status.phase === "done" && (
            <>
              <p className="muted">
                kmod 已经注入。第一次启动游戏时，kmod 会在手机上建立它的文件夹：Android/media/{status.pkg}/kmod
              </p>
              <div className="row">
                <button className="primary" onClick={launch}>打开游戏</button>
                <button onClick={back}>返回</button>
              </div>
            </>
          )}
          {status.phase === "error" && (
            <div className="row">
              <button onClick={back}>返回</button>
            </div>
          )}
        </section>
      </div>
    );
  }

  if (view === "detail" && sel) {
    return (
      <div className="page">
        <h1>{sel.label}</h1>
        <p className="muted mono">{sel.pkg}</p>
        {!report && <p className="muted">正在检查…</p>}
        {report && (
          <>
            <section className="card">
              {report.facts.map(([k, v]) => (
                <div key={k} className="fact">
                  <span className="muted">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </section>
            {report.warnings.map((w) => (
              <p key={w} className="warnline">⚠ {w}</p>
            ))}
            {report.errors.map((w) => (
              <p key={w} className="err">✖ {w}</p>
            ))}
            {report.ok ? (
              <>
                <p><b>可以注入。</b></p>
                {flavors.length > 1 && (
                  <div className="row">
                    <span className="muted">加载器</span>
                    <div className="seg">
                      {flavors.map((f) => (
                        <button key={f} className={flavor === f ? "on" : ""} onClick={() => setFlavor(f)}>
                          {f === "dev" ? "开发版" : "正式版"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {!canInstall && (
                  <p className="muted">
                    需要先允许这个应用安装其他应用。
                    <button className="inline" onClick={() => call("installerAllowInstall")}>去设置</button>
                  </p>
                )}
                <div className="row">
                  <button className="primary" disabled={!canInstall} onClick={start}>注入并安装</button>
                  <button onClick={() => setView("list")}>返回</button>
                </div>
              </>
            ) : (
              <>
                <p className="err"><b>不能注入这个应用。</b></p>
                <div className="row"><button onClick={() => setView("list")}>返回</button></div>
              </>
            )}
          </>
        )}
        {!report && <div className="row"><button onClick={() => setView("list")}>返回</button></div>}
      </div>
    );
  }

  return (
    <div className="page">
      <h1>安装器</h1>
      <p className="muted">把 kmod 加载器注入手机上已安装的虚幻引擎游戏（目前针对 KARDS），不需要电脑。注入后的应用用本机生成的密钥签名，需要先卸载原版。</p>
      {apps === null && <p className="muted">正在查找已安装的虚幻引擎游戏…</p>}
      {apps?.length === 0 && <p className="muted">没有找到 64 位的虚幻引擎游戏。</p>}
      <div className="list">
        {apps?.map((a) => (
          <button key={a.pkg} className="appcard" onClick={() => open(a)}>
            <b>{a.label}</b>
            <small className={a.split ? "warnline" : "muted"}>{a.pkg}{a.split ? "　分包安装的应用暂不支持" : ""}</small>
          </button>
        ))}
      </div>
      <div className="row">
        <button onClick={scan}>重新查找</button>
      </div>
      <p className="muted small">首次注入需要允许本应用“安装其他应用”；注入包约 1 GB，会先存到 Android/media 里，装好后自动删除。</p>
    </div>
  );
}
