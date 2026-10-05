// The visible way to switch UI themes (Settings and Alt+Shift+T are the others).

import { setTheme, THEMES, useTheme } from "../theme";

export function ThemePicker() {
  const theme = useTheme();
  return (
    <div className="theme-picker" role="group" aria-label="Theme">
      <span className="theme-picker-label" aria-hidden>
        Theme
      </span>
      {THEMES.map((t) => (
        <button key={t.id} type="button" className="theme-opt" aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
          <span className={`theme-swatch t-${t.id}`} aria-hidden />
          {t.label}
        </button>
      ))}
    </div>
  );
}
