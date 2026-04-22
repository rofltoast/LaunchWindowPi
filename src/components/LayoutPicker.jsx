/**
 * LayoutPicker — minimal floating control for switching between the
 * two presentation styles the kiosk supports:
 *
 *   - terminal : the original TUI aesthetic (bracketed panels,
 *                monospace-forward, retro mission-console vibe)
 *   - polished : the cinematic broadcast aesthetic (rounded cards,
 *                large hero sections, refined typography)
 *
 * Both layouts share the same information architecture and data; only
 * presentation differs. The picker lives next to the ThemePicker but
 * is a separate control — users can mix freely (e.g. "terminal layout
 * + nord theme").
 *
 * Keyboard UX (wired in App.jsx):
 *   - Y       → toggle picker visibility
 *   - Shift+Y → cycle to the other layout directly, without opening
 *               the picker (fast power-user flip)
 *
 * Persistence: handled by App.jsx writing to localStorage under
 * `kiosk-layout` whenever the layout changes.
 */
const LAYOUTS = [
  { id: 'terminal', label: 'terminal', hint: 'TUI / retro' },
  { id: 'polished', label: 'polished', hint: 'cinematic' },
];

export function LayoutPicker({ layout, setLayout, visible }) {
  return (
    <div
      className={`layout-picker ${visible ? 'visible' : ''}`}
      aria-label="layout picker"
    >
      <span
        className="dim"
        style={{
          fontSize: 'clamp(9px, 0.6vw + 3px, 11px)',
          letterSpacing: 1.5,
          marginRight: 4,
          padding: '0 4px',
        }}
      >
        LAYOUT
      </span>
      {LAYOUTS.map((l) => (
        <button
          key={l.id}
          type="button"
          className={`theme-btn ${l.id === layout ? 'active' : ''}`}
          onClick={() => setLayout(l.id)}
          title={`${l.label} — ${l.hint}`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

export const LAYOUT_IDS = LAYOUTS.map((l) => l.id);
