import { useEffect, useMemo, useState } from 'react';
import { Box } from './Box.jsx';
import { formatCountdown } from '../lib/hooks.js';
import { compassDir, viewingScore } from '../lib/weather.js';
import { LoadingView } from './LoadingView.jsx';
import { StaleDataBanner } from './StaleDataBanner.jsx';
import { buildFacts, shuffleIndices } from '../lib/quick-facts.js';
import { groupRideshare } from '../lib/upcoming.js';
// v47: reuse the same Falcon 9 / Falcon Heavy SVG as the polished layout,
// rendered at terminal scale (monochrome accent1, low opacity, small)
// matching the TerminalCaliforniaMap treatment.
import { RocketSilhouette } from './AmbientPolishedLayout.jsx';

/**
 * AmbientTerminalLayout — the retro TUI / bracketed box variant of the
 * ambient ("while-you-wait") kiosk view. This is the long-standing
 * default look of the app: every section is a Box with a `[ TITLE ]`
 * header, monospaced body, and a plain grid layout.
 *
 * Shares props with AmbientPolishedLayout; the parent AmbientView picks
 * based on the `layout` prop (driven by the layout picker / Y hotkey).
 */
export function AmbientTerminalLayout({
  launch,
  launches,
  weather,
  tMinus,
  mode,
  ll2Status = 'loading',
  isDataStale = false,
  dataAgeMs = null,
  boosterHistory = {},
}) {
  if (!launch) {
    if (ll2Status === 'loading') {
      return <LoadingView ll2Status={ll2Status} />;
    }
    return <DegradedAmbient weather={weather} ll2Status={ll2Status} />;
  }

  const view = viewingScore(weather);

  return (
    <div className="ambient-grid">
      <Box title="NEXT LAUNCH" className="ambient-hero">
        {isDataStale && <StaleDataBanner dataAgeMs={dataAgeMs} ll2Status={ll2Status} />}
        <HeroLaunch launch={launch} tMinus={tMinus} mode={mode} />
      </Box>

      <Box title="MISSION" className="ambient-mission">
        <MissionDetails launch={launch} />
      </Box>

      <Box title="VEHICLE" className="ambient-vehicle">
        <VehicleDetails launch={launch} boosterHistory={boosterHistory} />
      </Box>

      <Box title={`WEATHER · ${launch.pad_name ? 'pad' : 'vsfb'}`} className="ambient-weather">
        <WeatherDetails weather={weather} view={view} />
      </Box>

      <Box title="UPCOMING" className="ambient-upcoming">
        <UpcomingList launches={launches} />
      </Box>

      <Box title="QUICK FACT" className="ambient-quickfact">
        <QuickFactTerminal launch={launch} boosterHistory={boosterHistory} />
      </Box>
    </div>
  );
}

/* QuickFactTerminal — rotating quick-fact panel for the terminal variant.
 * Mirrors AmbientPolishedLayout's QuickFactCard (same 8s rotation, same
 * buildFacts pool), but rendered in plain TUI rows so it looks at home
 * inside a bracketed Box. */
const TERM_ROTATE_MS = 8000;

