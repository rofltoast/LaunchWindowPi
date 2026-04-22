// All runtime config lives here. Change values, rebuild, ship.
// For the Pi kiosk: ssh in, edit this file, run `npm run build`, refresh.
//
// Runtime overrides via URL query params (NO REBUILD NEEDED):
//   ?forceT=30       → FORCE_T_MINUS_S = 30   (fake countdown starting at T-30s)
//   ?forceT=-60      → FORCE_T_MINUS_S = -60  (drop in at T+1:00)
//   ?mode=live       → FORCE_MODE = 'live'    (jump straight into live view)
//   ?mocks=1         → USE_MOCKS = true       (use bundled mock data)
//   ?forceT=off      → explicitly clear a forced countdown (useful to
//                      leave running after a demo)
//   ?recovery=asds   → force the test-mock demo launch to use droneship
//                      (ASDS) metadata + trajectory. This is ALSO THE
//                      DEFAULT for the demo mock — droneship recoveries
//                      are the common case at VSFB, so the demo should
//                      reflect that unless explicitly overridden.
//   ?recovery=rtls   → force the test-mock demo launch to use RTLS
//                      (booster returns to LZ-4, sonic boom warning).
//   ?webcast=<url>   → override the test-mock launch's webcast URL so
//                      the live webcast iframe actually renders during
//                      demos. Accepts any YouTube URL shape the player
//                      understands: youtu.be/<id>, youtube.com/watch?v=,
//                      youtube.com/live/<id>, youtube.com/embed/<id>.
//                      The video ID is extracted via extractYouTubeId().
//                      If the URL contains a `t=` timestamp, it's
//                      parsed and fed to YouTube as the start= offset
//                      (useful for syncing a past-launch recording to
//                      the demo telemetry — pick the T-0 moment in the
//                      YouTube video, copy the share link, paste it in).
//                      No effect outside demo mode — real live launches
//                      use the webcast URL LL2 publishes.
//   ?start=<sec>     → override webcast start offset in seconds. Useful
//                      as an escape hatch when the URL-encoding dance
//                      for `?webcast=<url>?t=...` is awkward — YouTube
//                      share URLs have a `?` in them, and pasting the
//                      whole thing as a query param value means the
//                      inner `?t=1819s` escapes to a sibling param
//                      rather than being part of the webcast URL.
//                      Pass it separately here: `?start=1819`.
//                      Also accepts YouTube's suffix forms: 30m19s, 1h2m.
//
// This is the path we actually want for ad-hoc demos: Vite tree-shakes
// any branch gated on a build-time-null config value, so URL params are
// the only way to trigger these code paths without rebuilding. The
// `readParam` helper below is opaque to the optimizer so the test-launch
// code stays in the bundle.

const urlParams = (typeof window !== 'undefined' && window.location)
  ? new URLSearchParams(window.location.search)
  : new URLSearchParams();

