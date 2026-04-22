import { useEffect, useMemo, useRef, useState } from 'react';
import { TrajectoryGraph } from './TrajectoryGraph.jsx';
import { sampleSimAtT } from '../lib/flightclub.js';
import { extractYouTubeId, extractYouTubeStart } from '../lib/ll2.js';
import { CONFIG } from '../lib/config.js';
import { StaleDataBanner } from './StaleDataBanner.jsx';

/**
 * LivePolishedLayout — cinematic broadcast presentation of the live
 * view. This is the "polished" variant of the layout switcher — the
 * terminal variant is LiveTerminalLayout.jsx, which shares the same
 * information architecture but uses TUI Box chrome and brackets.
 *
 * Three-band structure, per the v30 spec:
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │  TOP BAR  ·  clock · phase · next event · mission     │  ~auto
 *   │  STATUS RIBBON  ·  [LIVE] current event (thin)        │  ~auto
 *   ├─────────────────────────────────┬──────────────────────┤
 *   │                                 │  webcast             │
 *   │  trajectory (hero)              ├──────────────────────┤
 *   │                                 │  landing             │  1fr + auto
 *   ├─────────────────────────────────┴──────────────────────┤
 *   │  TELEMETRY RAIL · alt / vel / dwr / q / stage         │  auto
 *   │  EVENTS RAIL    · liftoff • max-q • meco • sep → …    │  auto
 *   └────────────────────────────────────────────────────────┘
 *
 * Design principles driving this layout (see vsfb_live_redesign.txt):
 *   1. The mission clock is the single most important thing on screen.
 *      It's promoted out of a side-box and into a full-width top band,
 *      at ~2× the previous font size, with phase-based color coding.
 *   2. Telemetry + events become compact horizontal rails rather than
 *      large boxed panels. Frees most of the screen for the two motion
 *      elements (trajectory + webcast) where the viewer actually looks.
 *   3. Less TUI chrome in live mode — no .box header borders for the
 *      hero elements. The webcast label moves INSIDE the video frame
 *      as a small overlay so the surrounding frame is pure video.
 *   4. A transient event banner fades in over the UI (without shifting
 *      layout) for major milestones — LIFTOFF / MAX-Q / MECO / SEP.
 */
export function LivePolishedLayout({
  launch,
  simulation,
  events,
  tMinus,
  isDataStale = false,
  dataAgeMs = null,
  ll2Status = 'ok',
}) {
  // T+ seconds from liftoff (positive = after liftoff)
  const tPlus = tMinus == null ? null : -tMinus;

  // Sample the simulation at the current moment to get live readouts
  const samples = useMemo(() => {
    if (!simulation || tPlus == null || tPlus < 0) return [];
    return sampleSimAtT(simulation, tPlus);
  }, [simulation, tPlus]);

  // Pick the "primary" telemetry source — stage 2 if it's past its first point,
  // else stage 1. This matches what the webcast typically shows.
  const primary = useMemo(() => {
    if (!samples.length) return null;
    const s2 = samples.find((s) => s.stage === 2);
    if (s2 && s2.t >= (simulation?.stages?.[1]?.points?.[0]?.t ?? Infinity)) return s2;
    return samples.find((s) => s.stage === 1) || samples[0];
  }, [samples, simulation]);

  // Demo mode (URL ?forceT=... or ?mode=live without a real launch).
  const isDemo = CONFIG.FORCE_T_MINUS_S != null || launch?.id === 'test-mock';
  const ytId = extractYouTubeId(launch?.webcast_url);

  // Webcast start offset (seconds). Re-uses extractYouTubeStart() so every
  // accepted shape (bare int, `1819s`, `30m19s`, `1h2m3s`) goes through the
  // same parser.
  const startSeconds = useMemo(() => {
    const forced = CONFIG.FORCE_WEBCAST_START;
    if (forced) {
      const parsed = extractYouTubeStart(`https://x.example/?t=${encodeURIComponent(forced)}`);
      if (parsed != null) return parsed;
    }
    return extractYouTubeStart(launch?.webcast_url);
  }, [launch?.webcast_url]);

  // Next scheduled event (first event whose T is still in the future)
  const nextEvent = useMemo(() => {
    if (!events || tPlus == null) return null;
    return events.find((e) => e.t > tPlus) || null;
  }, [events, tPlus]);

  return (
    <>
      {/* Stale-data banner — renders above the live grid so it's visible
          in every viewport (portrait + landscape alike). We intentionally
          let it take its own row above the grid rather than cramming it
          inside a grid cell; the live layout is already dense, and the
          warning is meant to be unmissable. */}
      {isDataStale && (
        <StaleDataBanner dataAgeMs={dataAgeMs} ll2Status={ll2Status} />
      )}

      {/* Transient full-screen event banner ("LIFTOFF", "MAX-Q", etc.) —
          fades in/out for major milestones. Fixed-position so it never
          reflows the layout. */}
      <TransientEventBanner events={events} tPlus={tPlus} />

      <div className="live-grid-v2">
        <div className="live-v2-topbar">
          <LiveTopBar
            launch={launch}
            tMinus={tMinus}
            tPlus={tPlus}
            nextEvent={nextEvent}
            isDemo={isDemo}
          />
        </div>

        <div className="live-v2-ribbon">
          <LiveStatusRibbon events={events} tPlus={tPlus} />
        </div>

        <div className="live-v2-trajectory">
          <TrajectoryGraph
            simulation={simulation}
            events={events}
            tPlusSeconds={tPlus}
          />
        </div>

        <div className="live-v2-webcast">
          <WebcastPanel
            ytId={ytId}
            startSeconds={startSeconds}
            isDemo={isDemo}
            launch={launch}
          />
        </div>

        <div className="live-v2-landing">
          <LandingTargetStrip launch={launch} events={events} tPlus={tPlus} />
          <RtlsSonicBoomWarning launch={launch} events={events} tPlus={tPlus} />
        </div>

        <div className="live-v2-telemetry-rail">
          <TelemetryRail primary={primary} samples={samples} tPlus={tPlus} />
        </div>

        <div className="live-v2-events-rail">
          <EventTimelineRail events={events} tPlus={tPlus} />
        </div>
      </div>
    </>
  );
}

