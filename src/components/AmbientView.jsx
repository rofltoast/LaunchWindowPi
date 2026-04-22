import { AmbientTerminalLayout } from './AmbientTerminalLayout.jsx';
import { AmbientPolishedLayout } from './AmbientPolishedLayout.jsx';

/**
 * AmbientView — thin router for the ambient ("while-you-wait") mode.
 *
 * Picks the variant based on `layout`, which the parent App drives from
 * the layout picker (Y hotkey; persisted in localStorage under
 * `kiosk-layout`).
 *
 *   - AmbientTerminalLayout — bracketed-box TUI look (the long-standing
 *     default). Every section wrapped in `[ TITLE ]` chrome.
 *
 *   - AmbientPolishedLayout — cinematic broadcast look: big magenta
 *     countdown, GO-FOR-LAUNCH pill, rounded cards, and a rotating
 *     quick-fact card at the bottom.
 */
export function AmbientView({ layout = 'terminal', ...rest }) {
  if (layout === 'polished') {
    return <AmbientPolishedLayout {...rest} />;
  }
  return <AmbientTerminalLayout {...rest} />;
}
