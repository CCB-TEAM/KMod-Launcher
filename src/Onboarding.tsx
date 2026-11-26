import { useState } from "react";
import { errText } from "./api";
import { useToast } from "./toast";
import type { Shared } from "./App";
import { allThemes, applyTheme } from "./themes";
import ThemeGrid from "./pages/ThemeGrid";
import PermissionStep, { allGranted } from "./PermissionStep";
import { GH_PROXIES, cleanMirror } from "./pages/Route";

type Choice = "direct" | "custom" | string;

/** Shown on the first start: pick a theme, decide whether GitHub goes through a proxy and, on Android, grant file access. */
export default function Onboarding({ config, setConfig, platform, ainfo, refreshAndroid }: Pick<Shared, "config" | "setConfig" | "platform" | "ainfo" | "refreshAndroid">) {
  const android = platform === "android";
  const steps = android ? 3 : 2;
  const granted = allGranted(ainfo);
  const [skipped, setSkipped] = useState(false);
  const toast = useToast();
  const themes = allThemes(config.custom_themes);
  const saved = cleanMirror(config.mirror);
  const [step, setStep] = useState(0);
  const [theme, setTheme] = useState(config.theme);
  const [choice, setChoice] = useState<Choice>(saved === "" ? "direct" : GH_PROXIES.includes(saved) ? saved : "custom");
  const [custom, setCustom] = useState(GH_PROXIES.includes(saved) ? "" : saved);
  const [busy, setBusy] = useState(false);

  const mirror = choice === "direct" ? "" : choice === "custom" ? cleanMirror(custom) : choice;
  const badCustom = choice === "custom" && !/^https?:\/\/[^\s/]+/.test(mirror);

  const pick = (id: string) => {
    setTheme(id);
    applyTheme(themes.find((t) => t.id === id) ?? themes[0]);
  };

  const restore = () => applyTheme(themes.find((t) => t.id === config.theme) ?? themes[0]);
  // "skip" leaves the settings as they are, but the permission cannot be skipped
  const skip = () => {
    if (!android || granted) return void finish(false);
    restore();
    setSkipped(true);
    setStep(2);
  };

  const finish = async (keep: boolean) => {
    setBusy(true);
    try {
      if (!keep) restore();
      await setConfig(keep ? { ...config, theme, mirror, onboarded: true } : { ...config, onboarded: true });
    } catch (e) {
      toast("err", errText(e));
      setBusy(false);
    }
  };

  const option = (value: Choice, title: string, note: string) => (
    <button key={value} className={choice === value ? "choice on" : "choice"} onClick={() => setChoice(value)} aria-pressed={choice === value}>
      <b>{title}</b>
      <small>{note}</small>
    </button>
  );

  return (
    <div className="guide">
      <div className="guide-body">
        <div className="steps" aria-label={`第 ${step + 1} 步，共 ${steps} 步`}>
          {Array.from({ length: steps }, (_, i) => (
            <i key={i} className={i <= step ? "on" : ""} />
          ))}
        </div>
        {step === 0 ? (
          <>
            <h1>欢迎使用 KMod Launcher</h1>
            <p className="muted">先挑一个主题。以后可以在「设置」里更换，或者自己调色。</p>
            <ThemeGrid themes={themes} current={theme} onPick={pick} />
          </>
        ) : step === 1 ? (
          <>
            <h1>要使用 GitHub 代理吗？</h1>
            <p className="muted">加载器和模组都从 GitHub 下载。直连很慢或经常失败时，选一个代理。</p>
            <div className="choices">
              {option("direct", "不使用代理", "直接连接 GitHub")}
              {GH_PROXIES.map((u) => option(u, u.replace("https://", ""), "公共代理，由第三方运营"))}
              {option("custom", "自定义", "填你自己的代理前缀")}
            </div>
            {choice === "custom" && (
              <input value={custom} placeholder="https://example.com" onChange={(e) => setCustom(e.target.value)} autoCapitalize="off" spellCheck={false} />
            )}
            <p className="muted small">代理前缀加在 GitHub 地址前面。版本列表和模组索引先直连，失败时才经过代理；下载的文件按 SHA-256 校验。</p>
          </>
        ) : (
          <PermissionStep ainfo={ainfo} refresh={refreshAndroid} />
        )}
      </div>
      <div className="guide-foot">
        {step < 2 && <button className="ghost" disabled={busy} onClick={skip}>跳过</button>}
        <span />
        {step > 0 && (
          <button
            disabled={busy}
            onClick={() => {
              setSkipped(false);
              setStep(step - 1);
              pick(theme);
            }}
          >
            上一步
          </button>
        )}
        {step < steps - 1 ? (
          <button className="primary" disabled={step === 1 && badCustom} onClick={() => setStep(step + 1)}>下一步</button>
        ) : (
          <button className="primary" disabled={busy || (!skipped && badCustom) || (android && !granted)} onClick={() => finish(!skipped)}>开始使用</button>
        )}
      </div>
    </div>
  );
}
