import { useEffect, useState } from "react";
import { api, errText } from "../api";
import { useToast } from "../toast";
import type { Shared } from "../App";
import GamePicker from "./GamePicker";
import { IconFolder, IconLoader, IconPlay } from "../Icons";

const Hero = ({ iconUrl, pickIcon, resetIcon, platform }: Pick<Shared, "iconUrl" | "pickIcon" | "resetIcon" | "platform">) => (
  <div className="hero">
    <div className="hero-icon">
      <button className="iconbtn" title="点击更换图标" onClick={pickIcon}>
        <img src={iconUrl || (platform === "android" ? "/icon-installer.png" : "/icon.png")} alt="" />
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
      <p>KARDS 的 KMod 加载器<wbr />安装与模组管理器</p>
    </div>
  </div>
);

// a package name may break after its dots
const breakable = (name: string) => name.replace(/\./g, ".\u200b");

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

  if (p.platform === "android") {
    const a = p.ainfo;
    const launchA = async () => {
      try {
        await api.launchGame();
      } catch (e) {
        toast("err", errText(e));
      }
    };
    const grant = async () => {
      try {
        await api.androidRequestAccess();
      } catch (e) {
        toast("err", errText(e));
      }
    };
    return (
      <div className="page">
        <Hero iconUrl={p.iconUrl} pickIcon={p.pickIcon} resetIcon={p.resetIcon} platform={p.platform} />

        <h2 className="sec"><IconPlay />游戏</h2>
        <div className="cards">
          <div className={a?.installed ? "pcard on" : "pcard"}>
            <b>{a?.installed ? `已安装${a.version ? " " + a.version : ""}` : "没有找到游戏"}</b>
            <small>{a?.installed ? breakable(config.package) : `没有找到 ${breakable(config.package)}，先到「安装器」给 KARDS 注入 kmod`}</small>
          </div>
          <button className="pcard action" onClick={launchA} disabled={!a?.installed}>
            <b>启动游戏</b>
            <small>启动打过补丁的 KARDS</small>
          </button>
        </div>

        <h2 className="sec"><IconFolder />文件权限</h2>
        {a?.access ? (
          <div className="cards">
            <div className="pcard on">
              <b>已授权</b>
              <small>可以读写游戏的 Android/media 文件夹</small>
            </div>
            <div className={state?.installed ? "pcard on" : "pcard"}>
              <b>{state?.installed ? "已找到 kmod 文件夹" : "还没有 kmod 文件夹"}</b>
              <small>{state?.installed ? (state.log_version ? `加载器 ${state.log_version}` : "加载器版本未知") : "装好游戏并启动一次后会出现"}</small>
            </div>
          </div>
        ) : (
          <>
            <p className="muted">管理模组要读写游戏放在 Android/media 里的 kmod 文件夹，需要在系统设置里允许“所有文件访问”。</p>
            <div className="row">
              <button className="primary" onClick={grant}>去授权</button>
              <button onClick={p.refreshAndroid}>已授权，刷新</button>
            </div>
          </>
        )}

        <div className="cards" style={{ marginTop: 18 }}>
          <button className="pcard action" onClick={() => go("mods")}>
            <b>管理模组</b>
            <small>启用、停用、安装</small>
          </button>
          <button className="pcard action" onClick={() => go("loader")}>
            <b>安装器</b>
            <small>把 kmod 注入游戏</small>
          </button>
        </div>
      </div>
    );
  }

  if (!config.game_dir) {
    return (
      <div className="page">
        <Hero iconUrl={p.iconUrl} pickIcon={p.pickIcon} resetIcon={p.resetIcon} platform={p.platform} />
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
      <Hero iconUrl={p.iconUrl} pickIcon={p.pickIcon} resetIcon={p.resetIcon} platform={p.platform} />

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