/* ============================================================================
 * TOP BAR — the new single-most-important element.
 *
 * Full-width three-column grid:
 *   LEFT:   mission header  (rocket · pad · provider)
 *   CENTER: BIG mission clock + phase label below
 *   RIGHT:  NEXT EVENT (label + countdown) or "LIFTOFF AT <time>" pre-flight
 *
 * Mission clock color varies by phase:
 *   - Prelaunch (T-10m+)         → accent1  (normal)
 *   - Terminal count (T-10m..0)  → warn     (urgent)
 *   - Ascent (T+0..T+10m)        → accent3  (green, actively flying)
 *   - Post-ascent / complete     → accent2  (calm)
 * ========================================================================== */
function LiveTopBar({ launch, tMinus, tPlus, nextEvent, isDemo }) {
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

  // Color token for the giant clock. Kept in CSS var form so theme swaps
  // flow through. Blink cursor for the two "active" phases so there's
  // motion even when the clock hasn't ticked yet.
  const clockColor = hasLaunched
    ? (tPlus < 600 ? 'var(--accent3)' : 'var(--accent2)')
    : inTerminalCount
      ? 'var(--warn)'
      : 'var(--accent1)';
  const clockBlink = inTerminalCount || (hasLaunched && tPlus < 600);

  // Phase label color/class. Terminal count + ascent pulse to signal "active".
  const phaseCls =
    phase === 'TERMINAL COUNT' ? 'warn pulse' :
    phase === 'ASCENT' ? 'accent3 pulse' :
    phase === 'PRELAUNCH' ? 'accent1' :
    phase === 'IN FLIGHT' ? 'accent3' : 'accent2';

  // Liftoff absolute time (for the right column when there's no nextEvent).
  const liftoffStr = launch?.net
    ? new Date(launch.net).toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }) + ' PDT'
    : '--:--:--';

  // Countdown to the next event.
  const nextEventDelta = nextEvent && tPlus != null ? nextEvent.t - tPlus : null;
  const nextEventStr = formatDelta(nextEventDelta);

  // Mission header text — rocket · pad · provider (dimmer), plus mission name.
  const missionName = (launch?.mission_name || launch?.name || 'UNKNOWN MISSION').toUpperCase();
  const subline = [launch?.rocket_name, launch?.pad_name, launch?.provider_name]
    .filter(Boolean).map((s) => s.toLowerCase()).join(' · ');

  return (
    <div
      className="live-v2-topbar-inner"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        gap: 'clamp(12px, 1.2vw, 28px)',
        alignItems: 'center',
        padding: 'clamp(8px, 1vw, 14px) clamp(12px, 1.4vw, 20px)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005))',
        borderBottom: '1px solid var(--border)',
        borderRadius: 3,
      }}
    >
      {/* LEFT: mission info */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 'clamp(12px, 0.9vw + 4px, 18px)',
          color: 'var(--accent2)',
          fontWeight: 600,
          letterSpacing: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {isDemo && <span className="dim" style={{ marginRight: 8 }}>[DEMO]</span>}
          {missionName}
        </div>
        <div className="dim" style={{
          marginTop: 3,
          fontSize: 'clamp(9px, 0.5vw + 4px, 12px)',
          letterSpacing: 0.5,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {subline}
        </div>
      </div>

      {/* CENTER: the hero clock + phase */}
      <div style={{ textAlign: 'center', minWidth: 0 }}>
        <div
          style={{
            fontSize: 'clamp(34px, 5.5vw, 72px)',
            fontWeight: 500,
            lineHeight: 1,
            color: clockColor,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: 1,
            textShadow: hasLaunched || inTerminalCount
              ? '0 0 24px currentColor'
              : 'none',
            transition: 'color 400ms ease, text-shadow 400ms ease',
          }}
        >
          {clockStr}
          {clockBlink && <span className="blink" style={{ marginLeft: 6 }}>█</span>}
        </div>
        <div
          className={phaseCls}
          style={{
            marginTop: 6,
            fontSize: 'clamp(11px, 0.8vw + 4px, 16px)',
            letterSpacing: 3,
            fontWeight: 600,
          }}
        >
          {phase}
        </div>
      </div>

      {/* RIGHT: next event (or pre-flight liftoff time fallback) */}
      <div style={{ textAlign: 'right', minWidth: 0 }}>
        {nextEvent ? (
          <>
            <div className="dim" style={{ fontSize: 'clamp(9px, 0.5vw + 4px, 11px)', letterSpacing: 2 }}>
              NEXT EVENT
            </div>
            <div
              className="accent1"
              style={{
                fontSize: 'clamp(16px, 1.6vw + 2px, 28px)',
                fontWeight: 600,
                letterSpacing: 0.5,
                lineHeight: 1.15,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {nextEvent.label.toUpperCase()}
            </div>
            <div
              style={{
                fontSize: 'clamp(14px, 1vw + 4px, 20px)',
                fontVariantNumeric: 'tabular-nums',
                marginTop: 2,
              }}
            >
              {nextEventStr}
            </div>
          </>
        ) : (
          <>
            <div className="dim" style={{ fontSize: 'clamp(9px, 0.5vw + 4px, 11px)', letterSpacing: 2 }}>
              {hasLaunched ? 'LIFTOFF WAS' : 'LIFTOFF AT'}
            </div>
            <div style={{
              fontSize: 'clamp(16px, 1.4vw + 4px, 24px)',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 500,
            }}>
              {liftoffStr}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Format a delta (in seconds, can be negative for "just happened") as
 * "MM:SS" or "HH:MM:SS" for longer spans. Used in the NEXT EVENT panel.
 */
function formatDelta(dt) {
  if (dt == null || !Number.isFinite(dt)) return '--:--';
  const sign = dt < 0 ? '-' : '';
  const abs = Math.abs(Math.floor(dt));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  if (h > 0) return `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* ============================================================================
 * STATUS RIBBON — thin "[LIVE] CURRENT EVENT" band under the top bar.
 *
 * Only rendered when an event has just happened within the last ~30s.
 * Between events the ribbon collapses to 0 height (returns null) so it
 * doesn't eat screen space with no information.
 * ========================================================================== */
function LiveStatusRibbon({ events, tPlus }) {
  if (!events || tPlus == null || tPlus < 0) return null;

  // Walk backwards through events to find the most recent one whose T has
  // passed within the last 30 seconds.
  let recent = null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev.t <= tPlus && tPlus - ev.t <= 30) { recent = ev; break; }
    if (ev.t <= tPlus) break; // further back is older than 30s, stop
  }
  if (!recent) return null;

  const ageSec = Math.floor(tPlus - recent.t);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'clamp(8px, 1vw, 14px)',
        padding: 'clamp(4px, 0.5vw, 7px) clamp(12px, 1.2vw, 18px)',
        background: 'rgba(62, 207, 107, 0.12)',
        borderTop: '1px solid rgba(62, 207, 107, 0.35)',
        borderBottom: '1px solid rgba(62, 207, 107, 0.35)',
      }}
    >
      <span
        className="blink"
        style={{
          background: '#3ecf6b',
          color: '#000',
          fontWeight: 800,
          padding: '2px 8px',
          letterSpacing: 2,
          fontSize: 'clamp(9px, 0.5vw + 4px, 11px)',
          borderRadius: 2,
        }}
      >
        ● LIVE
      </span>
      <span
        style={{
          color: '#3ecf6b',
          fontWeight: 700,
          letterSpacing: 1.5,
          fontSize: 'clamp(11px, 0.8vw + 4px, 15px)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {recent.label.toUpperCase()}
      </span>
      <span className="dim" style={{ fontSize: 'clamp(9px, 0.5vw + 4px, 11px)', marginLeft: 'auto' }}>
        T+{ageSec}s
      </span>
    </div>
  );
}

/* ============================================================================
 * WEBCAST PANEL — renders the YouTube iframe (or a placeholder) with a
 * small "LIVE" / "DEMO" badge overlaid inside the video frame, per the
 * v30 brief ("move label INSIDE video frame"). No Box chrome — just the
 * video surface. Delay note + mission caption live below the iframe.
 *
 * Mute/unmute hotkey (M):
 *   The iframe loads muted by default because Chromium + mobile Safari
 *   both block unmuted autoplay without a user gesture. We wire up a
 *   global keydown listener that toggles the YouTube player's mute
 *   state via the IFrame Player API (postMessage — no script tag
 *   needed, just `enablejsapi=1` in the URL). `M` is the same mute
 *   shortcut YouTube itself uses, so it's instantly learnable.
 *
 *   The hotkey hint lives in the top-right corner of the video frame
 *   (balancing the LIVE/DEMO badge in the top-left), and updates its
 *   text live as mute state changes.
 * ========================================================================== */
export function WebcastPanel({ ytId, startSeconds, isDemo, launch }) {
  const iframeRef = useRef(null);
  const [muted, setMuted] = useState(true);

  // Keyboard mute-toggle listener. Only active when we actually have a
  // YouTube iframe loaded (ytId present). Ignores M when focus is in a
  // text input so an unseen form field doesn't swallow the hotkey.
  useEffect(() => {
    if (!ytId) return undefined;
    const onKey = (e) => {
      if (e.key !== 'm' && e.key !== 'M') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // allow Cmd+M etc.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const iframe = iframeRef.current;
      if (!iframe || !iframe.contentWindow) return;
      e.preventDefault();
      // Post a command to the YouTube IFrame Player API. Works as long as
      // `enablejsapi=1` is in the iframe URL (added below).
      const nextMuted = !muted;
      iframe.contentWindow.postMessage(
        JSON.stringify({
          event: 'command',
          func: nextMuted ? 'mute' : 'unMute',
          args: '',
        }),
        '*',
      );
      // Also bump the volume explicitly the first time we unmute — some
      // YouTube clients remember a 0% volume from a previous session.
      if (!nextMuted) {
        iframe.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: 'setVolume',
            args: [80],
          }),
          '*',
        );
      }
      setMuted(nextMuted);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ytId, muted]);

  const liveBadge = (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        zIndex: 2,
        padding: '2px 8px',
        background: 'rgba(0,0,0,0.72)',
        color: isDemo ? 'var(--accent2)' : '#3ecf6b',
        fontWeight: 700,
        letterSpacing: 2,
        fontSize: 'clamp(9px, 0.5vw + 4px, 11px)',
        borderRadius: 2,
        border: '1px solid rgba(255,255,255,0.18)',
        textShadow: 'none',
        pointerEvents: 'none',
      }}
    >
      {isDemo ? '● DEMO' : '● LIVE'}
    </div>
  );

  const muteHint = (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 2,
        padding: '2px 8px',
        background: 'rgba(0,0,0,0.72)',
        color: muted ? 'var(--accent1)' : '#3ecf6b',
        fontWeight: 600,
        letterSpacing: 1.2,
        fontSize: 'clamp(9px, 0.5vw + 4px, 11px)',
        borderRadius: 2,
        border: `1px solid ${muted ? 'rgba(232, 169, 56, 0.45)' : 'rgba(62, 207, 107, 0.45)'}`,
        textShadow: 'none',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        transition: 'color 200ms ease, border-color 200ms ease',
      }}
      aria-live="polite"
    >
      <span style={{ fontSize: '1.1em', lineHeight: 1 }}>
        {muted ? '🔇' : '🔊'}
      </span>
      <span>
        press&nbsp;
        <kbd
          style={{
            display: 'inline-block',
            padding: '0 5px',
            fontFamily: 'inherit',
            fontSize: '0.95em',
            fontWeight: 800,
            color: '#000',
            background: muted ? 'var(--accent1)' : '#3ecf6b',
            borderRadius: 2,
            letterSpacing: 0,
          }}
        >
          M
        </kbd>
        &nbsp;to {muted ? 'unmute' : 'mute'}
      </span>
    </div>
  );

  if (!ytId) {
    return (
      <>
        <div
          style={{
            aspectRatio: '16/9',
            background: '#000',
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--dim)',
            fontSize: 'clamp(10px, 0.6vw + 4px, 13px)',
            letterSpacing: 1,
            position: 'relative',
          }}
        >
          {liveBadge}
          webcast not yet available<span className="blink"> █</span>
        </div>
        <MissionCaption launch={launch} />
      </>
    );
  }

  return (
    <>
      <div
        style={{
          aspectRatio: '16/9',
          background: '#000',
          borderRadius: 3,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {liveBadge}
        {muteHint}
        <iframe
          ref={iframeRef}
          src={(() => {
            // `enablejsapi=1` lets us send postMessage commands to the player
            // (mute/unMute/setVolume). `origin=` is required for the API to
            // accept commands cross-origin — we pass window.location.origin
            // at render time so tunnel + localhost + production all match.
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            let url = `https://www.youtube.com/embed/${ytId}` +
              `?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&playsinline=1` +
              `&enablejsapi=1`;
            if (origin) url += `&origin=${encodeURIComponent(origin)}`;
            if (startSeconds != null && startSeconds > 0) {
              url += `&start=${startSeconds}`;
            }
            if (typeof window !== 'undefined' && window.console) {
              // eslint-disable-next-line no-console
              console.log('[webcast]', { isDemo, ytId, startSeconds, src: url });
            }
            return url;
          })()}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          style={{ width: '100%', height: '100%', border: 0 }}
          title={isDemo ? 'demo webcast' : 'live webcast'}
        />
      </div>
      {!isDemo && <WebcastDelayNote />}
      <MissionCaption launch={launch} />
    </>
  );
}

/**
 * Small italic caption shown beneath a real (non-demo) live webcast,
 * explaining the ~20s delay inherent to YouTube livestreams. Mission
 * clock is the accurate reference — this note tells viewers the video
 * lag isn't a clock bug.
 */
function WebcastDelayNote() {
  return (
    <div
      className="dim"
      style={{
        marginTop: 6,
        fontSize: 'clamp(9px, 0.55vw + 3px, 11px)',
        letterSpacing: 0.5,
        textAlign: 'center',
        fontStyle: 'italic',
        opacity: 0.75,
      }}
    >
      YouTube live · ~20s delay behind T-clock
    </div>
  );
}

/**
 * Mission caption — compact label directly under the webcast iframe.
 * Shows the payload name + a short mission blurb so a viewer walking up
 * to the kiosk knows WHAT is launching, not just that a livestream is
 * on screen.
 */
function MissionCaption({ launch }) {
  if (!launch) return null;
  const rawName = launch.mission_name || launch.name || '';
  const pipeIdx = rawName.indexOf('|');
  const payload = pipeIdx >= 0 ? rawName.slice(pipeIdx + 1).trim() : rawName.trim();

  const desc = String(launch.mission_description || '').trim();
  const shortDesc = (() => {
    if (!desc) return '';
    const sentenceEnd = desc.search(/[.!?](?:\s|$)/);
    const first = sentenceEnd > 20 ? desc.slice(0, sentenceEnd + 1) : desc;
    if (first.length <= 180) return first;
    return first.slice(0, 177).trimEnd() + '…';
  })();

  if (!payload && !shortDesc) return null;

  return (
    <div
      style={{
        marginTop: 8,
        padding: '6px 2px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      {payload && (
        <div
          style={{
            fontSize: 'clamp(11px, 0.7vw + 4px, 14px)',
            fontWeight: 600,
            color: 'var(--accent1)',
            letterSpacing: 0.3,
            lineHeight: 1.25,
          }}
        >
          {payload}
        </div>
      )}
      {shortDesc && (
        <div
          className="dim"
          style={{
            fontSize: 'clamp(10px, 0.55vw + 4px, 12px)',
            lineHeight: 1.35,
          }}
        >
          {shortDesc}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * TELEMETRY RAIL — horizontal compact telemetry row along the bottom.
 *
 * Replaces the old vertical TelemetryPanel. Each stat is rendered as a
 * centered label+value stack; the row flexes to fill the bottom band.
 * Units are kept small next to the numbers (not on a separate line) so
 * the row reads at a glance from across the room.
 * ========================================================================== */
export function TelemetryRail({ primary, samples, tPlus }) {
  if (!primary) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'clamp(6px, 0.8vw, 12px) 8px',
          fontSize: 'clamp(11px, 0.7vw + 4px, 14px)',
        }}
        className="dim"
      >
        {tPlus != null && tPlus < 0
          ? <>awaiting liftoff<span className="blink"> █</span></>
          : <>loading sim data<span className="blink"> █</span></>}
      </div>
    );
  }

  const KM_TO_MI = 0.621371;
  const altMi = primary.alt * KM_TO_MI;
  const drMi  = primary.dr  * KM_TO_MI;
  const velMph = primary.vel * 2.23694;  // m/s → mph

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        gap: 'clamp(8px, 1.2vw, 24px)',
        padding: 'clamp(6px, 0.8vw, 12px) clamp(10px, 1vw, 18px)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.03))',
        border: '1px solid var(--border)',
        borderRadius: 3,
      }}
    >
      <Stat label="ALT"   value={altMi.toFixed(1)}                   unit="mi"  color="var(--accent1)" />
      <Stat label="VEL"   value={Math.round(velMph).toLocaleString()} unit="mph" color="var(--accent2)" />
      <Stat label="DWR"   value={Math.round(drMi).toLocaleString()}   unit="mi"  color="var(--accent3)" />
      {primary.q > 0 && (
        <Stat label="Q"   value={Math.round(primary.q).toLocaleString()} unit="Pa" color="var(--accent4)" />
      )}
      <Stat label="STAGE" value={`S${primary.stage}`} unit="" color="var(--fg)" />
      <Stat
        label="STATUS"
        value="NOMINAL"
        unit=""
        color="var(--accent3)"
      />
      {samples.length > 1 && (
        <Stat label="MODE" value="DUAL-STAGE" unit="" color="var(--accent2)" small />
      )}
    </div>
  );
}

