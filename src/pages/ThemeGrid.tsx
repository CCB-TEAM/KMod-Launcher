import type { Theme } from "../themes";

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

/** The theme cards (settings page and first-start guide). */
export default function ThemeGrid({ themes, current, disabled, onPick }: { themes: Theme[]; current: string; disabled?: boolean; onPick: (id: string) => void }) {
  return (
    <div className="themes">
      {themes.map((t) => (
        <button key={t.id} className={t.id === current && !disabled ? "tcard on" : "tcard"} onClick={() => onPick(t.id)} disabled={disabled}>
          <Preview t={t} />
          <div className="tname">
            <span>{t.name}</span>
            {!t.builtin && <span className="chip">自定义</span>}
          </div>
        </button>
      ))}
    </div>
  );
}
