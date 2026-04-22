import { useMemo } from 'react';
import { TrajectoryGraph } from './TrajectoryGraph.jsx';
import { sampleSimAtT } from '../lib/flightclub.js';
import { extractYouTubeId, extractYouTubeStart } from '../lib/ll2.js';
import { CONFIG } from '../lib/config.js';
import { StaleDataBanner } from './StaleDataBanner.jsx';
import { Box } from './Box.jsx';
import {
  WebcastPanel,
  TelemetryRail,
  EventTimelineRail,
} from './LivePolishedLayout.jsx';

/**
 * LiveTerminalLayout — the "terminal" variant of the live view.
 *
 * Shares the same information sources and sub-components as
 * LivePolishedLayout (trajectory, webcast iframe, telemetry, events)
 * but wraps every section in Box (bracketed TUI chrome) and uses a
 * tighter two-column grid. The mission clock is a prominent but
 * monospaced ASCII clock rather than the giant centered banner.
 *
 * The polished layout is the "cinematic" one; this layout is for users
 * who prefer the retro terminal aesthetic the kiosk app has carried
 * since v1. Toggle at runtime with `Y` (picker) or `Shift+Y` (flip).
 */
export function LiveTerminalLayout({
  launch,
  simulation,
  events,
  tMinus,
  isDataStale = false,
  dataAgeMs = null,
  ll2Status = 'ok',
}) {
  const tPlus = tMinus == null ? null : -tMinus;

  const samples = useMemo(() => {
    if (!simulation || tPlus == null || tPlus < 0) return [];
    return sampleSimAtT(simulation, tPlus);
  }, [simulation, tPlus]);

  const primary = useMemo(() => {
    if (!samples.length) return null;
    const s2 = samples.find((s) => s.stage === 2);
    if (s2 && s2.t >= (simulation?.stages?.[1]?.points?.[0]?.t ?? Infinity)) return s2;
    return samples.find((s) => s.stage === 1) || samples[0];
  }, [samples, simulation]);

  const isDemo = CONFIG.FORCE_T_MINUS_S != null || launch?.id === 'test-mock';
  const ytId = extractYouTubeId(launch?.webcast_url);
  const startSeconds = useMemo(() => {
    const forced = CONFIG.FORCE_WEBCAST_START;
    if (forced) {
      const parsed = extractYouTubeStart(`https://x.example/?t=${encodeURIComponent(forced)}`);
      if (parsed != null) return parsed;
    }
    return extractYouTubeStart(launch?.webcast_url);
  }, [launch?.webcast_url]);

  // Monospaced T+/- clock string — terminal style, no huge banner.
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

  const clockColor =
    phase === 'TERMINAL COUNT' ? 'warn' :
    phase === 'ASCENT' ? 'accent3' :
    phase === 'COMPLETE' ? 'accent2' :
    'accent1';

  return (
    <>
      {isDataStale && (
        <StaleDataBanner dataAgeMs={dataAgeMs} ll2Status={ll2Status} />
      )}

      <div className="live-terminal-grid">
        <Box title="MISSION CLOCK" className="lt-clock">
          <div className={`lt-clock-digits ${clockColor}`}>{clockStr}</div>
          <div className={`lt-clock-phase ${clockColor}`}>{phase}</div>
          <div className="dim lt-clock-mission">
            {(launch?.mission_name || launch?.name || 'UNKNOWN MISSION').toUpperCase()}
            {' · '}
            {(launch?.rocket_name || 'ROCKET').toUpperCase()}
            {' · '}
            {(launch?.pad_name || 'PAD').toUpperCase()}
            {isDemo ? ' · [DEMO]' : ''}
          </div>
        </Box>

        <Box title="TRAJECTORY" className="lt-traj">
          <TrajectoryGraph
            simulation={simulation}
            events={events}
            tPlusSeconds={tPlus}
          />
        </Box>

        <Box title="WEBCAST" className="lt-webcast">
          <WebcastPanel
            ytId={ytId}
            startSeconds={startSeconds}
            isDemo={isDemo}
            launch={launch}
          />
        </Box>

        <Box title="TELEMETRY" className="lt-telem">
          <TelemetryRail primary={primary} samples={samples} tPlus={tPlus} />
        </Box>

        <Box title="EVENTS" className="lt-events">
          <EventTimelineRail events={events} tPlus={tPlus} />
        </Box>
      </div>
    </>
  );
}
