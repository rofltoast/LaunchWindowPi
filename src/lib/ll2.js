// Launch Library 2 adapter.
// Docs: https://ll.thespacedevs.com/2.2.0/swagger
// Free tier: ~15 req/hr without auth, 225/hr with. We poll at 10min intervals = fine.

import { CONFIG } from './config.js';
import { MOCK_UPCOMING_LAUNCHES } from './mocks.js';

const BASE = CONFIG.LL2_BASE;

/**
 * Fetch upcoming launches for Vandenberg.
 * Returns an array of normalized launch objects.
 */
export async function fetchUpcomingVSFBLaunches({ limit = 20 } = {}) {
  if (CONFIG.USE_MOCKS) return MOCK_UPCOMING_LAUNCHES;

  const params = new URLSearchParams({
    location__ids: String(CONFIG.LL2_LOCATION_ID),
    limit: String(limit),
    mode: 'detailed',
    hide_recent_previous: 'true',
  });
  const url = `${BASE}/launch/upcoming/?${params}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`LL2 upcoming failed: ${res.status}`);
  const json = await res.json();
  return (json.results || []).map(normalizeLaunch);
}

/**
 * Fetch a specific launch by LL2 id, for detailed view.
 */
export async function fetchLaunchById(id) {
  if (CONFIG.USE_MOCKS) return MOCK_UPCOMING_LAUNCHES[0];
  const url = `${BASE}/launch/${id}/?mode=detailed`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`LL2 detail failed: ${res.status}`);
  return normalizeLaunch(await res.json());
}

/**
 * Normalize the (verbose) LL2 response into a shape our UI components use.
 * Any missing field falls back to a safe default.
 */
function normalizeLaunch(raw) {
  const mission = raw.mission || {};
  const rocket = raw.rocket || {};
  const conf = rocket.configuration || {};
  const launchPad = raw.pad || {};
  const launchProvider = raw.launch_service_provider || {};

  // Webcast: LL2 provides vidURLs array, we pick the first YouTube one
  const vidURL = Array.isArray(raw.vidURLs) ? raw.vidURLs : [];
  const webcast = vidURL.find((v) => /youtube|youtu\.be/i.test(v?.url || ''))
    || vidURL[0] || null;

  // Booster landing info. LL2 nests this under rocket.launcher_stage[i].landing.
  // We care about first stage (index 0) — that's what lands at VSFB.
  // RTLS = Return To Launch Site = land landing. At Vandenberg that's LZ-4.
  // Also mark LZ-1 / LZ-2 (Cape Canaveral land pads) as RTLS for correctness,
  // though they don't apply to VSFB launches in practice.
  const stages = rocket.launcher_stage || [];
  const firstStage = stages[0] || null;
  const landingRaw = firstStage?.landing || null;
  const landingLoc = landingRaw?.location || null;
  const landingLocAbbrev = landingLoc?.abbrev || null;
  const landingLocName = landingLoc?.name || null;
  const landingAttempt = Boolean(landingRaw?.attempt);
  // RTLS detection: the land-landing pads. Anything else (OCISLY, JRTI, ASOG)
  // is a droneship recovery out at sea — no audible sonic boom on land.
  const RTLS_PADS = new Set(['LZ-4', 'LZ-1', 'LZ-2']);
  const isRtls = landingAttempt && RTLS_PADS.has(landingLocAbbrev);

  // Booster reuse info. LL2 nests the launcher (booster core) under
  // rocket.launcher_stage[0].launcher, with totals like `flights`,
  // `first_launch_date`, `last_launch_date`. The enclosing
  // launcher_stage also has `launcher_flight_number` (what flight THIS
  // booster is on for this mission — typically flights+1 for a reused
  // core) and `turn_around_time_days` (the gap since the last flight).
  //
  // We surface these so the ambient VEHICLE panel can show reuse stats
  // (B1097 · 8th flight · 31d avg turnaround, etc.). Fastest reuse has
  // to come from the full history list — see fetchBoosterHistory() —
  // because LL2's launcher summary doesn't expose per-flight gaps.
  const launcher = firstStage?.launcher || null;
  const booster = launcher && launcher.serial_number
    ? {
        serial_number: launcher.serial_number || null,
        flights: typeof launcher.flights === 'number' ? launcher.flights : null,
        first_launch_date: launcher.first_launch_date || null,
        last_launch_date: launcher.last_launch_date || null,
        // Per-launch fields on the stage (not the launcher summary):
        launcher_flight_number: typeof firstStage.launcher_flight_number === 'number'
          ? firstStage.launcher_flight_number : null,
        turn_around_time_days: typeof firstStage.turn_around_time_days === 'number'
          ? firstStage.turn_around_time_days : null,
        previous_flight_date: firstStage.previous_flight_date || launcher.last_launch_date || null,
      }
    : null;

  return {
    id: raw.id,
    name: raw.name,
    mission_name: mission.name || raw.name,
    mission_description: mission.description || '',
    mission_type: mission.type || '',
    orbit: mission.orbit?.name || '',
    // Times
    net: raw.net,                     // "no earlier than" time ISO
    window_start: raw.window_start,
    window_end: raw.window_end,
    status: raw.status?.name || 'TBD',
    status_abbrev: raw.status?.abbrev || 'TBD',
    // Rocket
    rocket_name: conf.full_name || conf.name || 'Unknown',
    rocket_family: conf.family || '',
    rocket_variant: conf.variant || '',
    rocket_length_m: conf.length ?? null,
    rocket_diameter_m: conf.diameter ?? null,
    rocket_mass_t: conf.launch_mass ?? null,
    rocket_leo_kg: conf.leo_capacity ?? null,
    rocket_gto_kg: conf.gto_capacity ?? null,
    rocket_thrust_kN: conf.to_thrust ?? null,
    rocket_image: conf.image_url || null,
    // Provider & pad
    provider_name: launchProvider.name || '',
    pad_name: launchPad.name || '',
    pad_location: launchPad.location?.name || '',
    // Mission imagery
    mission_patch: raw.mission_patches?.[0]?.image_url || raw.image || null,
    // Webcast
    webcast_url: webcast?.url || null,
    webcast_type: webcast?.type?.name || webcast?.source || '',
    // Probability & weather
    probability: raw.probability,
    weather_concerns: raw.weather_concerns || '',
    // Booster recovery / landing
    landing_attempt: landingAttempt,
    landing_location_abbrev: landingLocAbbrev,
    landing_location_name: landingLocName,
    is_rtls: isRtls,        // <-- drives sonic-boom warning + SB badge
    // Booster reuse info (null if LL2 doesn't have a launcher core assigned
    // yet — common for launches >1 week out where SpaceX hasn't confirmed
    // the core). Populated via a separate /launch/previous/ fetch for the
    // full flight history (needed to compute fastest reuse / gap stats).
    booster,
    // Raw for debug
    _raw: raw,
  };
}

/**
 * Fetch the full flight history for a specific booster core by serial
 * number. Used to compute per-flight reuse gap stats (fastest turnaround,
 * average turnaround) that LL2's launcher summary fields don't expose
 * directly — we only get `first_launch_date` and `last_launch_date`
 * inline, which gives us an average but not the min gap.
 *
 * The `/launch/previous/?serial_number=<sn>` filter is the only LL2
 * query shape that actually works — trying `launcher__id` or
 * `rocket__launcher_stage__launcher` returns the unfiltered full
 * launch list.
 *
 * Returns an array of ISO datetime strings sorted ASCENDING (oldest
 * first), or null on any failure. Callers should be resilient to the
 * null case — booster-history fetches are best-effort polish, not
 * critical to the ambient page rendering.
 */
export async function fetchBoosterHistory(serialNumber, { limit = 20 } = {}) {
  if (!serialNumber) return null;
  if (CONFIG.USE_MOCKS) return null;
  try {
    const params = new URLSearchParams({
      serial_number: serialNumber,
      limit: String(limit),
      mode: 'list',
    });
    const url = `${BASE}/launch/previous/?${params}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`LL2 booster history ${serialNumber}: ${res.status}`);
      return null;
    }
    const json = await res.json();
    const results = Array.isArray(json.results) ? json.results : [];
    return results
      .map((r) => r.net)
      .filter(Boolean)
      .sort();
  } catch (e) {
    console.warn(`LL2 booster history ${serialNumber} failed:`, e.message);
    return null;
  }
}

