import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useToast } from "../toast";
import type { Shared } from "../App";
import GamePicker from "./GamePicker";

export default function Home(p: Shared) {
  const { config, state, go } = p;
  const toast = useToast();
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!config.game_dir) return;
    const poll = () => api.gameRunning().then(setRunning).catch(() => {});
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [config.game_dir]);

  if (!config.game_dir) {
    return (
      <div className="page">
        <h1>欢迎使用 KMod Launcher</h1>
        <p className="muted">先选择 KARDS 的安装位置，之后就可以安装加载器、管理模组。</p>
        <section className="card">
          <h2>游戏目录</h2>
          <GamePicker config={config} setConfig={p.setConfig} />
        </section>
      </div>
    );
  }

  const launch = async () => {
    try {
      await api.launchGame();
      setRunning(true);
    } catch (e) {
      toast("err", errText(e));
    }
  };

  const version = state?.tag || state?.log_version || "";

  return (
    <div className="page">
      <h1>主页</h1>
      <section className="card">
        <h2>游戏</h2>
        <div className="kv">
          <span>目录</span>
          <span className="mono">{config.game_dir}</span>
          <span>状态</span>
          <span>{running ? "运行中" : "未运行"}</span>
        </div>
        <div className="row">
          <button className="primary" onClick={launch} disabled={running}>
            启动游戏
          </button>
          <button onClick={() => api.openPath("game")}>打开目录</button>
        </div>
      </section>

      <section className="card">
        <h2>KMod 加载器</h2>
        {state?.installed ? (
          <>
            <div className="kv">
              <span>版本</span>
              <span>
                {version || "未知"} {state.flavor && <span className="tag">{state.flavor === "dev" ? "开发版" : "正式版"}</span>}
              </span>
            </div>
            <div className="row">
              <button onClick={() => go("loader")}>检查更新 / 重新安装</button>
              <button onClick={() => go("mods")}>管理模组</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">
              {state?.foreign_proxy
                ? "游戏目录里有别的 dwmapi.dll（比如 UE4SS），KMod 还没有安装。"
                : "还没有安装 KMod 加载器。"}
            </p>
            <div className="row">
              <button className="primary" onClick={() => go("loader")}>
                安装加载器
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
