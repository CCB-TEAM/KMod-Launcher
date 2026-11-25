import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useToast } from "../toast";
import type { Shared } from "../App";
import GamePicker from "./GamePicker";
import { IconFolder, IconLoader, IconPlay } from "../Icons";

const Hero = ({ iconUrl, pickIcon, resetIcon }: Pick<Shared, "iconUrl" | "pickIcon" | "resetIcon">) => (
  <div className="hero">
    <div className="hero-icon">
      <button className="iconbtn" title="点击更换图标" onClick={pickIcon}>
        <img src={iconUrl || "/icon.png"} alt="" />
        <span>更换</span>
      </button>
      {iconUrl && (
        <button className="ghost small" onClick={resetIcon}>
          恢复默认
        </button>
      )}
    </div>
    <div>
      <h1>KMod Launcher</h1>
      <p>KARDS 的 KMod 加载器安装与模组管理器</p>
    </div>
  </div>
);

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
        <Hero iconUrl={p.iconUrl} pickIcon={p.pickIcon} resetIcon={p.resetIcon} />
        <h2 className="sec"><IconFolder />选择游戏路径</h2>
        <p className="muted">先选择 KARDS 的安装位置，之后就可以安装加载器、管理模组。</p>
        <GamePicker config={config} setConfig={p.setConfig} />
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
      <Hero iconUrl={p.iconUrl} pickIcon={p.pickIcon} resetIcon={p.resetIcon} />

      <h2 className="sec"><IconFolder />游戏路径</h2>
      <div className="row grow-row">
        <div className="pathbox mono">{config.game_dir}</div>
        <button className="primary" onClick={launch} disabled={running}>
          <IconPlay />
          {running ? "运行中" : "启动游戏"}
        </button>
        <button onClick={() => api.openPath("game")}>游戏目录</button>
        <button onClick={() => api.openPath("mods")}>Mods 文件夹</button>
      </div>

      <h2 className="sec"><IconLoader />KMod 加载器</h2>
      {state?.installed ? (
        <div className="cards">
          <div className="pcard on">
            <b>{version || "未知版本"}</b>
            <small>{state.flavor === "dev" ? "开发版" : state.flavor === "release" ? "正式版" : "来源未知"}</small>
          </div>
          <button className="pcard action" onClick={() => go("loader")}>
            <b>检查更新</b>
            <small>更新、重装或切换版本类型</small>
          </button>
          <button className="pcard action" onClick={() => go("mods")}>
            <b>管理模组</b>
            <small>启用、停用、安装</small>
          </button>
        </div>
      ) : (
        <div className="cards">
          <button className="pcard action on" onClick={() => go("loader")}>
            <b>安装加载器</b>
            <small>
              {state?.foreign_proxy ? "游戏目录里有别的 dwmapi.dll，安装时会先问你" : "还没有安装 KMod"}
            </small>
          </button>
        </div>
      )}
    </div>
  );
}
