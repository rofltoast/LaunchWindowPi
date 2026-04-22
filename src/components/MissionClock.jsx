import { useMemo } from 'react';

/**
 * Mission clock — big, prominent T-minus / T-plus display.
 * Shows:
 *   - Huge current clock (T-00:02:34 before, T+00:01:22 after)
 *   - Smaller "liftoff at" absolute time
 *   - Phase indicator (terminal count / in flight / complete / hold)
 */
export function MissionClock({ tMinus, launch, nextEvent }) {
  const tPlus = tMinus == null ? null : -tMinus;
  const hasLaunched = tPlus != null && tPlus >= 0;
  const inTerminalCount = tMinus != null && tMinus > 0 && tMinus <= 600;

  const clockStr = useMemo(() => {
    if (tMinus == null) return 'T-00:00:00';
    const isCount = tMinus > 0;
    const abs = Math.abs(tMinus);
    const h = String(Math.floor(abs / 3600)).padStart(2, '0');
    const m = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
    const s = String(Math.floor(abs % 60)).padStart(2, '0');
    return `T${isCount ? '-' : '+'}${h}:${m}:${s}`;
  }, [tMinus]);

  const phase = useMemo(() => {
    if (tMinus == null) return 'STANDBY';
    if (tMinus > 600) return 'PRELAUNCH';
    if (tMinus > 0) return 'TERMINAL COUNT';
    if (tPlus < 600) return 'ASCENT';
    if (tPlus < 3600) return 'IN FLIGHT';
    return 'COMPLETE';
  }, [tMinus, tPlus]);

  const liftoffStr = launch?.net
    ? new Date(launch.net).toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }) + ' PDT'
    : '--:--:--';

  // Color varies by phase
  const clockColor = hasLaunched
    ? 'var(--accent3)'         // green — in flight
    : inTerminalCount
      ? 'var(--warn)'          // warn color — under 10 min
      : 'var(--accent1)';      // normal accent — counting down

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      gap: 16,
      alignItems: 'center',
      padding: '4px 6px',
    }}>
      <div>
        <div className="dim" style={{ fontSize: 9, letterSpacing: 2 }}>MISSION CLOCK</div>
        <div style={{
          fontSize: 'clamp(22px, 3.5vw, 48px)',
          fontWeight: 500,
          lineHeight: 1,
          color: clockColor,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0.5,
        }}>
          {clockStr}
          {(inTerminalCount || hasLaunched) && <span className="blink" style={{ marginLeft: 4 }}>█</span>}
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <div className="dim" style={{ fontSize: 9, letterSpacing: 2 }}>PHASE</div>
        <div className={
          phase === 'TERMINAL COUNT' ? 'warn pulse'
          : phase === 'ASCENT' ? 'accent3 pulse'
          : 'accent2'
        } style={{ fontSize: 'clamp(14px, 1.6vw, 22px)', fontWeight: 500, letterSpacing: 1 }}>
          {phase}
        </div>
      </div>

      <div style={{ textAlign: 'right' }}>
        <div className="dim" style={{ fontSize: 9, letterSpacing: 2 }}>
          {hasLaunched ? 'LIFTOFF WAS' : 'LIFTOFF AT'}
        </div>
        <div style={{ fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
          {liftoffStr}
        </div>
        {nextEvent && (
          <div style={{ fontSize: 10, marginTop: 2 }}>
            <span className="dim">next: </span>
            <span className="accent1">{nextEvent.label}</span>
          </div>
        )}
      </div>
    </div>
  );
}
