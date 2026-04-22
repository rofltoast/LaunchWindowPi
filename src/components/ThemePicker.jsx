// Terminal-layout palettes. Hard-coded ANSI-ish flat colors tuned for
// boxy TUI chrome + monospace type.
const THEMES = [
  { id: 'tokyo-storm', label: 'tokyo' },
  { id: 'gruvbox', label: 'gruvbox' },
  { id: 'dracula', label: 'dracula' },
  { id: 'nord', label: 'nord' },
  { id: 'matrix', label: 'matrix' },
  { id: 'catppuccin', label: 'catppuccin' },
  { id: 'solarized', label: 'solarized' },
];

// Polished-layout palettes. Hand-tuned for the cinematic dashboard —
// deeper backgrounds, richer gradients, accents that read well against
// photographic hero imagery. Order must match the polishedThemes[]
// array in App.jsx so the 1-6 keybindings map correctly.
const POLISHED_THEMES = [
  { id: 'cosmic-dusk', label: 'cosmic dusk' },
  { id: 'aurora', label: 'aurora' },
  { id: 'ember', label: 'ember' },
  { id: 'midnight-ops', label: 'midnight ops' },
  { id: 'graphite', label: 'graphite' },
  { id: 'sunrise', label: 'sunrise' },
];

export function ThemePicker({
  theme,
  setTheme,
  polishedTheme,
  setPolishedTheme,
  layout,
  visible,
}) {
  const isPolished = layout === 'polished';
  const list = isPolished ? POLISHED_THEMES : THEMES;
  const current = isPolished ? polishedTheme : theme;
  const apply = isPolished ? setPolishedTheme : setTheme;

  return (
    <div className={`theme-picker ${visible ? 'visible' : ''}`}>
      <div className="theme-picker-header dim">
        {isPolished ? 'polished palette' : 'terminal palette'}
      </div>
      {list.map((t, i) => (
        <button
          key={t.id}
          className={`theme-btn ${t.id === current ? 'active' : ''}`}
          onClick={() => apply(t.id)}
          title={`Press ${i + 1}`}
        >
          {i + 1} {t.label}
        </button>
      ))}
    </div>
  );
}
