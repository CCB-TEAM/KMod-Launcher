import { useEffect } from "react";
import { api, errText, type AndroidInfo } from "./api";
import { useToast } from "./toast";

/** Everything the launcher cannot work without. */
export const allGranted = (a: AndroidInfo | null) => !!a?.access && !!a.apps;

/** Android: asks for the permissions and waits for them. */
export default function PermissionStep({ ainfo, refresh }: { ainfo: AndroidInfo | null; refresh: () => Promise<void> }) {
  const toast = useToast();
  const done = allGranted(ainfo);

  // the answer is given in a system screen or dialog: keep looking until it is there
  useEffect(() => {
    if (done) return;
    const t = setInterval(() => void refresh(), 1000);
    return () => clearInterval(t);
  }, [done, refresh]);

  const row = (granted: boolean, title: string, how: string, ask: () => Promise<void>) => (
    <div className={granted ? "perm ok" : "perm"}>
      <div>
        <b>{title}</b>
        <small>{granted ? "已授权" : how}</small>
      </div>
      {granted ? (
        <span className="perm-mark">✓</span>
      ) : (
        <button className="primary" onClick={() => ask().catch((e) => toast("err", errText(e)))}>去授权</button>
      )}
    </div>
  );

  return (
    <>
      <h1>授予权限</h1>
      <p className="muted">下面的权限缺一个都无法使用启动器。</p>
      {row(!!ainfo?.access, "所有文件访问权限", "安装和管理模组、读取日志要用。在打开的系统页面里开启后返回", api.androidRequestAccess)}
      {row(!!ainfo?.apps, "获取应用列表", "安装器要靠它找到游戏。在弹窗里选择允许；没有弹窗时到应用的权限设置里开启", api.androidRequestApps)}
    </>
  );
}
