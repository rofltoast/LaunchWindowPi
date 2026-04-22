import { useEffect, useMemo, useState } from 'react';
import { formatCountdown } from '../lib/hooks.js';
import { compassDir, viewingScore } from '../lib/weather.js';
import { LoadingView } from './LoadingView.jsx';
import { StaleDataBanner } from './StaleDataBanner.jsx';
import { buildFacts, shuffleIndices } from '../lib/quick-facts.js';
import { groupRideshare } from '../lib/upcoming.js';
// v46: real VSFB pad-sunset photo, imported so Vite fingerprints + hashes
// it the same way it does the rest of the asset pipeline. Replaces the
// hand-drawn PadSilhouette SVG that had been filling the hero since v40.
import padSunsetUrl from '../assets/pad-sunset.jpg';

/**
 * AmbientPolishedLayout — the cinematic "broadcast kiosk" variant of
 * the ambient view. Versus the terminal variant, this one drops the
 * bracketed Box chrome in favor of large rounded cards, a hero slab
 * with a big magenta countdown, a GO/NO-GO pill, and a bottom-row of
 * weather / upcoming / rotating-quick-fact cards.
 *
 * The quick-fact card rotates through `buildFacts(launch, boosterHistory)`
 * every ~8 seconds, so anyone walking up is likely to see something new.
 *
 * Shares all props with AmbientTerminalLayout; the parent AmbientView
 * routes based on the `layout` prop (Y hotkey / picker persists it in
 * localStorage under `kiosk-layout`).
 */
