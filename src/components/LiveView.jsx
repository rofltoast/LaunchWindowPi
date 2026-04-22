import { LivePolishedLayout } from './LivePolishedLayout.jsx';
import { LiveTerminalLayout } from './LiveTerminalLayout.jsx';

/**
 * LiveView — thin router for the live mode.
 *
 * Picks which presentation to render based on the `layout` prop, which
 * is driven by the layout picker in App.jsx (Y hotkey, localStorage
 * under `kiosk-layout`). The actual rendering happens in:
 *
 *   - LivePolishedLayout — cinematic broadcast view (v30+). Top-band
 *     mission clock, large trajectory hero, compact telemetry / events
 *     rails along the bottom. Minimal TUI chrome.
 *
 *   - LiveTerminalLayout  — retro TUI view. Every section boxed with
 *     bracket headers (`[ TELEMETRY ]`), monospaced clock, same data
 *     sources but a different visual treatment.
 *
 * Both layouts share the same props and the same internal sub-
 * components (WebcastPanel, TelemetryRail, EventTimelineRail), so the
 * split is purely presentational — no data-fetching duplication.
 */
export function LiveView({ layout = 'terminal', ...rest }) {
  if (layout === 'polished') {
    return <LivePolishedLayout {...rest} />;
  }
  return <LiveTerminalLayout {...rest} />;
}
