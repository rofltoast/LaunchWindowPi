/**
 * Narrator clip "slots" — the catalog of recordings the retro slideshow
 * can play.
 *
 * v72: each slide gets SIX takes (1..6) that rotate between visits, so
 * successive cycles never replay the same audio until the 7th time
 * around. Slot IDs are `<base>-<take>`, e.g. `forecast-intro-1`. The
 * count was bumped from 3 → 6 to match the 6-episode skit arc so each
 * episode's cycle has its own distinct narration bed.
 *
 * Cycle (4 slides × 6 takes = 24 total audio slots + 6 skit videos):
 *   1. WEATHER MAP  — forecast-intro-{1..6}
 *   2. NEXT LAUNCH  — launch-intro-{1..6}
 *   3. QUICK FACTS  — facts-intro-{1..6}
 *   4. SIGN-OFF     — sign-off-{1..6}
 *   5. SKIT         — skit-{1..6}  (video, plays once per full cycle)
 *
 * A slot ID is lowercase [a-z0-9-]. The voice-server saves to
 * /data/voice/<id>.mp3 after retro ffmpeg processing. The kiosk plays
 * clips at /voice/<id>.mp3 (proxied via nginx).
 *
 * Rotation: each time the slideshow lands on a slide, the runner
 * increments a per-slide visit counter and plays take
 * (visit % TAKES_PER_SLIDE) + 1. Missing takes are skipped by the
 * runner's fallback logic so Josh can upload a subset and the show
 * still flows.
 */

export const TAKES_PER_SLIDE = 6;

/**
 * UI groups for the admin upload page. Each group corresponds to one
 * slide in the cycle and contains TAKES_PER_SLIDE take-slots so Josh
 * can record multiple variants per slide.
 */
const TAKE_LABELS = Array.from(
  { length: TAKES_PER_SLIDE },
  (_, i) => `Take ${i + 1}`,
);
const makeTakes = (base) =>
  TAKE_LABELS.map((label, i) => ({ id: `${base}-${i + 1}`, label }));

export const SLOT_GROUPS = [
  { id: 'forecast', label: 'Forecast (weather map)', slots: makeTakes('forecast-intro') },
  { id: 'launch',   label: 'Launches',               slots: makeTakes('launch-intro')   },
  { id: 'facts',    label: 'Quick Facts',            slots: makeTakes('facts-intro')    },
  { id: 'signoff',  label: 'Sign-off',               slots: makeTakes('sign-off')       },
];

export const ALL_SLOTS = SLOT_GROUPS.flatMap((g) => g.slots);

/**
 * Fixed slideshow cycle. `slotBase` is the slot ID without the take
 * suffix; the runner picks a take each visit via slotIdForVisit().
 *
 * v71 adds a fifth step — a skit video that plays AFTER sign-off, once
 * per full cycle. The video is picked from SKIT_SLOTS in order
 * (1 → 12 → 1…). `kind: 'skit'` carries no slotBase; the runner uses
 * skitSlotForCycle() with its own cycleCount.
 */
export const CYCLE = [
  { kind: 'weather-map',    slotBase: 'forecast-intro' },
  { kind: 'next-launch',    slotBase: 'launch-intro'   },
  { kind: 'rotating-facts', slotBase: 'facts-intro'    },
  { kind: 'sign-off',       slotBase: 'sign-off'       },
  { kind: 'skit',           slotBase: null             },
];

/**
 * Skit video catalog — 6 "episodes" uploaded via /admin/retro. The
 * skits form a condensed character arc (professional → disgruntled)
 * that plays in order across successive viewings of the show. IDs are
 * `skit-1` through `skit-6`, case-sensitive lowercase (SLOT_RE rules).
 */
export const SKIT_COUNT = 6;
export const SKIT_SLOTS = Array.from({ length: SKIT_COUNT }, (_, i) => ({
  id: `skit-${i + 1}`,
  label: `Episode ${i + 1}`,
  episodeTitle: [
    'Day One',
    'The Groove',
    'First Crack',
    'Wait What',
    'Unqualified and Aware',
    'DGAF Finale',
  ][i],
}));

/**
 * Which skit plays after the N-th full cycle? 0-indexed cycleCount,
 * wraps every SKIT_COUNT cycles.
 */
export function skitSlotForCycle(cycleCount) {
  const idx = ((cycleCount % SKIT_COUNT) + SKIT_COUNT) % SKIT_COUNT;
  return `skit-${idx + 1}`;
}

/** URL the kiosk fetches to play a skit video. The voice-server stores
 *  the original video extension; the endpoint serves the bytes as-is
 *  so the browser picks the correct <video> codec. */
export const skitUrl = (slot) => `/skit/${slot}`;

/**
 * Given a slide's slot base and the zero-indexed visit number, return
 * the full slot ID the runner should play. Rotates 1 → 2 → … →
 * TAKES_PER_SLIDE → 1 …
 */
export function slotIdForVisit(slotBase, visit) {
  if (!slotBase) return null;
  const take = (visit % TAKES_PER_SLIDE) + 1;
  return `${slotBase}-${take}`;
}

/**
 * All possible take IDs for a slide base (e.g. 'forecast-intro' →
 * ['forecast-intro-1', …, 'forecast-intro-6']).
 */
export function takesForBase(slotBase) {
  if (!slotBase) return [];
  return Array.from(
    { length: TAKES_PER_SLIDE },
    (_, i) => `${slotBase}-${i + 1}`,
  );
}

/**
 * Minimum dwell per slide when no narration clip is available, so the
 * show never stalls. Values tuned for the 4-slide cadence.
 */
export const FALLBACK_DWELL_MS = {
  'weather-map':    18000,
  'next-launch':    22000,
  'rotating-facts': 24000,
  'sign-off':        8000,
  // Skit: if the video is missing, we SKIP this step entirely. If it
  // exists, the runner waits for the <video> 'ended' event — this
  // floor is only a safety if the video can't decode.
  'skit':            4000,
};

/** URL the kiosk fetches to play a clip. */
export const clipUrl = (slot) => `/voice/${slot}.mp3`;

/** Central Coast stations for the weather-map slide. lat/lng used for
 * positioning the chips on the <svg> of California. Station codes are
 * the NWS METAR IDs used by /api/nws/stations/<id>/observations/latest.
 *
 * Note: SLO's airport is KSBP (San Luis Obispo County Regional /
 * McChesney Field). KCSL is NOT a valid NWS station — prior versions
 * used it and the SLO temperature chip was permanently blank.
 * Coordinates are the exact station locations from api.weather.gov. */
export const WEATHER_MAP_CITIES = [
  { code: 'KPRB', name: 'Paso Robles',     lat: 35.66941, lng: -120.62912 },
  { code: 'KSBP', name: 'San Luis Obispo', lat: 35.23611, lng: -120.63611 },
  { code: 'KSMX', name: 'Santa Maria',     lat: 34.89408, lng: -120.45212 },
  { code: 'KLPC', name: 'Lompoc',          lat: 34.66667, lng: -120.46667 },
  { code: 'KSBA', name: 'Santa Barbara',   lat: 34.42611, lng: -119.84361 },
];