function paramNumber(name, fallback) {
  const v = urlParams.get(name);
  if (v == null || v === '') return fallback;
  if (/^(off|none|null)$/i.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function paramString(name, fallback) {
  const v = urlParams.get(name);
  if (v == null || v === '') return fallback;
  if (/^(off|none|null)$/i.test(v)) return null;
  return v;
}
function paramBool(name, fallback) {
  const v = urlParams.get(name);
  if (v == null || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

export const CONFIG = {
  // -------------------- Location filter --------------------
  // LL2 location IDs for Vandenberg. 11 = Vandenberg SFB generally.
  // Pads: 157 = SLC-4E, 80 = SLC-6. We filter by location so all pads come through.
  LL2_LOCATION_ID: 11,
  LAUNCH_SITE_COORDS: { lat: 34.6328, lon: -120.6108 },
  LAUNCH_SITE_LABEL: 'vsfb',

  // -------------------- API endpoints --------------------
  // LL2 used to be direct: 'https://ll.thespacedevs.com/2.2.0'. Every
  // client running this page then burned its own 15 req/hr budget and
  // we'd eat 429s with only 2-3 browsers open. We now proxy through nginx
  // on the Pi (server-side cache, 10-min TTL, stampede lock), so every
  // client - iPhone, laptop, kiosk, public tunnel visitor - shares the
  // SAME upstream poller. LL2 sees ~1 request per 10 min regardless of
  // how many browsers are open. See deploy/docker/nginx.conf `/api/ll2/`.
  //
  // The URL is origin-relative, so it works through Cloudflare tunnel,
  // LAN IP, or localhost without any further config. URL override via
  // `?ll2=<url>` is still available for pointing a dev build at a
  // different upstream.
  LL2_BASE: paramString('ll2', '/api/ll2/2.2.0'),
  FLIGHTCLUB_BASE: 'https://api.flightclub.io',
  OPEN_METEO_BASE: 'https://api.open-meteo.com/v1',

  // -------------------- Polling intervals (ms) --------------------
  // Conservative defaults to stay well under rate limits.
  POLL_UPCOMING_MS: 10 * 60 * 1000,        // upcoming launches: baseline every 10 min
  POLL_WEATHER_MS: 15 * 60 * 1000,         // weather: every 15 min
  POLL_LIVE_TELEMETRY_MS: 1000,            // live telemetry: 1 Hz
  POLL_FLIGHTCLUB_SIM_MS: 500,             // flight-club sim tick rate: 2 Hz

  // -------------------- LL2 rate budget --------------------
  // LL2 free tier: ~15 req/hr. Our v25/v26 polling strategy used a binary
  // "10 min baseline, 60 s when NET < 1 hr" cadence — which is fine for
  // a single client but stampedes the upstream under real launch-day
  // conditions (multiple clients + fresh tunnel visitors whose first
  // fetch is a cache miss). Instead, pre-schedule specific poll moments
  // relative to NET. Cadence decreases monotonically as NET approaches
  // and we explicitly RESERVE a T-60 s and T-15 s slot so even if the
  // schedule drifts we still catch a last-minute scrub.
  //
  // Count: 12 polls in the last 70 min before launch. Combined with the
  // 10-min baseline before that, worst-case observed density in any
  // rolling 60-min window is ~13/hr — safely under the LL2 cap.
  //
  // Listed in DESCENDING order because the scheduler does a linear
  // `.find(o => o < secondsToNet)` and wants the largest-offset-not-yet
  // -crossed first.
  LAUNCH_WINDOW_POLL_OFFSETS_S: [
    70 * 60,   // T-70m — enter the pre-scheduled phase
    60 * 60,   // T-60m
    50 * 60,   // T-50m
    40 * 60,   // T-40m
    30 * 60,   // T-30m
    22 * 60,   // T-22m — one poll above the 20-min live-mode boundary
    15 * 60,   // T-15m
    10 * 60,   // T-10m
    6 * 60,    // T-6m
    3 * 60,    // T-3m
    90,        // T-90s
    60,        // T-60s — RESERVED: last chance to catch a scrub with time to react
    15,        // T-15s — RESERVED: final confirmation check before T-0
  ],

  // Quiet zone around T-0 — no LL2 polls from T-15 s to T+60 s. The
  // rocket either lifted off or it didn't; another LL2 query in this
  // window can't give us anything FlightClub + the webcast don't
  // already show, and it only eats budget.
  LAUNCH_QUIET_BEFORE_S: 15,
  LAUNCH_QUIET_AFTER_S: 60,

  // -------------------- Mode switching --------------------
  // When to switch ambient → live:
  LIVE_MODE_PRELAUNCH_S: 20 * 60,          // 20 min before T-0
  LIVE_MODE_POSTLAUNCH_S: 30 * 60,         // stay in live mode 30 min after liftoff
  // After live mode, show "recap" ambient for this long:
  RECAP_DURATION_S: 2 * 60 * 60,

  // -------------------- Display --------------------
  DEFAULT_THEME: 'tokyo-storm',
  // Cycle themes automatically (0 = disabled, else interval in minutes):
  THEME_AUTO_CYCLE_MIN: 0,

  // -------------------- Dev / debug --------------------
  // URL-overridable. Static defaults below; pass ?mocks=1 / ?mode=live /
  // ?forceT=30 to override at runtime without rebuilding.
  USE_MOCKS: paramBool('mocks', false),
  // Force a mode for testing: null | 'ambient' | 'live' | 'recap'
  FORCE_MODE: paramString('mode', null),
  // Simulated T-0 offset in seconds to START at (ticks forward from there).
  // Examples: 30 = T-30s (shows terminal count → liftoff → ascent),
  //           -60 = T+1:00 (drops you mid-ascent, max-Q area),
  //           -180 = T+3:00 (post-MECO, stage separation, SES-1),
  //           null = use real NET from the next launch.
  FORCE_T_MINUS_S: paramNumber('forceT', null),
  // Override the recovery type for the synthetic test-mock launch. Only
  // has any effect when FORCE_T_MINUS_S / FORCE_MODE are active (i.e.
  // we're rendering the test-mock instead of a real launch). Accepts
  // 'rtls' / 'asds' / 'droneship' / 'ocisly'. Null means "use the demo
  // default" — which is ASDS, since droneship recoveries are the
  // typical case at VSFB (most Starlink missions) and the demo should
  // reflect the common path.
  FORCE_RECOVERY: paramString('recovery', null),
  // Override the test-mock launch's webcast URL. Lets the demo preview
  // the real-launch iframe with an actual video instead of the
  // "webcast not yet available" placeholder. No effect in real
  // (non-demo) mode. Accepts any YouTube URL shape.
  FORCE_WEBCAST_URL: paramString('webcast', null),
  // Override the webcast start offset (raw string — parsed by
  // extractYouTubeStart() so `1819`, `1819s`, `30m19s` all work). When
  // set, takes precedence over any `t=` embedded in FORCE_WEBCAST_URL.
  // Lets you sync a past-launch recording to the demo telemetry without
  // fighting URL-encoding of nested query strings.
  FORCE_WEBCAST_START: paramString('start', null),
};

export default CONFIG;