function Stat({ label, value, unit, color, small = false }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minWidth: 0,
        flexShrink: 0,
      }}
    >
      <span
        className="dim"
        style={{ fontSize: 'clamp(8px, 0.4vw + 3px, 10px)', letterSpacing: 1.8 }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: small
            ? 'clamp(11px, 0.8vw + 3px, 15px)'
            : 'clamp(16px, 1.4vw + 4px, 26px)',
          fontVariantNumeric: 'tabular-nums',
          color,
          fontWeight: 500,
          whiteSpace: 'nowrap',
          lineHeight: 1.15,
        }}
      >
        {value}
        {unit && (
          <span className="dim" style={{ fontSize: '0.55em', marginLeft: 3 }}>{unit}</span>
        )}
      </span>
    </div>
  );
}

/* ============================================================================
 * MecoIcon — tiny easter-egg image component.
 *
 * Renders /meco.jpg (a photo of a friend's Yorkie named MECO) inline
 * inside the events rail wherever the label is "MECO". If the asset
 * is missing on the server the onError handler falls back to plain
 * text so the rail never shows a broken-image glyph.
 * ========================================================================== */
function MecoIcon({ size = 14 }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>MECO</>;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        verticalAlign: 'middle',
      }}
    >
      <img
        src="/meco.jpg"
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
        style={{
          width: `${size * 1.6}px`,
          height: `${size * 1.6}px`,
          objectFit: 'cover',
          borderRadius: '50%',
          border: '1.5px solid var(--accent1)',
          boxShadow: '0 0 8px rgba(255, 0, 128, 0.5)',
          verticalAlign: 'middle',
        }}
      />
      MECO
    </span>
  );
}

