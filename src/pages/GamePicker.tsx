import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errText } from "../api";
import { useToast } from "../toast";
import type { Shared } from "../App";

/** Finds KARDS in the Steam libraries, or lets the user point at the folder by hand. */
export default function GamePicker({ config, setConfig }: Pick<Shared, "config" | "setConfig">) {
  const toast = useToast();
  const [found, setFound] = useState<string[] | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    api.detectGames().then(setFound).catch(() => setFound([]));
  }, []);

  const choose = async (path: string) => {
    try {
      await setConfig({ ...config, game_dir: path });
      toast("ok", "已选择游戏目录");
    } catch (e) {
      toast("err", errText(e));
    }
  };

  const browse = async () => {
    const dir = await open({ directory: true, title: "选择 KARDS 安装目录" });
    if (typeof dir === "string") await choose(dir);
  };

  return (
    <div className="picker">
      {found === null && <p className="muted">正在查找 Steam 里的 KARDS…</p>}
      {found !== null && found.length === 0 && <p className="muted">没有在 Steam 库里找到 KARDS，请手动选择。</p>}
      {found?.map((p) => (
        <button key={p} className={p === config.game_dir ? "choice on" : "choice"} onClick={() => choose(p)}>
          <span className="mono">{p}</span>
          {p === config.game_dir && <span className="tag">当前</span>}
        </button>
      ))}
      <div className="row">
        <input
          value={manual}
          placeholder="粘贴游戏目录，例如 D:\Steam\steamapps\common\KARDS"
          onChange={(e) => setManual(e.target.value)}
        />
        <button onClick={() => choose(manual)} disabled={!manual.trim()}>
          使用
        </button>
        <button onClick={browse}>浏览…</button>
      </div>
    </div>
  );
}
