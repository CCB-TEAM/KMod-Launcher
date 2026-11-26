import { useEffect, useRef, useState } from "react";

export interface NativeInfo {
  name: string;
  author?: string;
  repo?: string;
  version?: string;
  /** undefined: not from the catalogue (a local file) */
  verified?: boolean;
}

/** Asked before every install or update of a native mod. */
export default function NativeWarning({ mod, onCancel, onConfirm, onOpen }: { mod: NativeInfo; onCancel: () => void; onConfirm: () => void; onOpen?: (url: string) => void }) {
  const [wait, setWait] = useState(3);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
    const t = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="overlay">
      <div className={mod.verified ? "dialog warn" : "dialog warn danger-border"} role="alertdialog">
        <h2>⚠ 这是一个原生模组</h2>
        <p>“{mod.name}”包含 C++ 代码，会在游戏进程里运行。它能做游戏能做的任何事，包括读取你的账号信息和联网，加载器无法限制它。</p>
        <div className="facts">
          {mod.author && <div><span>作者</span><b>{mod.author}</b></div>}
          {mod.version && <div><span>版本</span><b>{mod.version}</b></div>}
          <div><span>状态</span><b className={mod.verified ? "" : "err"}>{mod.verified === undefined ? "本地文件，来源未知" : mod.verified ? "已验证（不代表绝对安全）" : "未经验证"}</b></div>
          {mod.repo && onOpen && <div><span>仓库</span><button className="ghost small" onClick={() => onOpen(mod.repo!)}>{mod.repo.replace("https://github.com/", "")}</button></div>}
        </div>
        <p className="muted small">只安装你信任的作者发布的模组。</p>
        <div className="row end">
          <button ref={cancel} className="primary" onClick={onCancel}>取消</button>
          <button className="danger" disabled={wait > 0} onClick={onConfirm}>仍然安装{wait > 0 ? `（${wait}）` : ""}</button>
        </div>
      </div>
    </div>
  );
}
