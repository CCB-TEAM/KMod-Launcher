import { getCurrentWindow } from "@tauri-apps/api/window";

const run = (f: (w: ReturnType<typeof getCurrentWindow>) => Promise<void>) => () => {
  void f(getCurrentWindow()).catch(() => {});
};

export default function TitleBar() {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="tb-title" data-tauri-drag-region>
        <span data-tauri-drag-region>KMod Launcher</span>
        <small data-tauri-drag-region>0.1.0</small>
      </div>
      <div className="tb-btns">
        <button aria-label="最小化" onClick={run((w) => w.minimize())}>
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 6h10" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button aria-label="最大化" onClick={run((w) => w.toggleMaximize())}>
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button aria-label="关闭" className="close" onClick={run((w) => w.close())}>
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1.5 1.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
      </div>
    </header>
  );
}
