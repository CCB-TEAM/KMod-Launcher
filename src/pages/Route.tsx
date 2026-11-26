import type { Shared } from "../App";

/** Public GitHub proxies offered as presets; both are the same service under two domains. */
export const GH_PROXIES = ["https://gh-proxy.com", "https://gh-proxy.org"];
export const cleanMirror = (m: string) => m.trim().replace(/\/+$/, "");

/** Where downloads from GitHub go: directly, through a preset proxy, or through the prefix typed in the settings. */
export default function Route({ config, setConfig, onChange }: Pick<Shared, "config" | "setConfig"> & { onChange?: () => void }) {
  const current = cleanMirror(config.mirror);
  const choose = async (mirror: string) => {
    await setConfig({ ...config, mirror });
    onChange?.();
  };
  return (
    <div className="row route">
      <span className="muted">下载线路</span>
      <div className="seg">
        <button className={current === "" ? "on" : ""} onClick={() => choose("")}>直连</button>
        {GH_PROXIES.map((u) => (
          <button key={u} className={current === u ? "on" : ""} onClick={() => choose(u)}>{u.replace("https://", "")}</button>
        ))}
        {current !== "" && !GH_PROXIES.includes(current) && <button className="on" title={current}>自定义</button>}
      </div>
    </div>
  );
}
