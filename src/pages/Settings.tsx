import { useState } from "react";
import { errText } from "../api";
import { useToast } from "../toast";
import type { Shared } from "../App";
import GamePicker from "./GamePicker";
import ThemeSettings from "./ThemeSettings";
import { GH_PROXIES, cleanMirror } from "./Route";

export default function Settings({ config, setConfig, platform, checkUpdate }: Shared) {
  const android = platform === "android";
  const toast = useToast();
  const [proxy, setProxy] = useState(config.proxy);
  const [mirror, setMirror] = useState(config.mirror);
  const [pkg, setPkg] = useState(config.package);
  const [index, setIndex] = useState(config.index_url);
  const [checking, setChecking] = useState(false);

  const save = async () => {
    try {
      await setConfig({ ...config, proxy: proxy.trim(), mirror: mirror.trim(), package: pkg.trim(), index_url: index.trim() });
      toast("ok", "已保存");
    } catch (e) {
      toast("err", errText(e));
    }
  };

  return (
    <div className="page">
      <h1>设置</h1>
      {!android && <section className="card">
        <h2>游戏目录</h2>
        <p className="mono small">{config.game_dir || "未选择"}</p>
        <GamePicker config={config} setConfig={setConfig} />
      </section>}
      <ThemeSettings config={config} setConfig={setConfig} />
      <section className="card">
        <h2>网络</h2>
        <label className="field">
          <span>代理</span>
          <input value={proxy} placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:7890（留空则用环境变量）" onChange={(e) => setProxy(e.target.value)} />
        </label>
        {android && (
          <label className="field">
            <span>游戏包名</span>
            <input value={pkg} placeholder="com.android1939.kardsapk" onChange={(e) => setPkg(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span>GitHub 代理前缀</span>
          <input value={mirror} placeholder="留空则直连" onChange={(e) => setMirror(e.target.value)} />
        </label>
        <div className="row">
          {GH_PROXIES.map((u) => (
            <button key={u} className={cleanMirror(mirror) === u ? "pill on" : "pill"} onClick={() => setMirror(cleanMirror(mirror) === u ? "" : u)}>
              使用 {u.replace("https://", "")}
            </button>
          ))}
        </div>
        <p className="muted small">代理前缀加在 GitHub 地址前面，用于下载文件；版本列表先直连 GitHub，失败时才经过代理。下载的文件按 GitHub 给出的 SHA-256 校验。</p>
        <label className="field">
          <span>模组索引地址</span>
          <textarea className="short" value={index} placeholder="留空使用官方索引；可以每行填一个" onChange={(e) => setIndex(e.target.value)} />
        </label>
        <div className="row">
          <button className="primary" onClick={save}>
            保存
          </button>
        </div>
      </section>
      <section className="card">
        <h2>关于</h2>
        <p className="muted">KMod Launcher 1.2.3 · MIT 许可证。KARDS 属于其所有者，本项目与其没有隶属关系。</p>
        <div className="row">
          <button
            disabled={checking}
            onClick={() => {
              setChecking(true);
              void checkUpdate().finally(() => setChecking(false));
            }}
          >
            {checking ? "检查中…" : "检查更新"}
          </button>
          <button onClick={() => void setConfig({ ...config, onboarded: false }).catch((e) => toast("err", errText(e)))}>重新查看启动引导</button>
        </div>
      </section>
    </div>
  );
}
