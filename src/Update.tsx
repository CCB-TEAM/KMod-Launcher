import { useEffect, useState } from "react";
import { api, errText, fmtSize, onProgress, type Progress, type Update } from "./api";
import { useToast } from "./toast";

/** A newer launcher exists: show what is new, download it and install it. */
export default function UpdateDialog({ update, platform, onClose }: { update: Update; platform: string; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const android = platform === "android";

  useEffect(() => {
    const un = onProgress(setProgress);
    return () => void un.then((f) => f());
  }, []);

  const install = async () => {
    setBusy(true);
    setProgress(null);
    try {
      // Windows restarts from inside this call; Android opens the system installer and comes back here
      await api.installUpdate();
    } catch (e) {
      toast("err", errText(e));
    } finally {
      setBusy(false);
    }
  };

  const pct = progress?.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  return (
    <div className="overlay">
      <div className="dialog" role="dialog">
        <h2>有新版本 {update.version}</h2>
        <p className="muted small">大小 {fmtSize(update.size)}{android ? "。下载完成后在系统弹窗里确认安装。" : "。下载完成后启动器会自动重启。"}</p>
        {update.notes && <div className="notes">{update.notes}</div>}
        {!update.installable && <p className="warnline small">现在连不上 GitHub（版本信息来自代理，无法核对文件），请到发布页下载。</p>}
        <div className="row end">
          <button disabled={busy} onClick={onClose}>稍后</button>
          <button onClick={() => void api.openUrl(update.page)}>发布页</button>
          {update.installable && (
            <button className="primary" disabled={busy} onClick={install}>{busy ? `下载中 ${pct}%` : "更新"}</button>
          )}
        </div>
      </div>
    </div>
  );
}