function QuickFactTerminal({ launch, boosterHistory }) {
  const facts = useMemo(
    () => buildFacts(launch, boosterHistory),
    [launch, boosterHistory],
  );
  // v37: randomize but never repeat until the pool is exhausted.
  const [order, setOrder] = useState(() => shuffleIndices(facts.length));
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setOrder(shuffleIndices(facts.length));
    setIdx(0);
  }, [facts.length]);

  // v48: per-fact dwell — match the polished layout so the longer
  // GRANDPA/DAD card pins for 10s rather than the default 8s.
  useEffect(() => {
    if (!facts.length) return undefined;
    const currentFactIndex = order[idx] ?? 0;
    const currentFact = facts[currentFactIndex];
    const dwell = currentFact?.dwellMs ?? TERM_ROTATE_MS;
    const id = setTimeout(() => {
      setIdx((i) => {
        const next = i + 1;
        if (next >= order.length) {
          const lastShown = order[i];
          setOrder(shuffleIndices(facts.length, lastShown));
          return 0;
        }
        return next;
      });
    }, dwell);
    return () => clearTimeout(id);
  }, [facts.length, order, idx]);

  const currentFactIndex = order[idx] ?? 0;
  const fact = facts[currentFactIndex] || facts[0];
  if (!fact) {
    return <div className="dim" style={{ fontSize: 11 }}>—</div>;
  }

  return (
    <div
      key={idx /* retrigger fade */}
      className="term-fact"
      style={{ position: 'relative' }}
    >
      {/* v42: CA silhouette sits behind the fact text as ambient
          geography, with a VSFB marker at the real lat/lon. Matches the
          polished view's map so the two layouts feel consistent. */}
      <TerminalCaliforniaMap />

      {/* v43: category eyebrow on top, then headline / suffix / body. */}
      <div
        className="accent1"
        style={{
          position: 'relative', zIndex: 1,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 2,
          opacity: 0.9,
          textTransform: 'uppercase',
          marginBottom: 4,
        }}
      >
        &gt; {fact.category}
      </div>
      <div
        className="accent1"
        style={{
          position: 'relative',
          zIndex: 1,
          fontSize: 'clamp(18px, 1.5vw + 6px, 28px)',
          fontWeight: 600,
          letterSpacing: 1,
          lineHeight: 1.1,
        }}
      >
        {fact.headline}
      </div>
      {fact.suffix && (
        <div
          className="dim"
          style={{
            position: 'relative', zIndex: 1,
            fontSize: 11, letterSpacing: 1, marginTop: 2,
          }}
        >
          {fact.suffix.toLowerCase()}
        </div>
      )}
      <div
        style={{
          position: 'relative', zIndex: 1,
          fontSize: 12, marginTop: 6, lineHeight: 1.4,
        }}
      >
        {fact.body}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
 * TerminalCaliforniaMap — same accurate outline as the polished view's
 * CaliforniaMap, but rendered monochrome-stroke only so it reads as
 * TUI-native background art. VSFB pin sits at 34.73°N / 120.57°W.
 * ------------------------------------------------------------------ */
function TerminalCaliforniaMap() {
  return (
    <svg
      className="term-ca-map"
      viewBox="0 0 220 300"
      aria-hidden="true"
    >
      <path
        d="
          M 23.3 20.0
          L 96.9 20.0
          L 96.9 102.1
          L 190.7 211.6
          L 199.5 231.8
          L 192.1 274.0
          L 189.2 279.2
          L 147.2 279.2
          L 146.3 274.0
          L 128.3 246.1
          L 124.9 246.6
          L 117.9 238.1
          L 88.7 226.6
          L 86.4 219.0
          L 85.4 214.3
          L 81.9 201.5
          L 68.9 184.2
          L 65.4 162.3
          L 53.2 143.2
          L 52.9 134.9
          L 44.5 127.3
          L 43.6 121.3
          L 30.5  89.8
          L 19.8  62.7
          L 24.0  52.8
          L 23.5  26.8
          Z
        "
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.7"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* VSFB pulsing marker */}
      <circle cx="86.9" cy="219.0" r="11" fill="none"
        stroke="var(--accent3)" strokeOpacity="0.3" strokeWidth="1" />
      <circle cx="86.9" cy="219.0" r="6" fill="none"
        stroke="var(--accent3)" strokeOpacity="0.7" strokeWidth="1" />
      <circle cx="86.9" cy="219.0" r="2.6" fill="var(--accent3)" />
      <text
        x="97"
        y="223"
        fontSize="10"
        fontWeight="800"
        fill="var(--accent3)"
        style={{ letterSpacing: '1.5px' }}
      >
        VSFB
      </text>
    </svg>
  );
}

function HeroLaunch({ launch, tMinus, mode }) {
  const liftoffParts = launch.net ? (() => {
    const d = new Date(launch.net);
    const fmt = (opts) => d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', ...opts });
    return {
      weekday: fmt({ weekday: 'short' }),
      date: fmt({ month: 'short', day: 'numeric' }),
      time: fmt({ hour: '2-digit', minute: '2-digit' }),
    };
  })() : null;

  const progress = tMinus == null ? 0 :
    Math.max(0, Math.min(100, (1 - tMinus / 86400) * 100));

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="accent2" style={{
            fontSize: 'clamp(18px, 2.2vw, 32px)',
            fontWeight: 500,
            lineHeight: 1.1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {launch.mission_name.toUpperCase()}
          </div>
          <div className="dim" style={{ marginTop: 4, fontSize: 'clamp(11px, 0.7vw + 5px, 14px)' }}>
            {launch.rocket_name.toLowerCase()} · {launch.pad_name.toLowerCase()} · {launch.provider_name.toLowerCase()}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="dim" style={{ fontSize: 'clamp(9px, 0.6vw + 3px, 11px)', letterSpacing: 1 }}>T-MINUS</div>
          <div className="accent1" style={{
            fontSize: 'clamp(24px, 3vw, 42px)',
            fontWeight: 500,
            lineHeight: 1.1,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {formatCountdown(tMinus)}
          </div>
          <div className="dim" style={{ fontSize: 'clamp(9px, 0.6vw + 3px, 11px)' }}>
            status: <span className="accent3">{launch.status.toLowerCase()}</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <span className="dim" style={{ fontSize: 11, letterSpacing: 2 }}>LIFTOFF </span>
        {liftoffParts ? (
          <span style={{ fontSize: 'clamp(14px, 1vw + 6px, 20px)', fontVariantNumeric: 'tabular-nums' }}>
            <span className="accent3" style={{ fontWeight: 600, letterSpacing: 0.5 }}>
              {liftoffParts.date.toUpperCase()}
            </span>
            <span className="accent1" style={{ fontWeight: 500, marginLeft: 8 }}>
              {liftoffParts.time}
            </span>
            <span className="dim" style={{ fontSize: '0.7em', letterSpacing: 1.5, marginLeft: 8 }}>
              PDT · {liftoffParts.weekday.toUpperCase()}
            </span>
          </span>
        ) : (
          <span className="accent3" style={{ fontSize: 'clamp(14px, 1vw + 6px, 20px)', fontWeight: 600 }}>TBD</span>
        )}
      </div>

      {launch.is_rtls && <SonicBoomWarning />}

      <div style={{ marginTop: 10 }}>
        <div className="dim" style={{ fontSize: 10, marginBottom: 3, letterSpacing: 1 }}>
          COUNTDOWN · 24H
        </div>
        <div className="bar">
          <div
            className="bar-fill"
            style={{
              width: `${progress}%`,
              background: `linear-gradient(90deg, var(--accent2), var(--accent1), var(--warn))`,
            }}
          />
        </div>
      </div>

      {launch.mission_description && (
        <div style={{ marginTop: 10, fontSize: 11 }} className="dim">
          {launch.mission_description.slice(0, 240)}
          {launch.mission_description.length > 240 ? '…' : ''}
        </div>
      )}
    </div>
  );
}

function SonicBoomWarning() {
  return (
    <div
      className="warn-flash"
      style={{
        marginTop: 10,
        padding: '6px 12px',
        background: '#d1312a',
        color: '#fff',
        fontWeight: 700,
        letterSpacing: 2.5,
        fontSize: 'clamp(11px, 0.9vw + 4px, 15px)',
        textAlign: 'center',
        border: '2px solid #ff6b63',
        borderRadius: 2,
        textShadow: '0 0 6px rgba(0,0,0,0.4)',
      }}
    >
      ⚠ WARNING: SONIC BOOM EXPECTED ⚠
    </div>
  );
}

function MissionDetails({ launch }) {
  let recovery;
  if (!launch.landing_attempt) {
    recovery = <span className="dim">expendable</span>;
  } else if (launch.is_rtls) {
    const pad = launch.landing_location_abbrev || launch.landing_location_name || 'LZ';
    recovery = <span className="accent1">{pad.toLowerCase()} <span className="dim">(rtls)</span></span>;
  } else {
    const ship = launch.landing_location_abbrev || launch.landing_location_name || 'droneship';
    recovery = <span className="accent2">{ship.toLowerCase()} <span className="dim">(droneship)</span></span>;
  }

  return (
    <>
      <Row label="payload" value={launch.mission_name.toLowerCase()} />
      <Row label="type" value={(launch.mission_type || 'unknown').toLowerCase()} />
      <Row label="orbit" value={(launch.orbit || 'unknown').toLowerCase()} />
      <Row label="provider" value={launch.provider_name.toLowerCase()} />
      <Row label="pad" value={launch.pad_name.toLowerCase()} />
      <Row label="recovery" value={recovery} />
      {launch.webcast_type && (
        <Row label="webcast" value={<span className="accent2">{launch.webcast_type.toLowerCase()}</span>} />
      )}
    </>
  );
}

function VehicleDetails({ launch, boosterHistory = {} }) {
  const booster = launch.booster || null;
  const historyEntry = booster?.serial_number ? boosterHistory[booster.serial_number] : null;
  const fetchedStats = historyEntry?.stats || null;

  let avgDays = null;
  if (fetchedStats?.average_days != null) {
    avgDays = fetchedStats.average_days;
  } else if (
    booster?.first_launch_date &&
    booster?.last_launch_date &&
    typeof booster.flights === 'number' &&
    booster.flights >= 2
  ) {
    const first = new Date(booster.first_launch_date).getTime();
    const last = new Date(booster.last_launch_date).getTime();
    if (Number.isFinite(first) && Number.isFinite(last) && last > first) {
      avgDays = (last - first) / 86_400_000 / (booster.flights - 1);
    }
  }
  const fastestDays = fetchedStats?.fastest_days ?? null;
  const turnaroundDays = booster?.turn_around_time_days ?? null;

  // v47: same Falcon 9 / Falcon Heavy detection as the polished layout, so
  // the terminal VEHICLE box carries a tiny matching rocket silhouette as
  // ambient art — the TUI counterpart to the polished ap-rocket-silhouette.
  const family = (launch.rocket_family || launch.rocket_name || '').toLowerCase();
  const isFalconHeavy = /falcon\s*heavy|heavy/.test(family);
  // v48: tiny label under the silhouette matching the TerminalCaliforniaMap's
  // "VSFB" tag — helps read it as a labeled diagram instead of decoration.
  const rocketLabel = isFalconHeavy ? 'falcon heavy' : 'falcon 9';

  return (
    <div className="term-vehicle-wrap">
      {/* v47–v51: Falcon 9 / Falcon Heavy silhouette as ambient art inside
       * the VEHICLE box. v51: spans the FULL box height (rocket rows and
       * booster rows together) like the polished layout does, anchored
       * to the left of the label column. */}
      <div className="term-rocket-silhouette" aria-hidden="true">
        <RocketSilhouette variant={isFalconHeavy ? 'falcon-heavy' : 'falcon9'} />
        <div className="term-rocket-label">{rocketLabel}</div>
      </div>
      <Row label="rocket" value={launch.rocket_name.toLowerCase()} emphasized />
      {launch.rocket_family && <Row label="family" value={launch.rocket_family.toLowerCase()} />}
      {launch.rocket_length_m && <Row label="height" value={`${launch.rocket_length_m} m`} />}
      {launch.rocket_diameter_m && <Row label="diameter" value={`${launch.rocket_diameter_m} m`} />}
      {launch.rocket_mass_t && <Row label="mass" value={`${launch.rocket_mass_t.toLocaleString()} t`} />}
      {launch.rocket_thrust_kN && <Row label="thrust (SL)" value={`${launch.rocket_thrust_kN.toLocaleString()} kN`} />}
      {launch.rocket_leo_kg && <Row label="to LEO" value={`${launch.rocket_leo_kg.toLocaleString()} kg`} />}
      {booster && (
        <>
          {/* v44: blank spacer row so the booster-only block visually
           * separates from the rocket-family stats above. */}
          <div className="term-row-spacer" aria-hidden="true" />
          <Row
            label="booster"
            emphasized
            value={<span className="accent2">{booster.serial_number.toLowerCase()}</span>}
          />
          {booster.launcher_flight_number != null && (
            <Row
              label="flight"
              value={
                <span>
                  <span className="accent1">#{booster.launcher_flight_number}</span>
                  {typeof booster.flights === 'number' && (
                    <span className="dim"> ({booster.flights} prior)</span>
                  )}
                </span>
              }
            />
          )}
          {avgDays != null && (
            <Row label="avg reuse" value={formatDays(avgDays)} />
          )}
          {fastestDays != null && (
            <Row label="fastest" value={formatDays(fastestDays)} />
          )}
          {turnaroundDays != null && (
            <Row label="this turnaround" value={formatDays(turnaroundDays)} />
          )}
        </>
      )}
    </div>
  );
}

function formatDays(days) {
  if (days == null || !Number.isFinite(days)) return '—';
  const d = Math.floor(days);
  const h = Math.floor((days - d) * 24);
  if (d === 0) return `${h}h`;
  if (h === 0) return `${d}d`;
  return `${d}d ${h}h`;
}

function WeatherDetails({ weather, view }) {
  if (!weather) return <div className="dim">loading<span className="blink"> █</span></div>;
  return (
    <>
      <Row label="temp" value={`${Math.round(weather.temp_f)}°F · ${weather.description}`} />
      <Row label="wind" value={`${Math.round(weather.wind_mph)} mph ${compassDir(weather.wind_deg)}`} />
      <Row label="humidity" value={`${Math.round(weather.humidity)}%`} />
      <Row label="clouds" value={`${Math.round(weather.cloud_pct)}%`} />
      <div style={{ marginTop: 10 }}>
        <div className="dim" style={{ fontSize: 10, letterSpacing: 1 }}>VIEWING</div>
        <div className="bar" style={{ marginTop: 3, height: 6 }}>
          <div
            className="bar-fill"
            style={{
              width: `${view.score}%`,
              background: view.score > 70
                ? 'linear-gradient(90deg, var(--accent2), var(--accent3))'
                : view.score > 40
                  ? 'linear-gradient(90deg, var(--accent4), var(--accent1))'
                  : 'linear-gradient(90deg, var(--warn), var(--accent1))',
            }}
          />
        </div>
        <div style={{ fontSize: 11, marginTop: 3 }} className="accent3">
          {view.label} ({view.score}/100)
        </div>
      </div>
    </>
  );
}

function UpcomingList({ launches }) {
  const safe = Array.isArray(launches) ? launches : [];
  // v36: show every upcoming launch after the first; the container's
  // overflow-hidden + height budget naturally caps how many are visible
  // on any given display, so larger kiosks fit more without us hardcoding
  // a cap.
  const rest = safe.slice(1);
  // v39: collapse same-day rideshare stacks to a single row.
  const groups = useMemo(() => groupRideshare(rest), [rest]);
  if (groups.length === 0) {
    return <div className="dim" style={{ fontSize: 11 }}>no other launches scheduled</div>;
  }
  return (
    <div className="ambient-upcoming-list" style={{ fontSize: 11 }}>
      {groups.map((g) => (
        <div
          key={g.id}
          className="row"
          style={{
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <span
            className="dim"
            style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
          >
            {g.far_out
              ? 'tbd'
              : new Date(g.net).toLocaleDateString('en-US', {
                  month: 'short', day: '2-digit', timeZone: 'America/Los_Angeles',
                }).toLowerCase()}
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              flex: '1 1 auto',
              minWidth: 0,
              justifyContent: 'flex-end',
              textAlign: 'right',
              wordBreak: 'break-word',
            }}
          >
            {g.display_name}
            {g.count > 1 && (
              <span
                title={`${g.count} related missions`}
                style={{
                  display: 'inline-block',
                  marginLeft: 2,
                  padding: '1px 5px',
                  borderRadius: 8,
                  background: 'rgba(255, 0, 128, 0.18)',
                  border: '1px solid rgba(255, 0, 128, 0.4)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 9,
                  letterSpacing: 0.5,
                }}
              >
                ×{g.count}
              </span>
            )}
            {g.has_rtls && <SbBadge />}
          </span>
        </div>
      ))}
    </div>
  );
}

function SbBadge() {
  return (
    <span
      title="Booster RTLS — sonic boom expected"
      style={{
        display: 'inline-block',
        background: '#d1312a',
        color: '#fff',
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: 0.5,
        padding: '1px 4px',
        borderRadius: 2,
        lineHeight: 1.1,
        fontFamily: 'inherit',
      }}
    >
      SB
    </span>
  );
}

function Row({ label, value, emphasized = false }) {
  // v45: `emphasized` flags section-header rows (rocket, booster) —
  // bolder weight + accent1 color on both label and value to read as a
  // heading for the rows beneath.
  return (
    <div className={`row${emphasized ? ' row-emph' : ''}`}>
      <span className={emphasized ? 'accent1' : 'dim'}>{label}</span>
      <span className={emphasized ? 'accent1' : undefined}>{value}</span>
    </div>
  );
}

function DegradedAmbient({ weather, ll2Status }) {
  const view = viewingScore(weather);

  const copy = (() => {
    switch (ll2Status) {
      case 'rate-limited':
        return {
          title: 'LL2 RATE LIMIT EXCEEDED',
          subtitle: 'thespacedevs free tier is ~15 req/hr · backing off and retrying',
          detail: 'live launch data will return as soon as the proxy cache refreshes',
          tone: 'warn',
        };
      case 'error':
        return {
          title: 'LL2 UNREACHABLE',
          subtitle: "can't reach ll.thespacedevs.com · retrying with backoff",
          detail: 'network or upstream API outage · polling continues in background',
          tone: 'warn',
        };
      case 'empty':
      default:
        return {
          title: 'NO UPCOMING VSFB LAUNCHES',
          subtitle: 'checking every 10 minutes · sit tight',
          detail: 'nothing currently scheduled at vandenberg per launch library 2',
          tone: 'accent1',
        };
    }
  })();
  const { title, subtitle, detail, tone } = copy;

  return (
    <div className="ambient-grid">
      <Box title="KIOSK STATUS" className="ambient-hero">
        <div style={{ padding: '16px 4px 4px' }}>
          <div
            className={tone === 'warn' ? 'warn' : 'accent1'}
            style={{
              fontSize: 'clamp(18px, 1.6vw + 6px, 28px)',
              fontWeight: 600,
              letterSpacing: 2,
            }}
          >
            {title}
          </div>
          <div
            className="dim"
            style={{
              marginTop: 6,
              fontSize: 'clamp(11px, 0.7vw + 5px, 14px)',
            }}
          >
            {subtitle}
          </div>
          <div
            className="accent3"
            style={{
              marginTop: 20,
              fontSize: 'clamp(11px, 0.6vw + 5px, 13px)',
              lineHeight: 1.5,
            }}
          >
            &gt; {detail}
            <span className="blink accent1"> █</span>
          </div>
          <div
            className="dim"
            style={{
              marginTop: 22,
              fontSize: 11,
              letterSpacing: 1,
            }}
          >
            vsfb kiosk · v1.1 · by josh mcadams
          </div>
        </div>
      </Box>

      <Box title="WEATHER · vsfb">
        <WeatherDetails weather={weather} view={view} />
      </Box>
    </div>
  );
}
