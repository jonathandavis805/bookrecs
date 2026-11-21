import { useState } from "react";
import {
  applyTheme,
  FONTS,
  loadTheme,
  PALETTE_KEYS,
  PALETTE_LABELS,
  type PaletteKey,
  PRESETS,
  paletteOf,
  randomTheme,
  saveTheme,
  type ThemeSetting,
} from "../theme";
import { IconShuffle } from "./ui/icons";

function ThemeOption({
  id,
  name,
  active,
  onSelect,
}: {
  id: string;
  name: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" className={`theme-option${active ? " active" : ""}`} aria-pressed={active} onClick={onSelect}>
      <span className="theme-swatch" data-theme={id} aria-hidden="true">
        <span className="theme-swatch-card">
          <span className="theme-swatch-text">Aa</span>
          <span className="theme-swatch-accent" />
        </span>
      </span>
      <span className="theme-option-name">{name}</span>
    </button>
  );
}

export default function Appearance() {
  const [theme, setTheme] = useState(loadTheme);

  function update(next: ThemeSetting) {
    setTheme(next);
    applyTheme(next);
    saveTheme(next);
  }

  function setColor(key: PaletteKey, value: string) {
    update({ ...theme, preset: "custom", colors: { ...paletteOf(theme), [key]: value } });
  }

  const custom = theme.preset === "custom";

  return (
    <section className="card">
      <h3 className="section-title">Appearance</h3>

      <div className="theme-grid">
        {PRESETS.map((t) => (
          <ThemeOption
            key={t.id}
            id={t.id}
            name={t.name}
            active={theme.preset === t.id}
            onSelect={() => update({ ...theme, preset: t.id })}
          />
        ))}
        {theme.colors && (
          <ThemeOption
            id="custom"
            name="Custom"
            active={custom}
            onSelect={() => update({ ...theme, preset: "custom" })}
          />
        )}
      </div>

      <div className="theme-actions">
        {!custom && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => update({ ...theme, preset: "custom", colors: paletteOf(theme) })}
          >
            Customize colors
          </button>
        )}
        <button type="button" className="btn-secondary btn-sm" onClick={() => update(randomTheme())}>
          <IconShuffle />
          I'm feeling lucky
        </button>
      </div>

      {custom && theme.colors && (
        <div className="theme-colors">
          {PALETTE_KEYS.map((key) => (
            <label key={key} className="color-field">
              <input type="color" value={theme.colors?.[key]} onChange={(e) => setColor(key, e.target.value)} />
              {PALETTE_LABELS[key]}
            </label>
          ))}
        </div>
      )}

      <h4 className="subsection-title">Font</h4>
      <div className="font-options">
        {FONTS.map((f) => (
          <button
            key={f.id}
            type="button"
            data-font={f.id}
            className={`font-option${theme.font === f.id ? " active" : ""}`}
            aria-pressed={theme.font === f.id}
            onClick={() => update({ ...theme, font: f.id })}
          >
            {f.name}
          </button>
        ))}
      </div>
    </section>
  );
}
