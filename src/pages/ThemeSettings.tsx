import { useState } from "react";
import { errText } from "../api";
import { useToast } from "../toast";
import type { Shared } from "../App";
import {
  COLOR_KEYS,
  COLOR_LABELS,
  DEFAULT_THEME_ID,
  allThemes,
  applyTheme,
  exportTheme,
  parseTheme,
  type Theme,
} from "../themes";

function Preview({ t }: { t: Theme }) {
  const c = t.colors;
  return (
    <div className="tprev" style={{ background: c.bg, borderRadius: t.radius }}>
      <i style={{ background: c.glow1, width: 46, height: 46, right: -8, top: -14 }} />
      <i style={{ background: c.glow2, width: 40, height: 40, right: 20, bottom: -20 }} />
      <i style={{ background: c.glow3, width: 36, height: 36, left: -10, bottom: -16 }} />
      <b style={{ background: c.accent }} />
      <em style={{ background: c.btn }} />
    </div>
  );
}

export default function ThemeSettings({ config, setConfig }: Pick<Shared, "config" | "setConfig">) {
  const toast = useToast();
  const themes = allThemes(config.custom_themes);
  const current = themes.find((t) => t.id === config.theme) ?? themes[0];
  const [draft, setDraft] = useState<Theme | null>(null);
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState("");

  const customs = () => config.custom_themes.map(parseTheme).filter((t): t is Theme => !!t);
  const store = async (list: Theme[], theme: string) => {
    const clean = list.map(({ builtin: _b, ...t }) => t);
    await setConfig({ ...config, custom_themes: clean, theme });
  };

  const choose = async (id: string) => {
    try {
      await setConfig({ ...config, theme: id });
    } catch (e) {
      toast("err", errText(e));
    }
  };

  const startEdit = (t: Theme, asNew: boolean) => {
    const d: Theme = {
      ...t,
      builtin: undefined,
      id: asNew || t.builtin ? `custom-${Date.now()}` : t.id,
      name: asNew || t.builtin ? `${t.name} 副本` : t.name,
      colors: { ...t.colors },
    };
    setDraft(d);
    applyTheme(d);
  };
  const update = (patch: Partial<Theme>) => {
    if (!draft) return;
    const d = { ...draft, ...patch };
    setDraft(d);
    applyTheme(d);
  };
  const cancel = () => {
    setDraft(null);
    applyTheme(current);
  };
  const save = async () => {
    if (!draft) return;
    try {
      const d = parseTheme(draft);
      if (!d) throw new Error("主题需要一个名字");
      const rest = customs().filter((t) => t.id !== d.id);
      await store([...rest, d], d.id);
      setDraft(null);
      toast("ok", "主题已保存");
    } catch (e) {
      toast("err", errText(e));
    }
  };
  const remove = async (t: Theme) => {
    if (!confirm(`删除主题“${t.name}”？`)) return;
    await store(customs().filter((x) => x.id !== t.id), t.id === config.theme ? DEFAULT_THEME_ID : config.theme);
  };
  const copy = async (t: Theme) => {
    try {
      await navigator.clipboard.writeText(exportTheme(t));
      toast("ok", "主题 JSON 已复制");
    } catch (e) {
      toast("err", errText(e));
    }
  };
  const doImport = async () => {
    try {
      const t = parseTheme(JSON.parse(text));
      if (!t) throw new Error("不是有效的主题（至少要有 name）");
      t.id = `custom-${Date.now()}`;
      await store([...customs(), t], t.id);
      setImporting(false);
      setText("");
      toast("ok", `已导入 ${t.name}`);
    } catch (e) {
      toast("err", errText(e));
    }
  };

  return (
    <section className="card">
      <div className="between">
        <h2>主题</h2>
        <div className="row">
          <button onClick={() => startEdit(current, true)} disabled={!!draft}>新建主题</button>
          <button onClick={() => setImporting((v) => !v)}>导入</button>
        </div>
      </div>

      {importing && (
        <div style={{ marginBottom: 12 }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="粘贴主题 JSON" />
          <div className="row">
            <button className="primary" onClick={doImport} disabled={!text.trim()}>导入</button>
          </div>
        </div>
      )}

      <div className="themes">
        {themes.map((t) => (
          <button key={t.id} className={t.id === current.id && !draft ? "tcard on" : "tcard"} onClick={() => choose(t.id)} disabled={!!draft}>
            <Preview t={t} />
            <div className="tname">
              <span>{t.name}</span>
              {!t.builtin && <span className="chip">自定义</span>}
            </div>
          </button>
        ))}
      </div>

      {!draft && (
        <div className="row">
          <button onClick={() => startEdit(current, false)}>{current.builtin ? "以此为基础编辑" : "编辑当前主题"}</button>
          <button onClick={() => copy(current)}>复制 JSON</button>
          {!current.builtin && <button className="danger" onClick={() => remove(current)}>删除</button>}
        </div>
      )}

      {draft && (
        <>
          <div className="row">
            <input value={draft.name} maxLength={24} onChange={(e) => update({ name: e.target.value })} placeholder="主题名称" />
            <div className="seg">
              <button className={draft.mode === "dark" ? "on" : ""} onClick={() => update({ mode: "dark" })}>深色</button>
              <button className={draft.mode === "light" ? "on" : ""} onClick={() => update({ mode: "light" })}>浅色</button>
            </div>
          </div>
          <div className="editor">
            {COLOR_KEYS.map((k) => (
              <label key={k}>
                {COLOR_LABELS[k]}
                <input type="color" value={draft.colors[k]} onChange={(e) => update({ colors: { ...draft.colors, [k]: e.target.value } })} />
              </label>
            ))}
            <label>
              圆角 {draft.radius}px
              <input type="range" min={0} max={20} value={draft.radius} onChange={(e) => update({ radius: Number(e.target.value) })} />
            </label>
          </div>
          <div className="row">
            <button className="primary" onClick={save}>保存主题</button>
            <button onClick={cancel}>取消</button>
          </div>
        </>
      )}
    </section>
  );
}