/**
 * Given a list of flight datetimes (sorted ascending), compute the
 * min/avg gap in days between consecutive flights. Returns null if
 * there are fewer than 2 flights (no gaps to compute).
 */
export function computeReuseStats(flightDates) {
  if (!Array.isArray(flightDates) || flightDates.length < 2) return null;
  const sorted = [...flightDates].sort();
  const gapsMs = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = new Date(sorted[i - 1]).getTime();
    const cur = new Date(sorted[i]).getTime();
    if (Number.isFinite(prev) && Number.isFinite(cur) && cur > prev) {
      gapsMs.push(cur - prev);
    }
  }
  if (gapsMs.length === 0) return null;
  const minMs = Math.min(...gapsMs);
  const avgMs = gapsMs.reduce((a, b) => a + b, 0) / gapsMs.length;
  return {
    fastest_days: minMs / 86_400_000,
    average_days: avgMs / 86_400_000,
    gap_count: gapsMs.length,
  };
}

/**
 * Pull a YouTube video ID out of a URL. Returns null if not a YouTube URL.
 */
export function extractYouTubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
    if (u.hostname.includes('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      // /live/<id>, /embed/<id>
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'live' || parts[0] === 'embed') return parts[1] || null;
    }
  } catch (e) {}
  return null;
}

/**
 * Parse a YouTube timestamp (the `t=` or `start=` query param) into a
 * number of seconds, suitable for feeding the IFrame player's `start=`
 * param. Returns null if no valid timestamp is present.
 *
 * Accepts every shape YouTube's real URLs produce in the wild:
 *   - bare seconds: `1819`               → 1819
 *   - seconds with unit: `1819s`         → 1819
 *   - minutes+seconds: `30m19s`          → 1819
 *   - hours+minutes+seconds: `1h2m3s`    → 3723
 *   - hours+minutes: `1h30m`             → 5400
 *
 * Works with the `t=` param (share/deep-link URLs) and also with
 * `start=` (embed-player URLs, so round-tripping one of our own URLs
 * stays sane).
 */
export function extractYouTubeStart(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    // YouTube accepts t= on share URLs, start= on embed URLs.
    const raw = u.searchParams.get('t') || u.searchParams.get('start');
    if (!raw) return null;
    // Bare integer: `1819` → 1819s
    if (/^\d+$/.test(raw)) return parseInt(raw, 10);
    // `1h2m3s` / `30m19s` / `1819s` / `30m` / `1h`. Match each unit
    // independently so any combination works.
    const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
    if (!m || (!m[1] && !m[2] && !m[3])) return null;
    const h = parseInt(m[1] || '0', 10);
    const min = parseInt(m[2] || '0', 10);
    const s = parseInt(m[3] || '0', 10);
    return h * 3600 + min * 60 + s;
  } catch (e) {}
  return null;
}
