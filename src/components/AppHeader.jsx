export function AppHeader({ now, mode, nextLaunch }) {
  const date = new Date(now);
  const dateStr = date
    .toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'America/Los_Angeles' })
    .replace(/,/g, '').replace(/ /g, '-').toUpperCase();
  const timeStr = date.toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/Los_Angeles' });

  return (
    <header className="app-header">
      <div>
        <span className="accent1">◆</span>{' '}
        <span className="accent2">vsfb-launch-monitor</span>{' '}
        <span className="dim">v0.1.0</span>{' '}
        <span className="dim">mode: {mode}</span>
      </div>
      <div className="dim">{dateStr} {timeStr} PDT</div>
    </header>
  );
}
