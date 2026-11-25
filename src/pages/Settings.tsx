import { useState } from "react";
import { errText } from "../api";
import { useToast } from "../toast";
import type { Shared } from "../App";
import GamePicker from "./GamePicker";
import ThemeSettings from "./ThemeSettings";

export default function Settings({ config, setConfig, platform }: Shared) {
  const android = platform === "android";
  const toast = useToast();
  const [proxy, setProxy] = useState(config.proxy);
  const [mirror, setMirror] = useState(config.mirror);
  const [pkg, setPkg] = useState(config.package);

  const save = async () => {
    try {
      await setConfig({ ...config, proxy: proxy.trim(), mirror: mirror.trim(), package: pkg.trim() });
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
          <span>下载镜像前缀</span>
          <input value={mirror} placeholder="加在 GitHub 下载地址前面的镜像，留空则直连" onChange={(e) => setMirror(e.target.value)} />
        </label>
        <p className="muted small">版本列表通过 GitHub API 获取，只走代理；镜像只用于下载压缩包。</p>
        <div className="row">
          <button className="primary" onClick={save}>
            保存
          </button>
        </div>
      </section>
      <section className="card">
        <h2>关于</h2>
        <p className="muted">KMod Launcher 0.1.0 · MIT 许可证。KARDS 属于其所有者，本项目与其没有隶属关系。</p>
      </section>
    </div>
  );
}
