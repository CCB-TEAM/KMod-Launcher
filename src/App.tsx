import { useCallback, useEffect, useState } from "react";
import { api, errText, type Config, type InstallState } from "./api";
import { ToastHost } from "./toast";
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
}

export default function App() {
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

  const setConfig = async (c: Config) => {
    setCfg(await api.saveConfig(c));
    await refresh();
  };

  if (!config) return <div className="boot">{fatal || "正在加载…"}</div>;
  const shared: Shared = { config, setConfig, state, refresh, go: setPage };
  const needGame = !config.game_dir;

  return (
    <ToastHost>
      <div className="shell">
        <TitleBar />
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
    </ToastHost>
  );
}
