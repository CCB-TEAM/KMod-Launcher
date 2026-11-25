import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errText, type Config, type InstallState } from "./api";
import { ToastHost, useToast } from "./toast";
import Home from "./pages/Home";
import Loader from "./pages/Loader";
import Mods from "./pages/Mods";
import Logs from "./pages/Logs";
import Settings from "./pages/Settings";
import TitleBar from "./TitleBar";
import { allThemes, applyTheme } from "./themes";
import { IconHome, IconLoader, IconMods, IconLogs, IconSettings } from "./Icons";

const PAGES = [
  { id: "home", label: "主页", Icon: IconHome },
  { id: "loader", label: "加载器", Icon: IconLoader },
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
  /** Custom icon as a data URL; the built-in icon when empty. */
  iconUrl: string;
  pickIcon: () => Promise<void>;
  resetIcon: () => Promise<void>;
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

  const refresh = useCallback(async () => {
    try {
      const c = await api.getConfig();
      setCfg(c);
      setState(c.game_dir ? await api.getInstalled() : null);
    } catch (e) {
      setState(null);
      setFatal(errText(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!config) return;
    const list = allThemes(config.custom_themes);
    applyTheme(list.find((t) => t.id === config.theme) ?? list[0]);
  }, [config?.theme, config?.custom_themes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.getIcon().then((u) => setIconUrl(u ?? "")).catch(() => {});
  }, []);

  const pickIcon = async () => {
    const f = await open({ title: "选择图标", filters: [{ name: "图标 (PNG / ICO)", extensions: ["png", "ico"] }] });
    if (typeof f !== "string") return;
    try {
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

  const setConfig = async (c: Config) => {
    setCfg(await api.saveConfig(c));
    await refresh();
  };

  if (!config) return <div className="boot">{fatal || "正在加载…"}</div>;
  const shared: Shared = { config, setConfig, state, refresh, go: setPage, iconUrl, pickIcon, resetIcon };
  const needGame = !config.game_dir;

  return (
    <>
      <div className="shell">
        <TitleBar iconUrl={iconUrl} />
        <div className="app">
          <nav className="side">
            {PAGES.map(({ id, label, Icon }) => (
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
            {page === "loader" && <Loader {...shared} />}
            {page === "mods" && <Mods {...shared} />}
            {page === "logs" && <Logs {...shared} />}
            {page === "settings" && <Settings {...shared} />}
          </main>
        </div>
      </div>
    </>
  );
}
