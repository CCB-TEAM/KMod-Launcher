import type { Shared } from "../App";

export const GH_PROXY = "https://gh-proxy.com";

/** Where downloads from GitHub go: directly, through gh-proxy.com, or through the prefix typed in the settings. */
export default function Route({ config, setConfig, onChange }: Pick<Shared, "config" | "setConfig"> & { onChange?: () => void }) {
  const current = config.mirror.trim().replace(/\/+$/, "");
  const choose = async (mirror: string) => {
    await setConfig({ ...config, mirror });
    onChange?.();
  };
  return (
    <div className="row route">
      <span className="muted">下载线路</span>
      <div className="seg">
        <button className={current === "" ? "on" : ""} onClick={() => choose("")}>直连</button>
        <button className={current === GH_PROXY ? "on" : ""} onClick={() => choose(GH_PROXY)}>gh-proxy.com</button>
        {current !== "" && current !== GH_PROXY && <button className="on" title={current}>自定义</button>}
      </div>
    </div>
  );
}