/* Decide whether an event label should render the MECO easter-egg. */
function isMecoLabel(label) {
  const s = String(label || '').trim().toUpperCase();
  return s === 'MECO' || s === 'MECO-1' || s === 'MECO 1';
}

/* ============================================================================
 * EVENT TIMELINE RAIL — horizontal dot-sequence along the bottom.
 *
 *   LIFTOFF ✓  ·  MAX-Q ✓  ·  MECO ◆  ·  SEP  ·  SES-1  ·  SECO
 *
 * - past  : accent3, trailing checkmark, dim opacity
 * - next  : accent1, pulsing, bold, glow
 * - future: dim, low opacity
 *
 * When the label is MECO the plain text is swapped for a small photo
 * of a friend's Yorkshire Terrier named MECO — an easter-egg that
 * only shows up when the MECO stage is in the rail.
 * ========================================================================== */
export function EventTimelineRail({ events, tPlus }) {
  if (!events || events.length === 0) {
    return (
      <div
        className="dim"
        style={{
          fontSize: 'clamp(10px, 0.6vw + 4px, 12px)',
          padding: '6px 8px',
          textAlign: 'center',
        }}
      >
        event timeline loading<span className="blink"> █</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'baseline',
        gap: 'clamp(4px, 0.6vw, 10px) clamp(8px, 1vw, 16px)',
        padding: 'clamp(6px, 0.8vw, 10px) 10px',
        border: '1px solid var(--border)',
        borderRadius: 3,
      }}
    >
      {events.map((ev, i) => {
        const status = tPlus == null ? 'future'
          : ev.t < tPlus - 2 ? 'past'
          : ev.t < tPlus + 30 ? 'next'
          : 'future';
        const cls = status === 'past' ? 'accent3'
          : status === 'next' ? 'accent1 pulse'
          : 'dim';
        return (
          <span
            key={`${ev.key}-${ev.t}`}
            style={{
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 4,
              whiteSpace: 'nowrap',
              opacity: status === 'future' ? 0.55 : 1,
            }}
          >
            {i > 0 && (
              <span
                className="dim"
                style={{ opacity: 0.4, margin: '0 2px' }}
                aria-hidden="true"
              >
                ·
              </span>
            )}
            <span
              className="dim"
              style={{
                fontSize: 'clamp(8px, 0.4vw + 3px, 10px)',
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: 0.5,
              }}
            >
              {formatEventT(ev.t)}
            </span>
            <span
              className={cls}
              style={{
                fontSize: 'clamp(10px, 0.65vw + 4px, 13px)',
                fontWeight: status === 'next' ? 700 : 500,
                letterSpacing: 0.8,
                textShadow: status === 'next' ? '0 0 8px currentColor' : undefined,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {isMecoLabel(ev.label) ? <MecoIcon size={12} /> : ev.label.toUpperCase()}
              {status === 'past' && ' ✓'}
              {status === 'next' && ' ◆'}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function formatEventT(t) {
  const sign = t < 0 ? '-' : '+';
  const abs = Math.abs(t);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = Math.floor(abs % 60);
  if (h > 0) return `T${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `T${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* ============================================================================
 * TRANSIENT EVENT BANNER — full-viewport fade-in overlay for major
 * milestones. Visible for ~2.5s, then fades out. Never shifts layout
 * (position: fixed, pointer-events: none).
 *
 * Only fires for the "big" named events we want to celebrate:
 * LIFTOFF, MAX-Q, MECO, STAGE SEPARATION, SES-1, SECO, LANDING. Any
 * other events in the sim are skipped so the screen isn't constantly
 * flashing during a data-rich stage of flight.
 * ========================================================================== */
const MAJOR_EVENT_KEYS = new Set([
  'liftoff', 'max_q', 'maxq', 'meco', 'sep', 'stage_sep', 'stage_separation',
  'ses1', 'ses_1', 'seco', 'landing', 'touchdown',
]);

function normalizeEventKey(ev) {
  const raw = String(ev.key || ev.label || '').toLowerCase().trim();
  // Collapse common separators so "max-q", "max q", "max_q" all hash to "maxq".
  return raw.replace(/[\s\-_]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function TransientEventBanner({ events, tPlus }) {
  const [active, setActive] = useState(null);
  const firedRef = useRef(new Set());

  useEffect(() => {
    if (!events || tPlus == null || tPlus < 0) return;
    for (const ev of events) {
      // Fire once, when we've JUST crossed the event's T (within 2s).
      // Skips events we missed by more than 2s (e.g. we joined late) so
      // loading into mid-flight doesn't trigger a cascade of old banners.
      if (tPlus < ev.t) break; // events after this are still in future
      const dt = tPlus - ev.t;
      if (dt > 2) continue;

      const id = `${ev.key || ev.label}@${ev.t}`;
      if (firedRef.current.has(id)) continue;

      // Check if this is a "big" event.
      const norm = normalizeEventKey(ev);
      // Treat "max_q" / "maxq" / "stage_separation" etc. as major via the
      // set; also allow label substring matches for FlightClub's human
      // labels (e.g. "Stage separation" might normalize to "stage_separation").
      const isMajor = MAJOR_EVENT_KEYS.has(norm)
        || /^(liftoff|meco|seco|landing|touchdown)$/.test(norm)
        || /max.?q/.test(norm)
        || /stage.?sep/.test(norm)
        || /ses.?1/.test(norm);
      if (!isMajor) continue;

      firedRef.current.add(id);
      setActive({ label: ev.label, at: Date.now() });
    }
  }, [tPlus, events]);

  // Auto-clear banner after 2.5s.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setActive(null), 2500);
    return () => clearTimeout(t);
  }, [active]);

  if (!active) return null;

  const isMeco = isMecoLabel(active.label);

  return (
    <div
      style={{
        position: 'fixed',
        top: '40%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 2000,
        pointerEvents: 'none',
        fontSize: 'clamp(30px, 5.5vw, 72px)',
        fontWeight: 800,
        letterSpacing: 'clamp(2px, 0.3vw, 6px)',
        color: 'var(--accent1)',
        textShadow: '0 0 24px currentColor, 0 0 48px currentColor',
        animation: 'transient-banner 2.5s ease-out forwards',
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        gap: 'clamp(10px, 1.2vw, 24px)',
      }}
    >
      <span>&gt;&gt;&gt;</span>
      {isMeco ? (
        <MecoTransient />
      ) : (
        <span>{active.label.toUpperCase()}</span>
      )}
      <span>&lt;&lt;&lt;</span>
    </div>
  );
}

/* Big MECO overlay variant — oversized circular photo for the
 * transient banner, same fallback behavior as the small rail icon. */
function MecoTransient() {
  const [failed, setFailed] = useState(false);
  if (failed) return <span>MECO</span>;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'clamp(10px, 1vw, 20px)',
      }}
    >
      <img
        src="/meco.jpg"
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
        style={{
          width: 'clamp(48px, 7vw, 108px)',
          height: 'clamp(48px, 7vw, 108px)',
          objectFit: 'cover',
          borderRadius: '50%',
          border: '3px solid var(--accent1)',
          boxShadow: '0 0 24px currentColor, 0 0 48px currentColor',
        }}
      />
      <span>MECO</span>
    </span>
  );
}

/* ============================================================================
 * Landing-target strip + RTLS sonic-boom warning — unchanged from v29,
 * carried forward into the v30 layout in the same right-column slot.
 * ========================================================================== */
function findLandingEvent(events) {
  if (!Array.isArray(events)) return null;
  return events.find((e) => {
    const k = String(e.key || '').toLowerCase();
    const l = String(e.label || '').toLowerCase();
    return (
      k === 'landing' ||
      k === 'touchdown' ||
      k === 'landing_burn_end' ||
      l.includes('touchdown') ||
      (l.includes('landing') && !l.includes('burn') && !l.includes('boost'))
    );
  });
}

function LandingTargetStrip({ launch, events, tPlus }) {
  if (!launch) return null;
  const attempting = launch.landing_attempt;
  const abbrev = launch.landing_location_abbrev;
  const name = launch.landing_location_name;
  const isRtls = launch.is_rtls;

  if (!attempting && !abbrev && !name) return null;

  const landingEvent = attempting ? findLandingEvent(events) : null;
  // v44: delay the celebratory green fill by 9 seconds after the landing
  // event fires. LL2's "landing" timestamp is the point the burn sequence
  // is triggered — on a droneship/RTLS it takes a few seconds for the
  // booster to actually touch down and the team to confirm it. Flipping
  // to green right at t=0 looked premature on-air; +9s lets the visual
  // match the real moment the booster is safely down.
  const LANDING_CONFIRM_DELAY_S = 9;
  const hasLanded = !!landingEvent
    && tPlus != null
    && tPlus >= landingEvent.t + LANDING_CONFIRM_DELAY_S;

  const targetLabel = hasLanded
    ? '✓ LANDED'
    : (attempting ? 'LANDING ZONE' : 'RECOVERY');

  const successGreen = '#3ecf6b';
  const accent = hasLanded ? successGreen : (isRtls ? 'var(--accent1)' : 'var(--accent2)');

  const cardStyle = hasLanded
    ? {
        border: `2px solid ${successGreen}`,
        background: 'rgba(62, 207, 107, 0.12)',
        boxShadow: `0 0 12px rgba(62, 207, 107, 0.35)`,
      }
    : {
        border: '1px dashed var(--border)',
        background: 'rgba(255,255,255,0.02)',
      };

  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 3,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 2,
        transition: 'border-color 400ms ease, background-color 400ms ease, box-shadow 400ms ease',
        ...cardStyle,
      }}
    >
      <div
        className={hasLanded ? '' : 'dim'}
        style={{
          fontSize: 'clamp(9px, 0.55vw + 4px, 11px)',
          letterSpacing: 1.5,
          color: hasLanded ? successGreen : undefined,
          fontWeight: hasLanded ? 700 : undefined,
        }}
      >
        {targetLabel}
      </div>
      {attempting ? (
        <div
          style={{
            fontSize: 'clamp(13px, 1vw + 4px, 17px)',
            fontWeight: 600,
            color: accent,
            letterSpacing: 0.5,
          }}
        >
          {abbrev || (isRtls ? 'LZ-4' : 'DRONESHIP')}
        </div>
      ) : (
        <div
          style={{
            fontSize: 'clamp(12px, 0.9vw + 4px, 15px)',
            fontWeight: 600,
            color: 'var(--dim)',
            letterSpacing: 1,
          }}
        >
          EXPENDABLE · no recovery
        </div>
      )}
      {attempting && name && name !== abbrev && (
        <div
          className="dim"
          style={{
            fontSize: 'clamp(10px, 0.6vw + 4px, 12px)',
            fontStyle: 'italic',
          }}
        >
          {name}
        </div>
      )}
    </div>
  );
}

function RtlsSonicBoomWarning({ launch, events, tPlus }) {
  if (!launch?.is_rtls) return null;
  const landingEvent = findLandingEvent(events);
  if (landingEvent && tPlus != null && tPlus > landingEvent.t + 60) return null;

  return (
    <div
      className="warn-flash"
      style={{
        marginTop: 8,
        padding: '8px 12px',
        background: '#d1312a',
        color: '#fff',
        fontWeight: 700,
        letterSpacing: 2,
        fontSize: 'clamp(10px, 0.75vw + 4px, 13px)',
        textAlign: 'center',
        border: '2px solid #ff6b63',
        borderRadius: 2,
        textShadow: '0 0 6px rgba(0,0,0,0.4)',
        lineHeight: 1.3,
      }}
    >
      ⚠ WARNING: SONIC BOOM EXPECTED ⚠
    </div>
  );
}