export function AmbientPolishedLayout({
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
    return <DegradedAmbientPolished weather={weather} ll2Status={ll2Status} />;
  }

  const view = viewingScore(weather);
  const facts = useMemo(
    () => buildFacts(launch, boosterHistory),
    [launch, boosterHistory],
  );

  return (
    <div className="ambient-polished-grid">
      {isDataStale && <StaleDataBanner dataAgeMs={dataAgeMs} ll2Status={ll2Status} />}

      <HeroCard launch={launch} tMinus={tMinus} />

      <div className="ap-middle-row">
        <MissionCard launch={launch} />
        <VehicleCard launch={launch} boosterHistory={boosterHistory} />
      </div>

      <div className="ap-bottom-row">
        <WeatherCard weather={weather} view={view} />
        <UpcomingCard launches={launches} />
        <QuickFactCard facts={facts} />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * HERO CARD — cinematic broadcast hero.
 *
 * Design: dramatic layered background (radial + gradient stand-in for a
 * pad photograph), massive magenta T-MINUS with HRS/MIN/SEC breakout
 * labels, GO-FOR-LAUNCH pill top-right with glowing dot, large bold
 * mission title, cyan liftoff timestamp, slim progress bar w/ remaining
 * percentage.
 * -------------------------------------------------------------------------- */
function HeroCard({ launch, tMinus }) {
  const liftoffParts = launch.net ? (() => {
    const d = new Date(launch.net);
    const fmt = (opts) => d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', ...opts });
    return {
      weekday: fmt({ weekday: 'short' }),
      date: fmt({ month: 'short', day: 'numeric', year: 'numeric' }),
      time: fmt({ hour: '2-digit', minute: '2-digit' }),
    };
  })() : null;

  const progress = tMinus == null ? 0 :
    Math.max(0, Math.min(100, (1 - tMinus / 86400) * 100));
  const remaining = Math.max(0, Math.min(100, 100 - progress));

  const isGo = /^go$/i.test(launch.status_abbrev) || /go for launch/i.test(launch.status);
  const pillLabel = isGo ? 'GO FOR LAUNCH' : (launch.status || 'STATUS UNKNOWN').toUpperCase();

  // Decompose the countdown into hrs / min / sec so each number can
  // get its own giant display with a tiny unit label underneath —
  // the broadcast-clock look from the mockup.
  const parts = splitCountdown(tMinus);

  return (
    <div className="ap-hero ap-hero-cinema">
      {/* v46: real Falcon 9 at VSFB SLC-4E at sunset. The vignette layer
       * below darkens the left third so the T-minus text + eyebrow stay
       * legible against the sky. */}
      <img
        className="ap-hero-photo-real"
        src={padSunsetUrl}
        alt=""
        aria-hidden="true"
      />
      <div className="ap-hero-vignette" aria-hidden="true" />

      {/* Top-right GO/NO-GO pill floats above the hero */}
      <div className={`ap-hero-pill ${isGo ? 'ap-pill-go' : 'ap-pill-neutral'}`}>
        <span className="ap-pill-dot" />
        {pillLabel}
      </div>

      {/* LEFT column: all text content. RIGHT column: pad imagery
          (ap-hero-photo-real img is absolutely positioned behind). */}
      <div className="ap-hero-body">
        <div className="ap-hero-eyebrow accent1">NEXT LAUNCH</div>
        <div className="ap-hero-title">{launch.mission_name.toUpperCase()}</div>
        <div className="ap-hero-sub dim">
          {launch.rocket_name.toUpperCase()}
          <span className="ap-hero-dot"> · </span>
          {launch.pad_name.replace(/^Space Launch Complex\s*/i, 'SLC-')}
          <span className="ap-hero-dot"> · </span>
          VANDENBERG SFB
        </div>

        {/* T-MINUS + LIFTOFF live on the same row per the reference */}
        <div className="ap-hero-countdown-row">
          <div className="ap-hero-clock">
            <div className="ap-hero-clock-label dim">T-MINUS</div>
            <div className="ap-hero-clock-digits">
              <ClockUnit value={parts.hours} label="HRS" />
              <span className="ap-hero-clock-sep">:</span>
              <ClockUnit value={parts.minutes} label="MIN" />
              <span className="ap-hero-clock-sep">:</span>
              <ClockUnit value={parts.seconds} label="SEC" />
            </div>
          </div>

          {liftoffParts && (
            <div className="ap-hero-liftoff">
              <div className="ap-hero-clock-label dim">LIFTOFF</div>
              <div className="ap-hero-liftoff-date accent2">
                {liftoffParts.date.replace(/,?\s*\d{4}$/, '').toUpperCase()}
              </div>
              <div className="ap-hero-liftoff-time">
                {liftoffParts.time}:00 PDT
              </div>
            </div>
          )}
        </div>

        {/* COUNTDOWN PROGRESS bar sits at the bottom of the hero */}
        <div className="ap-hero-progress">
          <div className="ap-hero-progress-label dim">COUNTDOWN PROGRESS (24H)</div>
          <div className="ap-hero-progress-row">
            <div className="ap-hero-progress-bar">
              <div
                className="ap-hero-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="ap-hero-progress-meta">
              <span className="ap-hero-progress-pct">
                {remaining.toFixed(1)}%
              </span>
              <span className="dim ap-hero-progress-remaining">REMAINING</span>
            </div>
          </div>
        </div>

        {launch.is_rtls && (
          <div className="ap-sb-warn ap-sb-warn-cinema">
            ⚠ SONIC BOOM EXPECTED · RTLS RECOVERY ⚠
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * PadSilhouette — v36 revived per visual-match spec. A low-contrast SVG
 * launch-pad tableau that sits under the gradient/photo layers: sunset
 * horizon stripe, Falcon 9 stacked on the ramp, SLC-4E gantry with
 * umbilicals, lightning masts, and a few ground-service subtleties.
 *
 * Everything is done in dark silhouette tones so it reads as atmosphere
 * rather than an illustration. Layered with `.ap-hero-photo` (real photo
 * if present) so we can swap in a proper launch-pad image later without
 * removing the SVG fallback.
 * -------------------------------------------------------------------------- */
/* v37: Falcon-9-on-pad scene closer to the reference photo.
 * Layered sunset sky with orange/pink cloud bands → dark horizon →
 * ocean reflection → white Falcon 9 next to SLC-4E's dark gantry tower.
 * Tuned colors so the rocket reads as WHITE (like the ref) rather than
 * a dark silhouette. Everything still scoped to the right half of the
 * hero so the left-column text stays unobstructed. */
function PadSilhouette() {
  return (
    <svg
      className="ap-hero-silhouette"
      viewBox="0 0 800 500"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        {/* Sunset sky: upper deep blue-purple → mid magenta → lower orange */}
        <linearGradient id="ap-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a0f2e" />
          <stop offset="0.35" stopColor="#3a1942" />
          <stop offset="0.62" stopColor="#8a2a4e" />
          <stop offset="0.82" stopColor="#d85a3a" />
          <stop offset="0.95" stopColor="#f0a050" />
          <stop offset="1" stopColor="#1a0a14" />
        </linearGradient>
        {/* Sea/foreground wash */}
        <linearGradient id="ap-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a0e20" />
          <stop offset="1" stopColor="#050308" />
        </linearGradient>
        {/* Cloud streak wash */}
        <linearGradient id="ap-cloud" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255, 130, 180, 0.0)" />
          <stop offset="0.5" stopColor="rgba(255, 130, 180, 0.55)" />
          <stop offset="1" stopColor="rgba(255, 130, 180, 0.0)" />
        </linearGradient>
      </defs>

      {/* === Sky === */}
      <rect x="0" y="0" width="800" height="380" fill="url(#ap-sky)" />

      {/* Cloud streaks — thin horizontal wisps over the sunset band */}
      <g>
        <rect x="0" y="200" width="800" height="18" fill="url(#ap-cloud)" opacity="0.55" />
        <rect x="0" y="236" width="800" height="14" fill="url(#ap-cloud)" opacity="0.45" />
        <rect x="0" y="265" width="800" height="10" fill="url(#ap-cloud)" opacity="0.35" />
        <rect x="0" y="295" width="800" height="8" fill="url(#ap-cloud)" opacity="0.28" />
      </g>

      {/* Sun glow halo behind horizon */}
      <ellipse cx="420" cy="375" rx="260" ry="28" fill="rgba(255, 200, 120, 0.25)" />
      <ellipse cx="420" cy="378" rx="140" ry="18" fill="rgba(255, 230, 170, 0.35)" />

      {/* === Distant coastline silhouettes behind the pad === */}
      <path
        d="M0 370 L80 362 L160 368 L260 360 L360 365 L460 358 L560 363 L680 360 L800 365 L800 380 L0 380 Z"
        fill="#0a0712"
      />

      {/* === Sea / foreground === */}
      <rect x="0" y="380" width="800" height="120" fill="url(#ap-sea)" />
      {/* Sun reflection on water */}
      <rect x="380" y="382" width="80" height="50" fill="rgba(255, 180, 110, 0.22)" />
      <rect x="395" y="385" width="50" height="40" fill="rgba(255, 210, 140, 0.35)" />

      {/* === SLC-4E gantry / strongback tower === */}
      {/* Main tower shape to the right of the rocket */}
      <g fill="#06080e">
        <rect x="580" y="80" width="44" height="300" />
        <rect x="572" y="80" width="60" height="12" />
        <rect x="564" y="130" width="76" height="6" />
        <rect x="564" y="180" width="76" height="6" />
        <rect x="564" y="230" width="76" height="6" />
        <rect x="564" y="280" width="76" height="6" />
        <rect x="564" y="330" width="76" height="6" />
      </g>
      {/* Cross-bracing lattice on tower */}
      <g stroke="#0c1018" strokeWidth="1.2" fill="none">
        <line x1="580" y1="92" x2="624" y2="130" />
        <line x1="624" y1="92" x2="580" y2="130" />
        <line x1="580" y1="136" x2="624" y2="180" />
        <line x1="624" y1="136" x2="580" y2="180" />
        <line x1="580" y1="186" x2="624" y2="230" />
        <line x1="624" y1="186" x2="580" y2="230" />
        <line x1="580" y1="236" x2="624" y2="280" />
        <line x1="624" y1="236" x2="580" y2="280" />
        <line x1="580" y1="286" x2="624" y2="330" />
        <line x1="624" y1="286" x2="580" y2="330" />
      </g>

      {/* === Lightning masts flanking the pad === */}
      <g stroke="#080a12" strokeWidth="2" fill="none">
        <line x1="420" y1="40" x2="420" y2="380" />
        <line x1="760" y1="30" x2="760" y2="380" />
      </g>

      {/* === Falcon 9 on the pad (WHITE like the ref photo) === */}
      <g>
        {/* Engine skirt (slightly darker) */}
        <rect x="498" y="355" width="44" height="22" fill="#c8ccd4" />
        {/* Booster body */}
        <rect x="500" y="180" width="40" height="175" fill="#f0f2f6" />
        {/* Grid fin / interstage band (black) */}
        <rect x="496" y="170" width="48" height="12" fill="#0a0c14" />
        {/* Second stage (black interstage then white) */}
        <rect x="502" y="130" width="36" height="40" fill="#f0f2f6" />
        {/* Fairing base */}
        <rect x="502" y="118" width="36" height="14" fill="#f0f2f6" />
        {/* Fairing nose */}
        <path d="M502 118 L520 70 L538 118 Z" fill="#f0f2f6" />
        {/* Subtle body shadow on the right side */}
        <rect x="528" y="180" width="12" height="175" fill="#c8ccd4" opacity="0.6" />
        {/* Black company band near base */}
        <rect x="500" y="320" width="40" height="6" fill="#0a0c14" />
      </g>

      {/* Hold-down clamps / base structure */}
      <g fill="#0a0c14">
        <rect x="488" y="375" width="66" height="14" />
        <rect x="500" y="370" width="10" height="8" />
        <rect x="530" y="370" width="10" height="8" />
      </g>

      {/* === Pad lights / deck lamps === */}
      <g>
        <circle cx="380" cy="378" r="2.2" fill="#ffd080" opacity="0.9" />
        <circle cx="430" cy="378" r="1.8" fill="#ffb060" opacity="0.9" />
        <circle cx="580" cy="378" r="2" fill="#ffe0a0" opacity="0.85" />
        <circle cx="640" cy="378" r="1.6" fill="#ffa050" opacity="0.8" />
        <circle cx="720" cy="378" r="1.8" fill="#ffd080" opacity="0.85" />
        <circle cx="260" cy="378" r="1.6" fill="#ffb060" opacity="0.7" />
        <circle cx="160" cy="378" r="1.5" fill="#ffa050" opacity="0.6" />
      </g>

      {/* Ground-service equipment blocks along the sea wall */}
      <g fill="#040608">
        <rect x="120" y="372" width="40" height="10" />
        <rect x="200" y="372" width="52" height="12" />
        <rect x="660" y="372" width="62" height="12" />
        <rect x="740" y="372" width="40" height="10" />
      </g>
    </svg>
  );
}

function splitCountdown(t) {
  if (t == null || !Number.isFinite(t)) {
    return { hours: '--', minutes: '--', seconds: '--' };
  }
  const abs = Math.max(0, Math.floor(t));
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const seconds = abs % 60;
  return {
    hours: String(hours).padStart(2, '0'),
    minutes: String(minutes).padStart(2, '0'),
    seconds: String(seconds).padStart(2, '0'),
  };
}

function ClockUnit({ value, label }) {
  return (
    <div className="ap-hero-clock-unit">
      <div className="ap-hero-clock-value">{value}</div>
      <div className="ap-hero-clock-unit-label dim">{label}</div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * MISSION CARD
 * -------------------------------------------------------------------------- */
function MissionCard({ launch }) {
  let recovery;
  if (!launch.landing_attempt) {
    recovery = <span className="dim">expendable</span>;
  } else if (launch.is_rtls) {
    const pad = launch.landing_location_abbrev || launch.landing_location_name || 'LZ';
    recovery = <span className="accent1">{pad} <span className="dim">(RTLS)</span></span>;
  } else {
    const ship = launch.landing_location_abbrev || launch.landing_location_name || 'droneship';
    recovery = <span className="accent2">{ship} <span className="dim">(droneship)</span></span>;
  }

  return (
    <div className="ap-card ap-card-mission">
      <div className="ap-card-title">MISSION</div>
      <CardRow label="Mission" value={launch.mission_name} />
      <CardRow label="Customer" value={launch.provider_name} />
      <CardRow label="Orbit" value={launch.orbit || '—'} />
      <CardRow label="Payload" value={launch.mission_type || '—'} />
      <CardRow label="Pad" value={launch.pad_name} />
      <CardRow label="Recovery" value={recovery} />
      {launch.webcast_type && (
        <CardRow label="Webcast" value={<span className="accent2">{launch.webcast_type}</span>} />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * VEHICLE CARD — rocket + booster reuse stats.
 * -------------------------------------------------------------------------- */
function VehicleCard({ launch, boosterHistory = {} }) {
  const booster = launch.booster || null;
  const histEntry = booster?.serial_number ? boosterHistory[booster.serial_number] : null;
  const fetchedStats = histEntry?.stats || null;

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

  // Pick the right silhouette per rocket family. Default is Falcon 9,
  // which is the common VSFB case; Vulcan/Atlas/Delta/Minotaur use a
  // slightly different proportion so the graphic reads as intentional.
  const family = (launch.rocket_family || launch.rocket_name || '').toLowerCase();
  const isFalconHeavy = /falcon\s*heavy|heavy/.test(family);

  return (
    <div className="ap-card ap-card-vehicle">
      {/* Reverted from v39: back to the SVG rocket silhouette. */}
      <div className="ap-rocket-silhouette" aria-hidden="true">
        <RocketSilhouette variant={isFalconHeavy ? 'falcon-heavy' : 'falcon9'} />
      </div>
      <div className="ap-card-title">VEHICLE</div>
      <CardRow label="Rocket" value={launch.rocket_name} emphasized />
      {launch.rocket_family && <CardRow label="Family" value={launch.rocket_family} />}
      {launch.rocket_length_m && <CardRow label="Height" value={`${launch.rocket_length_m} m`} />}
      {launch.rocket_thrust_kN && <CardRow label="Thrust" value={`${launch.rocket_thrust_kN.toLocaleString()} kN`} />}
      {launch.rocket_leo_kg && <CardRow label="To LEO" value={`${launch.rocket_leo_kg.toLocaleString()} kg`} />}
      {/* v44: visual break between rocket-family stats above and the
       * booster-specific rows below. Makes the booster reuse block read
       * as its own group instead of another row in the same list. */}
      <div className="ap-card-row-spacer" aria-hidden="true" />
      {/* v35 strict spec §7: always render the 5 booster fields, using
       * "—" as a fallback when data is missing, so the VEHICLE panel
       * has a consistent shape every launch. */}
      <CardRow
        label="Booster"
        emphasized
        value={
          booster?.serial_number ? (
            <span className="accent2">{booster.serial_number}</span>
          ) : (
            <span className="dim">—</span>
          )
        }
      />
      <CardRow
        label="Flight"
        value={
          booster?.launcher_flight_number != null ? (
            <span>
              <span className="accent1">#{booster.launcher_flight_number}</span>
              {typeof booster.flights === 'number' && (
                <span className="dim"> ({booster.flights} prior)</span>
              )}
            </span>
          ) : (
            <span className="dim">—</span>
          )
        }
      />
      <CardRow label="Avg reuse" value={formatDays(avgDays)} />
      <CardRow label="Fastest" value={formatDays(fastestDays)} />
      <CardRow label="This turnaround" value={formatDays(turnaroundDays)} />
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * RocketSilhouette — v36 revived per visual-match spec §8. A clean
 * Falcon 9 (or Falcon Heavy) line-art silhouette anchored to the right
 * side of the VEHICLE card. Low opacity so it enhances rather than
 * overpowers the data.
 * -------------------------------------------------------------------------- */
export function RocketSilhouette({ variant = 'falcon9' }) {
  if (variant === 'heavy') {
    return (
      <svg
        viewBox="0 0 80 200"
        preserveAspectRatio="xMaxYMid meet"
        aria-hidden="true"
      >
        <g fill="none" stroke="var(--accent1)" strokeWidth="1.2" strokeLinejoin="round">
          {/* Nose cone */}
          <path d="M40 6 L34 32 L46 32 Z" />
          {/* Fairing / 2nd stage */}
          <rect x="34" y="32" width="12" height="38" />
          {/* Interstage */}
          <rect x="33" y="70" width="14" height="4" fill="var(--accent1)" fillOpacity="0.25" />
          {/* Center booster */}
          <rect x="34" y="74" width="12" height="96" />
          {/* Side boosters */}
          <path d="M22 90 L22 168 L30 168 L30 96 L34 82 Z" />
          <path d="M58 90 L58 168 L50 168 L50 96 L46 82 Z" />
          {/* Nose cones on side boosters */}
          <path d="M22 90 L26 78 L30 90 Z" />
          <path d="M58 90 L54 78 L50 90 Z" />
          {/* Grid fins */}
          <rect x="28" y="82" width="4" height="8" />
          <rect x="48" y="82" width="4" height="8" />
          {/* Engines */}
          <line x1="26" y1="168" x2="54" y2="168" strokeWidth="2" />
          <line x1="22" y1="168" x2="30" y2="172" />
          <line x1="50" y1="172" x2="58" y2="168" />
        </g>
      </svg>
    );
  }
  // Default Falcon 9 — v37 cleaner outlined line-art, spans full height.
  return (
    <svg
      viewBox="0 0 60 280"
      preserveAspectRatio="xMaxYMid meet"
      aria-hidden="true"
    >
      <g fill="none" stroke="var(--accent1)" strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round">
        {/* Fairing nose cone */}
        <path d="M30 6 L22 40 L38 40 Z" />
        {/* Fairing body */}
        <path d="M22 40 L22 70 L38 70 L38 40" />
        {/* Interstage (thin band) */}
        <rect x="21" y="70" width="18" height="4" fill="var(--accent1)" fillOpacity="0.3" />
        {/* Second stage */}
        <path d="M23 74 L23 130 L37 130 L37 74" />
        {/* Second-stage MVac thrust visual band */}
        <line x1="23" y1="128" x2="37" y2="128" strokeOpacity="0.5" />
        {/* First stage (booster) - long body */}
        <path d="M22 130 L22 248 L38 248 L38 130" />
        {/* Grid fins (deployed look) */}
        <path d="M14 136 L22 134 L22 146 L14 148 Z" fill="var(--accent1)" fillOpacity="0.2" />
        <path d="M46 136 L38 134 L38 146 L46 148 Z" fill="var(--accent1)" fillOpacity="0.2" />
        {/* Black company band (mid-booster detail) */}
        <line x1="22" y1="200" x2="38" y2="200" strokeOpacity="0.4" />
        <line x1="22" y1="204" x2="38" y2="204" strokeOpacity="0.4" />
        {/* Landing legs (deployed stance) */}
        <path d="M22 246 L12 266" />
        <path d="M38 246 L48 266" />
        <path d="M26 246 L20 268" strokeOpacity="0.5" />
        <path d="M34 246 L40 268" strokeOpacity="0.5" />
        {/* Engine bell/octaweb */}
        <path d="M22 248 L38 248 L36 260 L24 260 Z" fill="var(--accent1)" fillOpacity="0.18" />
        {/* Merlin nozzle cluster - 3 visible engines */}
        <circle cx="26" cy="254" r="1.2" fill="var(--accent1)" fillOpacity="0.6" />
        <circle cx="30" cy="256" r="1.3" fill="var(--accent1)" fillOpacity="0.6" />
        <circle cx="34" cy="254" r="1.2" fill="var(--accent1)" fillOpacity="0.6" />
      </g>
    </svg>
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

/* ----------------------------------------------------------------------------
 * WEATHER CARD — cinematic: big temperature, animated weather glyph,
 * micro-stats row, and a short human helper line (e.g. "Marine layer
 * may clear by T-30m").
 * -------------------------------------------------------------------------- */
function WeatherCard({ weather, view }) {
  return (
    <div className="ap-card ap-card-weather">
      <div className="ap-card-title">WEATHER · VSFB</div>
      {!weather ? (
        <div className="dim">loading<span className="blink"> █</span></div>
      ) : (
        <>
          <div className="ap-weather-hero">
            <div className="ap-weather-temp">
              <span className="ap-weather-temp-num">{Math.round(weather.temp_f)}</span>
              <span className="ap-weather-temp-unit">°F</span>
            </div>
            <div className="ap-weather-glyph" aria-hidden="true">
              <WeatherGlyph description={weather.description} cloudPct={weather.cloud_pct} />
            </div>
          </div>
          <div className="ap-weather-desc accent3">
            {weather.description.toLowerCase()}
          </div>

          <div className="ap-weather-microgrid">
            <MicroStat label="WIND" value={`${Math.round(weather.wind_mph)} ${compassDir(weather.wind_deg)}`} unit="mph" />
            <MicroStat label="HUMID" value={`${Math.round(weather.humidity)}`} unit="%" />
            <MicroStat label="CLOUDS" value={`${Math.round(weather.cloud_pct)}`} unit="%" />
          </div>

          <div className="ap-weather-viewing">
            <div className="ap-weather-viewing-row">
              <span className="dim" style={{ letterSpacing: 1.5 }}>VIEWING</span>
              <span className="accent3" style={{ fontWeight: 600 }}>
                {view.label} · {view.score}/100
              </span>
            </div>
            <div className="bar" style={{ marginTop: 4, height: 5 }}>
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
          </div>

          <div className="ap-weather-hint dim">
            {weatherHint(weather)}
          </div>
        </>
      )}
    </div>
  );
}

function MicroStat({ label, value, unit }) {
  return (
    <div className="ap-weather-micro">
      <div className="dim ap-weather-micro-label">{label}</div>
      <div className="ap-weather-micro-value">
        {value}
        {unit && <span className="dim" style={{ fontSize: '0.75em', marginLeft: 2 }}>{unit}</span>}
      </div>
    </div>
  );
}

function weatherHint(w) {
  if (!w) return '';
  const c = w.cloud_pct;
  if (c >= 85) return 'Heavy overcast · marine layer may obscure ascent view';
  if (c >= 55) return 'Marine layer may clear by T-30m — mostly cloudy now';
  if (c >= 30) return 'Scattered clouds · partial visibility expected';
  if (w.wind_mph >= 25) return 'Breezy — wind may delay recovery ops';
  return 'Clear skies · excellent viewing conditions';
}

/* Simple inline SVG weather glyph — scales with temperature display. */
function WeatherGlyph({ description = '', cloudPct = 0 }) {
  const d = description.toLowerCase();
  const cloudy = cloudPct > 40 || /cloud|overcast|fog|mist|haz/.test(d);
  const rain = /rain|drizzle|shower/.test(d);

  if (rain) {
    return (
      <svg viewBox="0 0 64 64" width="100%" height="100%">
        <g fill="none" stroke="var(--accent4)" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 30 a10 10 0 0 1 10 -10 a12 12 0 0 1 22 5 a8 8 0 0 1 -2 16 H22 a10 10 0 0 1 -4 -11 z" fill="rgba(120,160,200,0.15)" />
          <line x1="24" y1="48" x2="20" y2="58" />
          <line x1="34" y1="48" x2="30" y2="58" />
          <line x1="44" y1="48" x2="40" y2="58" />
        </g>
      </svg>
    );
  }
  if (cloudy) {
    return (
      <svg viewBox="0 0 64 64" width="100%" height="100%">
        <g fill="rgba(180,200,220,0.18)" stroke="var(--accent4)" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="44" cy="22" r="10" fill="rgba(255,220,120,0.22)" stroke="var(--warn)" />
          <path d="M14 42 a10 10 0 0 1 10 -10 a12 12 0 0 1 22 5 a8 8 0 0 1 -2 16 H18 a10 10 0 0 1 -4 -11 z" />
        </g>
      </svg>
    );
  }
  // Clear / sunny
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%">
      <g stroke="var(--warn)" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="32" cy="32" r="11" fill="rgba(255,200,80,0.25)" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          const x1 = 32 + Math.cos(rad) * 17;
          const y1 = 32 + Math.sin(rad) * 17;
          const x2 = 32 + Math.cos(rad) * 24;
          const y2 = 32 + Math.sin(rad) * 24;
          return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
      </g>
    </svg>
  );
}

/* ----------------------------------------------------------------------------
 * UPCOMING CARD
 * -------------------------------------------------------------------------- */
function UpcomingCard({ launches }) {
  const safe = Array.isArray(launches) ? launches : [];
  const rest = safe.slice(1);
  // v39: consolidate same-day rideshare launches (e.g. multiple Jun 29
  // Transporter or Bandwagon payloads merge into one row).
  const groups = useMemo(() => groupRideshare(rest), [rest]);
  const count = groups.length;
  return (
    <div className="ap-card ap-card-upcoming">
      <div className="ap-upcoming-header">
        <span className="ap-card-title" style={{ marginBottom: 0 }}>UPCOMING @ VSFB</span>
        {count > 0 && (
          <span className="ap-upcoming-viewall dim">
            VIEW ALL ({count})
          </span>
        )}
      </div>
      {groups.length === 0 ? (
        <div className="dim" style={{ fontSize: 12 }}>no other launches scheduled</div>
      ) : (
        <div className="ap-upcoming-list">
          {groups.map((g, i) => {
            // v41: NETs more than 40 days out are too unreliable for a
            // precise date on a public kiosk — show TBD instead.
            let month, day;
            if (g.far_out) {
              month = 'TBD';
              day = '';
            } else {
              const d = new Date(g.net);
              month = d.toLocaleDateString('en-US', {
                month: 'short', timeZone: 'America/Los_Angeles',
              }).toUpperCase();
              day = d.toLocaleDateString('en-US', {
                day: '2-digit', timeZone: 'America/Los_Angeles',
              });
            }
            return (
              <div
                key={g.id}
                className={`ap-upcoming-row ${i === 0 ? 'ap-upcoming-row-first' : ''}`}
              >
                <div className={`ap-upcoming-datebox ${g.far_out ? 'ap-upcoming-datebox-tbd' : ''}`}>
                  <span className="ap-upcoming-month">{month}</span>
                  {day && <span className="ap-upcoming-day">{day}</span>}
                </div>
                <div className="ap-upcoming-body">
                  <div className="ap-upcoming-name">
                    {g.display_name}
                    {g.count > 1 && (
                      <span className="ap-upcoming-count" title={`${g.count} related missions`}>
                        ×{g.count}
                      </span>
                    )}
                  </div>
                  <div className="ap-upcoming-meta dim">
                    {g.rocket_name}
                    {g.has_rtls && <ApSbBadge />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ApSbBadge() {
  return (
    <span
      className="ap-sb-badge"
      title="Booster RTLS — sonic boom expected"
    >
      SB
    </span>
  );
}

/* ----------------------------------------------------------------------------
 * QUICK FACT CARD — rotates every ~8 s through buildFacts().
 *
 * Shuffles the pool once per mount so the starting fact varies, then
 * cycles deterministically. If the fact list changes (e.g. booster
 * history resolves and adds dynamic facts), the index resets so the
 * viewer sees the fresh facts promptly.
 * -------------------------------------------------------------------------- */
const ROTATE_MS = 8000;


function QuickFactCard({ facts }) {
  // v37: randomize but never repeat until the pool is exhausted.
  // We keep a shuffled order in state and an index into that order.
  // When the index reaches the end, we reshuffle (ensuring the first
  // card of the new deck isn't the same as the last card shown).
  const [order, setOrder] = useState(() => shuffleIndices(facts.length));
  const [idx, setIdx] = useState(0);

  // If the fact count changes (dynamic facts resolve), reshuffle so
  // every new fact is eligible and we start fresh.
  useEffect(() => {
    setOrder(shuffleIndices(facts.length));
    setIdx(0);
  }, [facts.length]);

  // v48: per-fact dwell time — a fact can opt to pin itself for longer
  // than the default 8s rotation via `dwellMs`. Switched from setInterval
  // to setTimeout so each tick can read the current card's preferred
  // dwell (e.g. the longer GRANDPA/DAD family fact pins for 10s).
  useEffect(() => {
    if (!facts.length) return undefined;
    const currentFactIndex = order[idx] ?? 0;
    const currentFact = facts[currentFactIndex];
    const dwell = currentFact?.dwellMs ?? ROTATE_MS;
    const id = setTimeout(() => {
      setIdx((i) => {
        const next = i + 1;
        if (next >= order.length) {
          const lastShown = order[i];
          const newDeck = shuffleIndices(facts.length, lastShown);
          setOrder(newDeck);
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
    return (
      <div className="ap-card ap-card-fact">
        <div className="ap-card-title">QUICK FACT</div>
        <div className="dim">—</div>
      </div>
    );
  }

  return (
    <div className="ap-card ap-card-fact" key={idx /* re-trigger fade on change */}>
      {/* Reverted from v39: back to the SVG California silhouette. */}
      <div className="ap-ca-map" aria-hidden="true">
        <CaliforniaMap />
      </div>
      <div className="ap-card-title">QUICK FACT</div>
      {/* v43: category eyebrow on top, then the specific headline below.
          Reads like a news ticker — section label first, then the item. */}
      <div className="ap-fact-category dim">&gt; {fact.category}</div>
      <div className="ap-fact-headline accent1">{fact.headline}</div>
      {fact.suffix && <div className="ap-fact-suffix dim">{fact.suffix}</div>}
      <div className="ap-fact-body">{fact.body}</div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * CaliforniaMap — v36 revived per visual-match spec §12. A clean,
 * recognizable California silhouette with the distinctive slanted top
 * edge (Oregon border), the Sierra/Nevada straight east flank, the
 * bottom tilt to Mexico, and the bend around Point Conception.
 *
 * The VSFB marker sits at the correct latitude/longitude-ish position
 * (just north of Point Conception, inland from the coast). Low-contrast
 * fill with a magenta accent for the marker — sits as ambient geography
 * behind the fact text rather than dominating the card.
 * -------------------------------------------------------------------------- */
function CaliforniaMap() {
  // v42: accurate CA outline. Each vertex is a real lat/lon landmark
  // projected linearly onto a 220x300 viewBox (lon: -124.4..-114.1 maps
  // to x: 20..200; lat: 42..32.5 maps to y: 20..280). Going clockwise
  // from the NW corner: top Oregon border, NE kink at Lake Tahoe,
  // diagonal down to the SE tip, Colorado River wobble, Mexico border
  // straight west to Tijuana, up the coast through SD / LA / Conception
  // / Big Sur / SF / Mendocino / Crescent City, close to start.
  //
  // VSFB pin is at (86.9, 219.0) — exactly 34.73°N, 120.57°W, on the
  // actual coastline between Point Conception and Point Sal.
  return (
    <svg
      className="ap-ca-map"
      viewBox="0 0 220 300"
      preserveAspectRatio="xMaxYMid meet"
      aria-hidden="true"
    >
      <path
        className="ap-ca-outline-path"
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
        fill="var(--accent1)"
        fillOpacity="0.18"
        stroke="var(--accent1)"
        strokeOpacity="0.6"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* VSFB marker — pulsing rings precisely at 34.73N, 120.57W */}
      <g>
        <circle cx="86.9" cy="219.0" r="14" fill="none"
          stroke="var(--accent3)" strokeOpacity="0.28" strokeWidth="1" />
        <circle cx="86.9" cy="219.0" r="8" fill="none"
          stroke="var(--accent3)" strokeOpacity="0.7" strokeWidth="1" />
        <circle cx="86.9" cy="219.0" r="3.2" fill="var(--accent3)" />
      </g>
      <text
        x="98"
        y="223"
        fontSize="11"
        fontWeight="800"
        fill="var(--accent3)"
        style={{ letterSpacing: '1.5px' }}
      >
        VSFB
      </text>
    </svg>
  );
}

/* ----------------------------------------------------------------------------
 * HELPERS
 * -------------------------------------------------------------------------- */
function CardRow({ label, value, emphasized = false }) {
  // v45: `emphasized` flags section-header rows (Rocket, Booster) —
  // bolder weight + accent1 color on BOTH label and value so they read
  // as headings for the group of rows beneath them.
  return (
    <div className={`ap-row${emphasized ? ' ap-row-emph' : ''}`}>
      <span className={`ap-row-label${emphasized ? ' accent1' : ' dim'}`}>{label}</span>
      <span className={`ap-row-value${emphasized ? ' accent1' : ''}`}>{value}</span>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * DEGRADED state — no launch to show.
 * -------------------------------------------------------------------------- */
function DegradedAmbientPolished({ weather, ll2Status }) {
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

  return (
    <div className="ambient-polished-grid">
      <div className="ap-hero">
        <div className={copy.tone === 'warn' ? 'warn' : 'accent1'} style={{
          fontSize: 'clamp(18px, 1.6vw + 6px, 32px)',
          fontWeight: 600,
          letterSpacing: 2,
        }}>{copy.title}</div>
        <div className="dim" style={{ marginTop: 8, fontSize: 'clamp(12px, 0.7vw + 5px, 15px)' }}>
          {copy.subtitle}
        </div>
        <div className="accent3" style={{ marginTop: 18, fontSize: 'clamp(12px, 0.6vw + 5px, 14px)' }}>
          &gt; {copy.detail}<span className="blink accent1"> █</span>
        </div>
      </div>
      <div className="ap-bottom-row">
        <WeatherCard weather={weather} view={view} />
      </div>
    </div>
  );
}
