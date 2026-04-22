import { useEffect, useState, useMemo, useRef } from 'react';
import { CONFIG } from './lib/config.js';
import { fetchUpcomingVSFBLaunches, fetchBoosterHistory, computeReuseStats } from './lib/ll2.js';
import { fetchWeatherVSFB } from './lib/weather.js';
import { findMissionByLL2Id, fetchSimulation, fetchEvents } from './lib/flightclub.js';
import { pickMockSimulation, pickMockEvents } from './lib/mocks.js';
import { useInterval } from './lib/hooks.js';
import { AmbientView } from './components/AmbientView.jsx';
import { LiveView } from './components/LiveView.jsx';
import { LoadingView } from './components/LoadingView.jsx';
import { AppHeader } from './components/AppHeader.jsx';
import { AppFooter } from './components/AppFooter.jsx';
import { ThemePicker } from './components/ThemePicker.jsx';
import { LayoutPicker, LAYOUT_IDS } from './components/LayoutPicker.jsx';

/**
 * Build the synthetic test-mock launch shown when FORCE_T_MINUS_S /
 * FORCE_MODE is active. Parameterized so both code paths (with vs
 * without a countdown offset) produce the same shape, and so callers
 * can flip the recovery type for previewing different mission profiles.
 *
 * `recovery` normalization:
 *   - 'rtls' (case-insensitive)                           → RTLS profile
 *   - 'asds' / 'droneship' / 'ocisly' / 'jrti'            → ASDS profile
 *   - null / undefined / anything else                    → ASDS profile
 *
 * Default is ASDS because droneship recoveries are the common case at
 * VSFB — almost every Starlink mission from SLC-4E goes downrange to
 * OCISLY. Previewing RTLS is the deliberate opt-in (`?recovery=rtls`).
 *
 * `webcastUrl` overrides the launch's webcast URL so the demo can show a
 * real iframe instead of the "webcast not yet available" placeholder.
 * Null keeps the default behavior (no webcast — mirrors a real launch
 * before SpaceX publishes the YouTube link).
 */
function buildTestMockLaunch({
  netOffsetMs = 0,
  recovery = null,
  webcastUrl = null,
} = {}) {
  // Explicit RTLS opt-in only. Anything else — null, empty string, random
  // value, 'asds', 'ocisly', etc. — falls through to the ASDS default.
  const isRtls = typeof recovery === 'string' && /^rtls$/i.test(recovery);
  const isAsds = !isRtls;
  const baseMissionDesc =
    'A batch of SpaceX Starlink V2-mini satellites bound for the low-Earth-orbit shell ' +
    'of the Starlink megaconstellation. The payload stack is deployed roughly 62 minutes ' +
    'after liftoff. This is a test/demo view of the VSFB Launch Monitor — the telemetry ' +
    'below is a synthetic nominal flight profile, not live data from a real mission.';

  const rtlsBits = {
    mission_description:
      baseMissionDesc +
      ' Booster B1000-DEMO is attempting a Return-To-Launch-Site recovery at ' +
      'Landing Zone 4 just north of SLC-4E, which produces a ground-audible sonic ' +
      'boom over the Lompoc area ~8 minutes after liftoff.',
    landing_attempt: true,
    landing_location_abbrev: 'LZ-4',
    landing_location_name: 'Landing Zone 4',
    is_rtls: true,
  };
  const asdsBits = {
    mission_description:
      baseMissionDesc +
      ' Booster B1000-DEMO is attempting a droneship recovery on Of Course I Still ' +
      'Love You, stationed ~270 km downrange in the Pacific. No sonic boom is expected ' +
      'over land for this flight profile.',
    landing_attempt: true,
    landing_location_abbrev: 'OCISLY',
    landing_location_name: 'Of Course I Still Love You',
    is_rtls: false,
  };
  const recoveryBits = isAsds ? asdsBits : rtlsBits;

  return {
    id: 'test-mock',
    name: isAsds
      ? 'TEST | Mock Falcon 9 (droneship)'
      : 'TEST | Mock Falcon 9 (RTLS)',
    mission_name: isAsds
      ? 'TEST MISSION (VSFB droneship)'
      : 'TEST MISSION (VSFB RTLS)',
    mission_type: 'Communications',
    orbit: 'Low Earth Orbit',
    rocket_name: 'Falcon 9 (test)',
    provider_name: 'TEST',
    pad_name: 'SLC-4E',
    pad_location: 'Vandenberg SFB, CA',
    status: 'Go',
    status_abbrev: 'Go',
    net: new Date(Date.now() + netOffsetMs).toISOString(),
    // Allow the URL override (?webcast=...) to feed the demo iframe with
    // a real video. If none is provided, fall through to a pre-baked
    // default past-launch recording that matches the demo recovery
    // profile — so the webcast panel isn't empty in an out-of-the-box
    // demo and the video roughly lines up with the telemetry.
    //
    // ASDS default: The Space Devs upload of Starlink Group 17-35,
    // a Falcon 9 droneship recovery from VSFB/SLC-4E in 2025. Synced
    // to T-0 via t=632s (liftoff is ~10m32s into the recording).
    // Chosen because it's an embeddable upload (verified via the
    // YouTube oEmbed endpoint) — so it plays in an iframe from any
    // origin, including our LAN HTTP URL.
    //
    // RTLS default: null. We don't have a great embeddable VSFB RTLS
    // recording on hand — if you want to demo RTLS with a real webcast,
    // pass ?webcast=<url> explicitly.
    webcast_url: webcastUrl
      || (isAsds ? 'https://www.youtube.com/watch?v=RCjTNDggSfM&t=632s' : null),
    webcast_type: webcastUrl || isAsds ? 'YouTube' : '',
    ...recoveryBits,
  };
}

