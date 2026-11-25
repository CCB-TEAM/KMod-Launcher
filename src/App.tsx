import { useCallback, useEffect, useState } from "react";
import { api, errText, type Config, type InstallState } from "./api";
import { ToastHost } from "./toast";
import Home from "./pages/Home";
import Loader from "./pages/Loader";
import Mods from "./pages/Mods";
import Logs from "./pages/Logs";
import Settings from "./pages/Settings";

const PAGES = [
  { id: "home", label: "主页" },
  { id: "loader", label: "加载器" },
  { id: "mods", label: "模组" },
  { id: "logs", label: "日志" },
  { id: "settings", label: "设置" },
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

  const setConfig = async (c: Config) => {
    setCfg(await api.saveConfig(c));
    await refresh();
  };

  if (!config) return <div className="boot">{fatal || "正在加载…"}</div>;
  const shared: Shared = { config, setConfig, state, refresh, go: setPage };
  const needGame = !config.game_dir;

  return (
    <ToastHost>
      <div className="app">
        <nav className="side">
          <div className="brand">
            <img src="/icon.png" alt="" />
            <span>KMod</span>
          </div>
          {PAGES.map((p) => (
            <button
              key={p.id}
              className={page === p.id ? "nav active" : "nav"}
              disabled={needGame && p.id !== "home" && p.id !== "settings"}
              onClick={() => setPage(p.id)}
            >
              {p.label}
            </button>
          ))}
          <div className="grow" />
          <div className="ver">Launcher 0.1.0</div>
        </nav>
        <main className="content">
          {page === "home" && <Home {...shared} />}
          {page === "loader" && <Loader {...shared} />}
          {page === "mods" && <Mods {...shared} />}
          {page === "logs" && <Logs {...shared} />}
          {page === "settings" && <Settings {...shared} />}
        </main>
      </div>
    </ToastHost>
  );
}
