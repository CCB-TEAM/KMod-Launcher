import { useCallback, useEffect, useState } from "react";
import { api, errText, type AndroidInfo, type Config, type InstallState, type Platform, type Update } from "./api";
import { pickFiles } from "./pick";
import { ToastHost, useToast } from "./toast";
import Home from "./pages/Home";
import Loader from "./pages/Loader";
import Mods from "./pages/Mods";
import Discover from "./pages/Discover";
import Logs from "./pages/Logs";
import Settings from "./pages/Settings";
import Installer from "./pages/Installer";
import TitleBar from "./TitleBar";
import Onboarding from "./Onboarding";
import PermissionStep, { allGranted } from "./PermissionStep";
import UpdateDialog from "./Update";
import { allThemes, applyTheme } from "./themes";
import { IconHome, IconLoader, IconMods, IconLogs, IconSettings, IconStore } from "./Icons";

const PAGES = [
  { id: "home", label: "主页", Icon: IconHome },
  { id: "loader", label: "加载器", Icon: IconLoader },
  { id: "store", label: "发现", Icon: IconStore },
  { id: "mods", label: "模组", Icon: IconMods },
  { id: "logs", label: "日志", Icon: IconLogs },
  { id: "settings", label: "设置", Icon: IconSettings },
] as const;
type PageId = (typeof PAGES)[number]["id"];

export interface Shared {
  config: Config;
  setConfig: (c: Config) => Promise<void>;
  state: InstallState | null;
  refresh: () => Promise<void>;
  go: (p: PageId) => void;
  platform: Platform;
  /** Android only: permission and game status. */
  ainfo: AndroidInfo | null;
  refreshAndroid: () => Promise<void>;
  /** Custom icon as a data URL; the built-in icon when empty. */
  iconUrl: string;
  pickIcon: () => Promise<void>;
  resetIcon: () => Promise<void>;
  /** Asks GitHub for a newer launcher and offers it; says so when there is none. */
  checkUpdate: () => Promise<void>;
}

export default function App() {
  return (
    <ToastHost>
      <Inner />
    </ToastHost>
  );
}

function Inner() {
  const toast = useToast();
  const [iconUrl, setIconUrl] = useState("");
  const [page, setPage] = useState<PageId>("home");
  const [config, setCfg] = useState<Config | null>(null);
  const [state, setState] = useState<InstallState | null>(null);
  const [fatal, setFatal] = useState("");
  const [platform, setPlatform] = useState<Platform | "">("");
  const [ainfo, setAinfo] = useState<AndroidInfo | null>(null);
  const [narrow, setNarrow] = useState(window.innerWidth < 760);
  const [update, setUpdate] = useState<Update | null>(null);

  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 760);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const p = await api.platform();
      setPlatform(p);
      const c = await api.getConfig();
      setCfg(c);
      setState(p === "android" || c.game_dir ? await api.getInstalled() : null);
    } catch (e) {
      setState(null);
      setFatal(errText(e));
    }
  }, []);

  const refreshAndroid = useCallback(async () => {
    try {
      setAinfo(await api.androidInfo());
    } catch (e) {
      setAinfo({ access: false, apps: false, installed: false, version: "" });
      console.error(errText(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Android: re-check permission and game when coming back from the system settings / installer.
  useEffect(() => {
    if (platform !== "android") return;
    void refreshAndroid();
    const on = () => {
      if (document.visibilityState === "visible") {
        void refreshAndroid();
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [platform, refreshAndroid, refresh]);

  useEffect(() => {
    if (!config) return;
    const list = allThemes(config.custom_themes);
    applyTheme(list.find((t) => t.id === config.theme) ?? list[0]);
  }, [config?.theme, config?.custom_themes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.getIcon().then((u) => setIconUrl(u ?? "")).catch(() => {});
  }, []);

  const pickIcon = async () => {
    try {
      const [f] = await pickFiles(platform as Platform, { title: "选择图标", name: "图标 (PNG / ICO)", exts: ["png", "ico"] });
      if (!f) return;
      await api.setIcon(f);
      setIconUrl((await api.getIcon()) ?? "");
      toast("ok", "图标已更换");
    } catch (e) {
      toast("err", errText(e));
    }
  };
  const resetIcon = async () => {
    try {
      await api.resetIcon();
      setIconUrl("");
      toast("ok", "已恢复默认图标");
    } catch (e) {
      toast("err", errText(e));
    }
  };

  // once per start, after the guide; being offline is not worth a message here
  const ready = !!config?.onboarded;
  useEffect(() => {
    if (ready) api.checkUpdate().then(setUpdate).catch(() => {});
  }, [ready]);

  const checkUpdate = async () => {
    try {
      const u = await api.checkUpdate();
      if (u) setUpdate(u);
      else toast("ok", "已经是最新版本");
    } catch (e) {
      toast("err", errText(e));
    }
  };

  const setConfig = async (c: Config) => {
    setCfg(await api.saveConfig(c));
    await refresh();
  };

  if (!config || !platform) return <div className="boot">{fatal || "正在加载…"}</div>;
  const shared: Shared = { config, setConfig, state, refresh, go: setPage, platform, ainfo, refreshAndroid, iconUrl, pickIcon, resetIcon, checkUpdate };
  const android = platform === "android";
  const needGame = !android && !config.game_dir;
  const compact = android || narrow;
  const pages = PAGES.map((p) => (p.id === "loader" && android ? { ...p, label: "安装器" } : p));

  if (android && !ainfo) return <div className="boot">正在检查权限…</div>;
  // the first-start guide; and on Android nothing else is shown while a permission is missing
  if (!config.onboarded || (android && !allGranted(ainfo))) {
    return (
      <div className={compact ? "shell compact" : "shell"} data-platform={platform}>
        {!android && <TitleBar iconUrl={iconUrl} />}
        {!config.onboarded ? (
          <Onboarding config={config} setConfig={setConfig} platform={platform} ainfo={ainfo} refreshAndroid={refreshAndroid} />
        ) : (
          <div className="guide">
            <div className="guide-body">
              <PermissionStep ainfo={ainfo} refresh={refreshAndroid} />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {update && <UpdateDialog update={update} platform={platform} onClose={() => setUpdate(null)} />}
      <div className={compact ? "shell compact" : "shell"} data-platform={platform}>
        {!android && <TitleBar iconUrl={iconUrl} />}
        <div className="app">
          <nav className="side">
            {pages.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={page === id ? "nav active" : "nav"}
                disabled={needGame && id !== "home" && id !== "settings"}
                onClick={() => setPage(id)}
              >
                <Icon />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <main className="content">
            {page === "home" && <Home {...shared} />}
            {page === "loader" && (android ? <Installer {...shared} /> : <Loader {...shared} />)}
            {page === "store" && <Discover {...shared} />}
            {page === "mods" && <Mods {...shared} />}
            {page === "logs" && <Logs {...shared} />}
            {page === "settings" && <Settings {...shared} />}
          </main>
        </div>
      </div>
    </>
  );
}
