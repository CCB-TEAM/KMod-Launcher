import { useEffect, useRef, useState } from "react";
import type { PakPlan } from "./api";

function Files({ title, files, danger }: { title: string; files: string[]; danger?: boolean }) {
  if (!files.length) return null;
  return (
    <div className="pakfiles">
      <span className={danger ? "err" : "muted"}>{title}</span>
      {files.map((f) => (
        <code key={f}>{f}</code>
      ))}
    </div>
  );
}

/** Asked before a mod overwrites or removes pak files. */
export function PakWarning({ plan, onCancel, onConfirm }: { plan: PakPlan; onCancel: () => void; onConfirm: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div className="overlay">
      <div className="dialog warn" role="alertdialog">
        <h2>这次安装会改动 Pak 文件</h2>
        <p>“{plan.name}” {plan.version} 带有 Pak 模组。继续的话，旧文件会被直接覆盖，不保留备份。</p>
        <Files title="写入" files={plan.write} />
        <Files title="删除（新版本不再包含）" files={plan.remove} />
        <Files title="会覆盖不是这个模组安装的同名文件" files={plan.conflicts} danger />
        <div className="row end">
          <button ref={cancel} onClick={onCancel}>取消</button>
          <button className="primary" onClick={onConfirm}>覆盖安装</button>
        </div>
      </div>
    </div>
  );
}

/** Deleting a mod that installed paks: delete them too (default) or keep them as ordinary pak mods. */
export function DeleteWithPaks({ name, paks, onCancel, onConfirm }: { name: string; paks: string[]; onCancel: () => void; onConfirm: (deletePaks: boolean) => void }) {
  const [also, setAlso] = useState(true);
  return (
    <div className="overlay">
      <div className="dialog" role="alertdialog">
        <h2>删除模组“{name}”？</h2>
        <label className="check">
          <input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} />
          同时删除它安装的 Pak 文件
        </label>
        <Files title={also ? "将删除" : "将保留，作为普通 Pak 模组管理"} files={paks} />
        <div className="row end">
          <button onClick={onCancel}>取消</button>
          <button className="danger" onClick={() => onConfirm(also)}>删除</button>
        </div>
      </div>
    </div>
  );
}
