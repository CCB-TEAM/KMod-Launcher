import { useCallback, useEffect, useRef, useState } from "react";
import { api, errText } from "../api";
import type { Shared } from "../App";

export default function Logs({ platform }: Shared) {
  const [which, setWhich] = useState<"kmod" | "proxy">("kmod");
  const [text, setText] = useState("");
  const [auto, setAuto] = useState(true);
  const [err, setErr] = useState("");
  const box = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    try {
      setText(await api.readLog(which));
      setErr("");
    } catch (e) {
      setErr(errText(e));
    }
  }, [which]);

  useEffect(() => {
    void load();
    if (!auto) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load, auto]);

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text]);

  return (
    <div className="page full">
      <div className="between">
        <h1>日志</h1>
        <div className="row">
          <div className="seg">
            <button className={which === "kmod" ? "on" : ""} onClick={() => setWhich("kmod")}>
              kmod.log
            </button>
            {platform !== "android" && (
              <button className={which === "proxy" ? "on" : ""} onClick={() => setWhich("proxy")}>
                proxy.log
              </button>
            )}
          </div>
          <label className="check">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            自动刷新
          </label>
          {platform !== "android" && <button onClick={() => api.openPath("logs")}>打开日志文件夹</button>}
        </div>
      </div>
      {err && <p className="err">{err}</p>}
      <pre className="log" ref={box}>
        {text || "（还没有日志。启动一次游戏后这里会出现内容。）"}
      </pre>
    </div>
  );
}