// LL2 response cache — seeded into React state on boot so that if LL2 is
// unreachable (rate-limited / 429, network failure, DNS death, etc.) we
// can still render the last-known-good launch data instead of stranding
// the user on the loading screen. TTL is generous (24h) because a stale
// launch list is almost always better than a blank page, and the real
// data refreshes in the background as soon as LL2 answers.
const LL2_CACHE_KEY = 'vsfb-ll2-cache-v1';
const LL2_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function readLl2Cache() {
  try {
    const raw = localStorage.getItem(LL2_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.launches)) return null;
    if (typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > LL2_CACHE_TTL_MS) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function writeLl2Cache(launches) {
  try {
    localStorage.setItem(
      LL2_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), launches })
    );
  } catch (e) { /* quota or private-mode — ignore */ }
}

export default function App() {
  const [theme, setTheme] = useState(
    localStorage.getItem('kiosk-theme') || CONFIG.DEFAULT_THEME
  );
  // Polished layout has its own theme system because its aesthetic (big
  // cinematic gradients, glassy cards, layered photo-like backgrounds)
  // needs hand-tuned palettes rather than the flat-ANSI terminal ones.
  // Persisted independently so flipping Y between layouts keeps each
  // variant's look consistent. v51: default switched to 'midnight-ops'
  // (near-black, minimal chroma, mission-control feel) — the cosmic-dusk
  // navy/magenta default was too warm for the new photo-hero background.
  const [polishedTheme, setPolishedTheme] = useState(
    localStorage.getItem('kiosk-polished-theme') || 'midnight-ops'
  );
  const [themePickerVisible, setThemePickerVisible] = useState(false);
  // Presentation layout: "terminal" keeps the original TUI/bracketed
  // aesthetic; "polished" uses the newer cinematic dashboard look.
  // Orthogonal to both theme and mode — you can mix freely. Persisted
  // in localStorage under `kiosk-layout` so the choice sticks across
  // reloads. Defaults to terminal (the long-standing app identity) if
  // no saved value, or if the saved value is something we don't
  // recognize (forward-compat safety for when we add a 3rd layout).
  const [layout, setLayout] = useState(() => {
    const saved = localStorage.getItem('kiosk-layout');
    return LAYOUT_IDS.includes(saved) ? saved : 'terminal';
  });
  const [layoutPickerVisible, setLayoutPickerVisible] = useState(false);
  // null = not yet fetched (show "LOADING..."), [] = fetched but empty
  // (show "NO UPCOMING LAUNCHES"), [...] = have data.
  //
  // Seeded from localStorage so a 429 on first fetch still shows real
  // (if stale) launch info instead of hanging. `ll2Status` stays
  // 'loading' until the actual fetch resolves, so the loading screen
  // copy is accurate on boot even when we have cached data underneath.
  const [launches, setLaunches] = useState(() => {
    const cache = readLl2Cache();
    return cache ? cache.launches : null;
  });
  // Timestamp (ms) of the last SUCCESSFUL LL2 fetch in this session, OR
  // the savedAt of the cached response if we loaded from cache. Used to
  // drive the "data is N min stale" warning in ambient + live views —
  // so a multi-hour 429 trip (as happened during the Apr 19 scrub) is
  // visible to the user instead of silently counting down on stale net.
  const [lastGoodFetchAt, setLastGoodFetchAt] = useState(() => {
    const cache = readLl2Cache();
    return cache ? cache.savedAt : null;
  });
  const [weather, setWeather] = useState(null);
  const [simulation, setSimulation] = useState(null);
  const [events, setEvents] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState(null);
  // Coarse status for the loading screen to distinguish rate-limits from
  // generic failures vs genuine "nothing scheduled". Possible values:
  //   'loading'      → first fetch hasn't resolved yet
  //   'ok'           → last fetch succeeded
  //   'empty'        → last fetch succeeded but returned zero launches
  //   'rate-limited' → last fetch was HTTP 429 (LL2 free tier: ~15/hr)
  //   'error'        → last fetch failed for any other reason
  const [ll2Status, setLl2Status] = useState('loading');
  // Minimum-show timer for the loading screen. Josh wants the full
  // "bouncing head / 5 quips" animation to be visible every time the
  // app boots or transitions into live mode — even if LL2 answered in
  // 80ms. We gate the AmbientView/LiveView behind this flag for a
  // minimum of LOADER_MIN_MS, then let them render normally.
  const LOADER_MIN_MS = 5500;
  const [loaderGatePassed, setLoaderGatePassed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLoaderGatePassed(true), LOADER_MIN_MS);
    return () => clearTimeout(t);
  }, []);
  // Separate gate for the live-mode handoff: when we transition INTO
  // live mode (real launch or demo), we want to show the loader for a
  // few seconds too, so the "LOADING LIVE VIEW" narrative plays before
  // the telemetry/trajectory pop in. Reset when mode changes to live.
  const [liveGatePassedAt, setLiveGatePassedAt] = useState(null);
  // Actual liftoff timestamp (ms) once detected. Until this is set, tMinus
  // is computed from the scheduled NET; after, from this anchor. Detection
  // logic lives in the upcoming-launch poller and in the `L` hotkey below.
  const [detectedT0, setDetectedT0] = useState(null);
  // Remember the previous NET so we can spot it jumping backward (one of
  // our liftoff-detection signals).
  const prevNetRef = useRef(null);
  // Mirror of the latest head-launch so the adaptive-polling timer can
  // re-read it without being captured by a stale closure.
  const latestLaunchRef = useRef(null);
  // Mirror of detectedT0 so the (mount-once) upcoming-launch poller can
  // read the current value without being re-created on every detection.
  const detectedT0Ref = useRef(null);
  useEffect(() => { detectedT0Ref.current = detectedT0; }, [detectedT0]);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('kiosk-theme', theme);
  }, [theme]);

  // Apply polished-only theme. Scoped under `data-polished-theme` so the
  // polished-layout CSS rules can override the base `data-theme` palette
  // when layout === 'polished'. Doesn't affect terminal layout at all.
  useEffect(() => {
    document.documentElement.setAttribute('data-polished-theme', polishedTheme);
    localStorage.setItem('kiosk-polished-theme', polishedTheme);
  }, [polishedTheme]);

  // Persist + apply layout to the root element so layout-specific CSS
  // rules (e.g. body-level typography tweaks) can key off `data-layout`.
  useEffect(() => {
    document.documentElement.setAttribute('data-layout', layout);
    localStorage.setItem('kiosk-layout', layout);
  }, [layout]);

  // Keyboard shortcuts:
  //   T       = toggle theme picker
  //   1-7     = pick theme
  //   D       = debug cursor
  //   L / ⇧L  = manual liftoff anchor / clear anchor
  //   Y       = toggle layout picker (open/close)
  //   ⇧Y      = cycle to the other layout directly (fast power-user flip)
  // Ignored when typing in a form field so form input isn't eaten.
  useEffect(() => {
    const themes = ['tokyo-storm', 'gruvbox', 'dracula', 'nord', 'matrix', 'catppuccin', 'solarized'];
    // Polished layout has its own palette set. Keep this list in sync
    // with the entries in ThemePicker's POLISHED_THEMES array AND the
    // `[data-polished-theme="..."]` rules in themes.css.
    const polishedThemes = ['cosmic-dusk', 'aurora', 'ember', 'midnight-ops', 'graphite', 'sunrise'];
    function onKey(e) {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 't' || e.key === 'T') setThemePickerVisible((v) => !v);
      if (e.key >= '1' && e.key <= '7') {
        const idx = parseInt(e.key, 10) - 1;
        // When polished layout is active, 1-6 picks from the polished
        // palette set (which has 6 entries). Terminal layout keeps the
        // 7-option set. This is consistent with the picker UI below,
        // which renders whichever palette matches the current layout.
        if (layout === 'polished') {
          if (polishedThemes[idx]) setPolishedTheme(polishedThemes[idx]);
        } else {
          if (themes[idx]) setTheme(themes[idx]);
        }
      }
      if (e.key === 'd' || e.key === 'D') document.body.classList.toggle('debug-cursor');
      if (e.key === 'l') setDetectedT0(Date.now());
      if (e.key === 'L') {
        // Shift+L clears the liftoff anchor. Shift+Y cycles layout.
        // They share the case-sensitive upper branch, so we switch by
        // which key the user actually pressed.
        setDetectedT0(null);
      }
      if (e.key === 'y') setLayoutPickerVisible((v) => !v);
      if (e.key === 'Y') {
        // Shift+Y — cycle directly without opening the picker.
        setLayout((cur) => (cur === 'terminal' ? 'polished' : 'terminal'));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Depend on `layout` so the 1-7 branch routes to the correct theme
    // setter after the user flips layouts via Y/Shift+Y.
  }, [layout]);

  // 1 Hz clock
  useInterval(() => setNow(Date.now()), 1000);

  // Fetch upcoming launches, with adaptive polling + real-time liftoff
  // detection.
  //
  // Polling cadence:
  //   - Within 1 hour of NET, we poll every POLL_UPCOMING_NEAR_MS (60s) so a
  //     last-minute NET slip or liftoff-time update is picked up quickly.
  //   - Otherwise every POLL_UPCOMING_MS (10min), which stays well under
  //     LL2's rate limits.
  //
  // Liftoff detection (see comments inline). Once we detect, `detectedT0`
  // is set and tMinus anchors to reality instead of scheduled NET.
  useEffect(() => {
    let mounted = true;
    let timer = null;
    // When LL2 throttles us (429), back off aggressively. LL2's free tier
    // is ~15 req/hr; it locks us out for up to 10-15 min per trip. We
    // double the wait each consecutive failure (capped at 15 min) and
    // reset to normal on the next success.
    let consecutiveFailures = 0;

    async function load() {
      try {
        // v37: bump upcoming fetch limit so large displays can show more
        // rows — terminal's upcoming list now flexes to fill the box.
        const list = await fetchUpcomingVSFBLaunches({ limit: 20 });
        if (!mounted) return;
        setLaunches(list);
        // Only cache non-empty responses. An empty array is a valid
        // "nothing scheduled" state but not worth replaying as a
        // fallback — if LL2 goes dark after returning zero launches,
        // the degraded view is the right thing to show anyway.
        if (list && list.length > 0) writeLl2Cache(list);
        // Mark data fresh for both empty and non-empty successful
        // responses — even "zero launches" is current intel from LL2.
        setLastGoodFetchAt(Date.now());
        detectLiftoffFromPoll(list[0]);
        setError(null);
        setLl2Status(list.length === 0 ? 'empty' : 'ok');
        consecutiveFailures = 0;
      } catch (e) {
        console.warn('Launch fetch failed:', e.message);
        if (mounted) {
          setError(`LL2: ${e.message}`);
          // Classify the failure. The error message from ll2.js is
          // "LL2 upcoming failed: <status>"; we look for "429" to flag
          // rate-limiting (so the loading screen can tell the user
          // specifically "LL2 RATE LIMIT" instead of generic error).
          const msg = e?.message || '';
          const isRateLimit = /\b429\b/.test(msg);
          setLl2Status(isRateLimit ? 'rate-limited' : 'error');
          // Critical: if this is the FIRST fetch and it failed, flip
          // launches from null → [] so the loading screen transitions
          // out of the initial "LOADING" state into the appropriate
          // failure/empty screen. If we have cached data seeded from
          // localStorage, leave it alone so ambient shows real data.
          setLaunches((prev) => (prev == null ? [] : prev));
          consecutiveFailures += 1;
        }
      } finally {
        if (mounted) timer = setTimeout(load, pickNextDelay(consecutiveFailures));
      }
    }

    // Rate-budgeted poll scheduler (Apr 19 LL2 rate-limit post-mortem).
    //
    // Old design was binary: 10 min normally, 60 s once NET was within
    // 1 hr. That's 60 req/hr per client in the near window — 4x over
    // LL2's 15/hr free-tier budget. Nginx cache usually absorbed most
    // of it, but cache misses from fresh-visitor tunnel traffic on
    // Apr 19 at ~14:10 stampeded LL2 and locked us out for ~40 min
    // while the rocket was scheduled to fly.
    //
    // New design: pre-scheduled offsets from NET
    // (CONFIG.LAUNCH_WINDOW_POLL_OFFSETS_S) with a hard quiet zone
    // around T-0. Polling gets denser as launch approaches but the
    // total fits inside LL2's 15/hr budget even with a cold cache. The
    // reserved T-60 s and T-15 s slots guarantee we catch a late
    // scrub or NET adjustment with enough time for the UI to react.
    //
    // Scheduling rule: `.find(o => o < secondsToNet)` scans the
    // (descending-sorted) offset list and returns the LARGEST offset
    // still strictly less than the current secondsToNet — i.e. "the
    // next one we haven't crossed yet". Capped by the baseline
    // POLL_UPCOMING_MS so ambient-mode idle stays at 10-min cadence
    // regardless of how far the next launch is.
    function pickNextDelay(failures = 0) {
      // On consecutive failures (likely 429 rate limit), back off:
      // 1st fail → 1 min, 2nd → 2 min, 3rd → 4 min, 4th+ → 15 min cap.
      if (failures > 0) {
        const backoff = Math.min(15 * 60_000, 60_000 * Math.pow(2, failures - 1));
        return backoff;
      }

      const head = latestLaunchRef.current;
      const netMs = head?.net ? new Date(head.net).getTime() : null;
      const nowMs = Date.now();

      // No NET known — idle cadence.
      if (netMs == null) return CONFIG.POLL_UPCOMING_MS;
      const secondsToNet = (netMs - nowMs) / 1000;

      // Quiet zone around T-0: don't poll between T-15 s and T+60 s.
      // LL2 has nothing new to tell us here that FlightClub and the
      // webcast don't already show; every request in this window eats
      // budget for nothing.
      //
      // Wake-up time is at secondsToNet == -LAUNCH_QUIET_AFTER_S.
      // Since secondsToNet DECREASES as wall time advances, the delay
      // until wake is (current secondsToNet) - (-QUIET_AFTER_S) =
      // secondsToNet + QUIET_AFTER_S. Add 1 s padding to land safely
      // past the boundary.
      if (
        secondsToNet < CONFIG.LAUNCH_QUIET_BEFORE_S &&
        secondsToNet > -CONFIG.LAUNCH_QUIET_AFTER_S
      ) {
        return Math.max(1000, (secondsToNet + CONFIG.LAUNCH_QUIET_AFTER_S) * 1000 + 1000);
      }

      // Past the quiet zone (post-launch): resume idle cadence. By now
      // either detectedT0 has anchored us to reality or the mode memo
      // has flipped to 'recap'/'ambient'; cheap to keep 10-min polls.
      if (secondsToNet <= -CONFIG.LAUNCH_QUIET_AFTER_S) {
        return CONFIG.POLL_UPCOMING_MS;
      }

      // Find the next scheduled offset we haven't crossed. The
      // offsets array is sorted DESCENDING so `find` returns the
      // largest match — which is the smallest delay, i.e. "the
      // upcoming target closest to now".
      const nextOffset = CONFIG.LAUNCH_WINDOW_POLL_OFFSETS_S.find(
        (o) => o < secondsToNet,
      );
      if (nextOffset == null) {
        // Somehow past every offset without hitting the quiet zone —
        // shouldn't happen given LAUNCH_QUIET_BEFORE_S < smallest
        // offset, but fall through to idle cadence defensively.
        return CONFIG.POLL_UPCOMING_MS;
      }
      const delayMs = (secondsToNet - nextOffset) * 1000;
      // Cap by baseline: if the next offset is further than 10 min
      // away (true outside the ~70-min near window), poll every 10
      // min as usual so we don't wait hours between polls when NET
      // is tomorrow.
      return Math.max(1000, Math.min(CONFIG.POLL_UPCOMING_MS, delayMs));
    }

    // --- Liftoff detection ---
    //
    // Signals, in priority order:
    //   (1) LL2 status flips to an in-flight/terminal state. LL2 uses
    //       statuses like "Launch in Flight", "Launch Successful", or
    //       "Launch Failure" after T-0; we match on status name and
    //       abbreviation substrings.
    //   (2) `net` moved into the past — LL2 often rewrites `net` to the
    //       actual liftoff time shortly after T-0, so if `net <= now`
    //       and status is live, that's our anchor.
    //   (3) `net` jumped backward between polls — earlier version of the
    //       same signal; catches it before the status flip lands.
    //
    // We avoid false positives by requiring `net` to be within 30s of
    // "now" for signal 1. Once set, we don't re-detect; we only REFINE
    // to a more-precise `net` value on subsequent polls.
    function detectLiftoffFromPoll(head) {
      if (!head) return;
      latestLaunchRef.current = head;

      const nowMs = Date.now();
      const netMs = head.net ? new Date(head.net).getTime() : null;
      const prevNet = prevNetRef.current;
      prevNetRef.current = netMs;

      const status = (head.status || '').toLowerCase();
      const abbrev = (head.status_abbrev || '').toLowerCase();
      const isLive =
        /in[\s-]?flight|launch(ing| in progress)|success|partial failure|failure/.test(status) ||
        /succ|fail|tbc|in[\s-]?flight/.test(abbrev);

      // Guard: only detect once, only after we're plausibly near/past NET.
      const t0 = detectedT0Ref.current;
      if (t0 != null) {
        // Scrub-clears-detection defense: if NET has jumped far forward
        // of our anchored detection (>5 min), the launch was almost
        // certainly scrubbed after our detection fired. Clear the
        // anchor so tMinus falls back to the scheduled NET, and the
        // mode memo can re-evaluate (most likely flip back to ambient
        // because new tMinus is now big + positive). Without this
        // guard, the kiosk could stay pinned to a bogus "past" T0
        // across a scrub.
        if (netMs && netMs - t0 > 5 * 60_000) {
          setDetectedT0(null);
          return;
        }
        // Refinement pass: if LL2 has since rewritten `net` to a precise
        // actual T-0, and that value is close to our detection (<60s off),
        // prefer LL2's.
        if (netMs && Math.abs(netMs - t0) < 60_000 && netMs !== t0) {
          setDetectedT0(netMs);
        }
        return;
      }

      // Signal 1: status says live.
      if (isLive && netMs && netMs <= nowMs + 30_000) {
        // Prefer LL2's net (it's been rewritten to actual T-0 shortly after
        // liftoff in the near-launch window); otherwise fall back to "now".
        setDetectedT0(netMs <= nowMs ? netMs : nowMs);
        return;
      }

      // Signal 2/3: net moved backward into the past since last poll.
      if (netMs && prevNet && netMs < prevNet && netMs <= nowMs + 10_000) {
        setDetectedT0(netMs);
      }
    }

    load();
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Fetch weather
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const w = await fetchWeatherVSFB();
        if (mounted) setWeather(w);
      } catch (e) {
        console.warn('Weather fetch failed:', e.message);
      }
    }
    load();
    const interval = setInterval(load, CONFIG.POLL_WEATHER_MS);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // Booster flight history — fetched lazily when the next launch has a
  // confirmed booster core assigned. Used to compute min/avg reuse gap
  // stats for the ambient VEHICLE panel. Keyed by serial number and
  // cached in a session-scoped Map so we don't re-hit LL2 on every poll
  // (booster history is near-static — only changes once every few weeks
  // when the core flies again).
  //
  // Shape: { [serial_number]: { dates: string[], stats: {fastest_days,average_days,gap_count} | null } }
  const [boosterHistory, setBoosterHistory] = useState({});
  const headSerial = launches?.[0]?.booster?.serial_number || null;
  useEffect(() => {
    if (!headSerial) return;
    if (boosterHistory[headSerial]) return; // already fetched
    let mounted = true;
    (async () => {
      const dates = await fetchBoosterHistory(headSerial);
      if (!mounted) return;
      if (!dates) {
        // Don't cache misses — leave the slot empty so we retry next
        // time the serial number is re-selected (e.g. after a reload).
        return;
      }
      const stats = computeReuseStats(dates);
      setBoosterHistory((prev) => ({ ...prev, [headSerial]: { dates, stats } }));
    })();
    return () => { mounted = false; };
  }, [headSerial]);

  const nextLaunch = useMemo(() => {
    const real = (launches && launches[0]) || null;
    // Forced test mode: when FORCE_T_MINUS_S is set, we ALWAYS use the
    // synthetic test launch — even if a real upcoming launch exists.
    // Otherwise the hero would show the real launch's name + NET while
    // only the T-minus number was faked, which is confusing when you're
    // trying to show your dad a fake countdown. FORCE_MODE alone (without
    // FORCE_T_MINUS_S) still falls back to real launches when available,
    // because that's the "force a view mode against real data" knob.
    if (CONFIG.FORCE_T_MINUS_S != null) {
      return buildTestMockLaunch({
        netOffsetMs: CONFIG.FORCE_T_MINUS_S * 1000,
        recovery: CONFIG.FORCE_RECOVERY,
        webcastUrl: CONFIG.FORCE_WEBCAST_URL,
      });
    }
    if (!real && CONFIG.FORCE_MODE) {
      // FORCE_MODE without FORCE_T_MINUS_S and no real launch — still
      // need something for LiveView to render.
      return buildTestMockLaunch({
        netOffsetMs: 0,
        recovery: CONFIG.FORCE_RECOVERY,
        webcastUrl: CONFIG.FORCE_WEBCAST_URL,
      });
    }
    return real;
  }, [launches]);

  // Track when FORCE_T_MINUS_S was set, so it ticks forward from that moment
  // rather than staying frozen at a constant value.
  const [forceStartedAt] = useState(() => Date.now());

  // Time to launch (seconds). Precedence:
  //   1. FORCE_T_MINUS_S (dev/test)
  //   2. detectedT0 — real-time anchor, once we've detected liftoff
  //   3. scheduled NET from LL2
  const tMinus = useMemo(() => {
    if (CONFIG.FORCE_T_MINUS_S != null) {
      const elapsed = (now - forceStartedAt) / 1000;
      return CONFIG.FORCE_T_MINUS_S - elapsed;
    }
    if (detectedT0 != null) return Math.floor((detectedT0 - now) / 1000);
    if (!nextLaunch?.net) return null;
    return Math.floor((new Date(nextLaunch.net).getTime() - now) / 1000);
  }, [nextLaunch, now, forceStartedAt, detectedT0]);

  // If the head launch changes (scrub, different mission), clear the
  // detected anchor so it doesn't leak across missions.
  useEffect(() => {
    setDetectedT0(null);
    prevNetRef.current = null;
  }, [nextLaunch?.id]);

  // How stale is our launch data right now? In ms since last successful
  // LL2 fetch (or the cached `savedAt` from boot). Null if we haven't
  // managed a single good fetch since app start AND there was no cache
  // — which means we're actually on the degraded ambient view anyway.
  // Recomputed on the 1 Hz clock so a "Xm stale" banner ticks without
  // extra state plumbing.
  const dataAgeMs = useMemo(() => {
    if (lastGoodFetchAt == null) return null;
    return Math.max(0, now - lastGoodFetchAt);
  }, [lastGoodFetchAt, now]);
  // Over 20 min without fresh LL2 data = can't trust the countdown or
  // the NET to be current (the Apr 19 scrub went unnoticed because LL2
  // started 429ing right before the rocket was supposed to liftoff).
  const STALE_DATA_THRESHOLD_MS = 20 * 60 * 1000;
  const isDataStale = dataAgeMs != null && dataAgeMs > STALE_DATA_THRESHOLD_MS;

  // Determine mode based on T-minus.
  //
  // STALE-DATA GATE (Apr 19 scrub post-mortem): If our launch data is
  // stale — i.e. we haven't successfully talked to LL2 in >20 min —
  // the tMinus we're computing is off a potentially outdated NET. The
  // rocket might have been scrubbed, rescheduled, or slipped, and we
  // simply don't know about it yet. Auto-flipping into live mode based
  // on an untrusted countdown is exactly what produced the "showing
  // telemetry for a launch that wasn't happening" bug. When stale,
  // stay in ambient — the StaleDataBanner in AmbientView will make it
  // obvious to the kiosk viewer that they need to verify the NET on
  // spacex.com. FORCE_MODE (the demo/debug override) still takes
  // precedence so developer testing of live mode isn't affected.
  const mode = useMemo(() => {
    if (CONFIG.FORCE_MODE) return CONFIG.FORCE_MODE;
    if (tMinus == null) return 'ambient';
    if (isDataStale) return 'ambient';
    if (tMinus > CONFIG.LIVE_MODE_PRELAUNCH_S) return 'ambient';
    if (tMinus > -CONFIG.LIVE_MODE_POSTLAUNCH_S) return 'live';
    if (tMinus > -(CONFIG.LIVE_MODE_POSTLAUNCH_S + CONFIG.RECAP_DURATION_S)) return 'recap';
    return 'ambient';
  }, [tMinus, isDataStale]);

  // Pre-fetch simulation when approaching live mode, or always in forced test mode.
  useEffect(() => {
    const isForced = CONFIG.FORCE_MODE === 'live' || CONFIG.FORCE_T_MINUS_S != null;
    const approachingLive = tMinus != null && tMinus <= CONFIG.LIVE_MODE_PRELAUNCH_S * 3;
    if (!isForced && !approachingLive) return;

    let mounted = true;
    async function load() {
      try {
        // In forced mode (or whenever we're using the synthetic test-mock
        // launch), skip FlightClub entirely and use the bundled mock
        // profile matching the launch's recovery type (RTLS vs ASDS).
        // Avoids a pointless round-trip to api.flightclub.io looking up
        // launchLibraryId=test-mock.
        if (isForced && (!nextLaunch?.id || nextLaunch.id === 'test-mock')) {
          if (mounted) {
            setSimulation(pickMockSimulation(nextLaunch));
            setEvents(pickMockEvents(nextLaunch));
          }
          return;
        }
        if (!nextLaunch?.id) return;
        const missionId = await findMissionByLL2Id(nextLaunch.id);
        // Pass the launch down so the fetch functions can pick an
        // appropriate RTLS/ASDS fallback if FlightClub has no data for
        // this mission (or is unreachable).
        const [sim, evs] = await Promise.all([
          fetchSimulation(missionId, nextLaunch),
          fetchEvents(missionId, nextLaunch),
        ]);
        if (mounted) {
          setSimulation(sim);
          setEvents(evs);
        }
      } catch (e) {
        console.warn('FC pre-fetch failed:', e.message);
      }
    }
    load();
    return () => { mounted = false; };
  }, [nextLaunch?.id, mode, tMinus]);

  // --- Loader gates ---
  // The bouncing-head loader must be on screen for a minimum of
  // LOADER_MIN_MS whenever the user hits a "transition" state, so they
  // always see the animation play through instead of flashing content.
  // Two transitions count:
  //   1. App boot: show loader for LOADER_MIN_MS from mount.
  //   2. Entering live mode: whenever mode becomes 'live' (demo URL
  //      load, real pre-launch window crossing, etc.), show the loader
  //      for another LOADER_MIN_MS.
  //
  // Track whether we've ever resolved the live-mode gate for the CURRENT
  // continuous stretch of live mode. Reset whenever we leave live. This
  // handles the "page loaded directly into ?forceT=30 live mode" case —
  // on the very first render mode is already 'live' but we still haven't
  // shown the loader, so the gate is un-resolved.
  const liveGateTimerRef = useRef(null);
  useEffect(() => {
    if (mode === 'live' && liveGatePassedAt == null && liveGateTimerRef.current == null) {
      // Either freshly entered live, or mounted directly in live. Start
      // the gate timer exactly once until mode leaves live.
      liveGateTimerRef.current = setTimeout(() => {
        setLiveGatePassedAt(Date.now());
        liveGateTimerRef.current = null;
      }, LOADER_MIN_MS);
    }
    if (mode !== 'live') {
      // Leaving live — reset so a future re-entry triggers a new gate.
      if (liveGateTimerRef.current != null) {
        clearTimeout(liveGateTimerRef.current);
        liveGateTimerRef.current = null;
      }
      setLiveGatePassedAt(null);
    }
    return () => {
      // Component unmount safety (not normally hit for the top-level App
      // but keeps the invariant clean if we ever lift App elsewhere).
      if (liveGateTimerRef.current != null) {
        clearTimeout(liveGateTimerRef.current);
        liveGateTimerRef.current = null;
      }
    };
  }, [mode, liveGatePassedAt]);

  // Effective loader: show if either gate is still active.
  const showLoader = !loaderGatePassed ||
    (mode === 'live' && liveGatePassedAt == null);
  // Copy for the loader: if the boot gate is still running, defer to
  // ll2Status (LOADING / NO UPCOMING / RATE LIMITED / etc.). Once the
  // boot gate has passed and we're showing the loader because we're
  // entering live, use the bespoke 'entering-live' state.
  const loaderStatus = (!loaderGatePassed) ? ll2Status : 'entering-live';

  return (
    <div className="app">
      <AppHeader now={now} mode={mode} nextLaunch={nextLaunch} />
      <main className="app-main">
        {showLoader ? (
          <LoadingView ll2Status={loaderStatus} />
        ) : mode === 'live' ? (
          <LiveView
            launch={nextLaunch}
            simulation={simulation}
            events={events}
            tMinus={tMinus}
            isDataStale={isDataStale}
            dataAgeMs={dataAgeMs}
            ll2Status={ll2Status}
            layout={layout}
          />
        ) : (
          <AmbientView
            launch={nextLaunch}
            launches={launches}
            weather={weather}
            tMinus={tMinus}
            mode={mode}
            ll2Status={ll2Status}
            isDataStale={isDataStale}
            dataAgeMs={dataAgeMs}
            boosterHistory={boosterHistory}
            layout={layout}
          />
        )}
      </main>
      <AppFooter now={now} error={error} mode={mode} />
      <ThemePicker
        theme={theme}
        setTheme={setTheme}
        polishedTheme={polishedTheme}
        setPolishedTheme={setPolishedTheme}
        layout={layout}
        visible={themePickerVisible}
      />
      <LayoutPicker
        layout={layout}
        setLayout={setLayout}
        visible={layoutPickerVisible}
      />
    </div>
  );
}
