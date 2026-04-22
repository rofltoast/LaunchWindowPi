import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CYCLE, FALLBACK_DWELL_MS, SKIT_COUNT, SKIT_SLOTS, TAKES_PER_SLIDE, skitSlotForCycle, skitUrl, takesForBase } from '../../retro/lib/slots.js';
import { useNarration } from '../../retro/lib/useNarration.js';
import { useRetroData } from '../../retro/lib/useRetroData.js';
import joshHeadUrl from '../../assets/josh-head.png';
import '../../retro/styles/retro.css';

/* v76 — Metal Gear Solid "codec call" portrait cards. One portrait per
 * (slide, episode) pair, so each narration line has its own reaction
 * face. Cards slide in from the right when the clip starts and slide
 * out when it ends, with a soft green glow for the classic codec vibe.
 *
 * The four non-skit CYCLE steps map to slides 1..4 in this order:
 *   weather-map → 1
 *   next-launch → 2
 *   rotating-facts → 3
 *   sign-off → 4
 * The episode (1..6) is driven by cycleCountRef — same counter that
 * picks the skit after sign-off, so the portrait matches the arc of
 * the upcoming (or just-finished) skit.
 */
const SLIDE_KIND_TO_ROW = {
  'weather-map': 1,
  'next-launch': 2,
  'rotating-facts': 3,
  'sign-off': 4,
};

function portraitUrl(slide, episode) {
  if (!slide || !episode) return null;
  return `/portraits/portrait-s${slide}-e${episode}.png`;
}

const BED_URL = '/audio/retro-loop.mp3';
const POST_CLIP_GAP_MS = 4000;   // silence after a narration clip finishes
const NO_CLIP_BEAT_MS  = 1500;   // short beat when a clip is missing
const FACT_ROTATE_MS   = 8000;   // facts slide: each fact dwells ~8s
const FACTS_PER_VISIT  = 3;      // show 3 facts before moving on

// Minimum time any slide stays on screen — keeps the show from
// sprinting through when narration clips are short. Sign-off gets
// extra time as a breather between cycles.
const MIN_SLIDE_MS      = 15000; // every slide at least 15s
const SIGN_OFF_HOLD_MS  = 30000; // sign-off: 30s before restarting cycle

function formatTminus(targetIso) {
  if (!targetIso) return '';
  const ms = new Date(targetIso).getTime() - Date.now();
  if (Number.isNaN(ms)) return '';
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  const sign = ms >= 0 ? 'T-' : 'T+';
  if (d > 0) return `${sign}${d}d ${String(h).padStart(2, '0')}h`;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatPrettyDate(iso) {
  if (!iso) return 'TBD';
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
  } catch { return iso; }
}

export default function RetroApp() {
  const { weather, launches, facts } = useRetroData();
  const { begin, play, duck, attachVideoGain, debugLog } = useNarration(BED_URL);

  // Per-skit gain map, keyed by slot id. Refreshed once at mount from
  // /skit-api/list so the Admin can change levels without requiring a
  // kiosk reload. If the fetch fails we fall back to gain=1 (unchanged).
  const skitGainsRef = useRef({});
  useEffect(() => {
    let cancelled = false;
    const load = () => fetch('/skit-api/list', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { skits: [] })
      .then((j) => {
        if (cancelled) return;
        const next = {};
        for (const s of (j.skits || [])) next[s.slot] = Number(s.gain) || 1;
        skitGainsRef.current = next;
      })
      .catch(() => {});
    load();
    // Poll every 2 minutes so a gain tweak from /admin/retro propagates
    // without needing a kiosk reload. Cheap call.
    const iv = setInterval(load, 120000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);
  // ?debug=1 reveals an on-screen log of the last few narration-clip
  // fires. Useful to see AT A GLANCE whether the right slot is
  // actually being played for each slide.
  const showDebug = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === '1';
  const [gated, setGated] = useState(true);
  const [cursor, setCursor] = useState(0); // index into CYCLE
  const [activeSkitSlot, setActiveSkitSlot] = useState(null); // which skit is currently rendering
  // v76 — portrait "codec call" state. When a narration clip plays we
  // set this to { slide: 1..4, episode: 1..6 } and clear it when the
  // clip ends. The <CodecPortrait> component reads this and animates
  // in/out just like MGS. v77: feature is dormant — the component is
  // intentionally not mounted for now, but we keep the state + the
  // runner wiring so flipping it back on is a one-liner.
  // eslint-disable-next-line no-unused-vars
  const [activePortrait, setActivePortrait] = useState(null);
  const runningRef = useRef(false);
  const playRef  = useRef(play);
  const duckRef  = useRef(duck);
  const startedRef = useRef(false); // absolute one-shot for the runner
  // Per-slide visit counter — each time the runner lands on slide `i`
  // we pick take (visit[i] % 3) + 1 so the three recorded variants
  // rotate across successive viewings.
  const visitCountsRef = useRef(CYCLE.map(() => 0));
  // v71: cycle counter increments each time we hit the skit step. Used
  // to pick skit-1 … skit-12 in order across successive cycles.
  const cycleCountRef = useRef(0);
  // playSkitRef — the runner calls this to ask the active <SkitSlide>
  // to start its video and resolve when it ends (or errors / times out).
  // Returns { played: bool, durationMs: number } so the runner can
  // decide whether to skip the step.
  const playSkitRef = useRef(null);

  // Keep playRef in sync so the async runner always calls the latest
  // play callback without needing it in deps (deps would re-fire the
  // effect and re-enter play()). Cursor no longer needs a ref — the
  // runner tracks its own index locally.
  useEffect(() => { playRef.current = play; }, [play]);
  useEffect(() => { duckRef.current = duck; }, [duck]);

  const step = CYCLE[cursor];
  const nextLaunch = launches[0] || null;

  // Live clock
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Slideshow runner — starts once the user clicks BEGIN BROADCAST
  // (needed for the browser autoplay gate). Audio is ALWAYS on after
  // that; there's no mute toggle.
  //
  // Two guards:
  //  1. `startedRef` is an absolute one-shot so if React re-runs this
  //     effect (StrictMode remount, HMR, dep-identity change) the
  //     runner body still only runs once per component lifetime.
  //  2. The `i` index that drives the loop is a LOCAL variable, NOT a
  //     ref backed by state. State-derived refs update on the
  //     post-commit effect pass, which is too late for the next
  //     iteration of an async while-loop — so the previous design
  //     could replay the same slide's clip twice before the ref saw
  //     the incremented cursor. Local `i` eliminates that race.
  useEffect(() => {
    if (gated) return undefined;
    if (startedRef.current) return undefined;
    startedRef.current = true;
    runningRef.current = true;
    let cancelled = false;

    async function run() {
      // IMPORTANT: index is a LOCAL variable. The old design read
      // cursorRef.current at the top of each iteration, but the ref
      // is synced from state via a useEffect — which runs after the
      // commit phase. By then the loop's next iteration has already
      // started. So setCursor(next) + read cursorRef.current could
      // still see the old value, and we'd replay the same slot for
      // the same slide. That's exactly the double-play the ?debug=1
      // overlay showed. Keeping the index local eliminates the
      // state→ref timing race entirely. setCursor is still called,
      // but only so React re-renders the correct slide.
      let i = 0;
      while (!cancelled) {
        const s = CYCLE[i];

        // ---- v71 skit step — plays a video instead of a narration clip.
        //      We call the SkitSlide through playSkitRef; if the video
        //      is missing the call returns quickly and we skip the dwell.
        if (s.kind === 'skit') {
          const cycle = cycleCountRef.current;
          const slot = skitSlotForCycle(cycle);
          cycleCountRef.current = cycle + 1;
          // Mark which skit slot is now active so <SkitSlide> can
          // render its <video src=...>. Useful even if playback fails
          // — the overlay briefly shows the slot.
          setActiveSkitSlot(slot);

          // Wait a tick for React to commit so the video element
          // exists before we ask it to play.
          await new Promise((r) => setTimeout(r, 50));
          // Duck the music bed so the skit's dialogue isn't fighting
          // the jazz. Unduck whether it played or not.
          try { duckRef.current?.(true); } catch {}
          const fn = playSkitRef.current;
          const result = fn ? await fn(slot) : { played: false, durationMs: 0 };
          try { duckRef.current?.(false); } catch {}

          // Clear active skit so the SkitSlide unmounts <video>,
          // releasing the network connection.
          setActiveSkitSlot(null);

          if (!result.played) {
            // No video on the server for this slot — skip the step
            // entirely and advance to the next slide. A tiny beat so
            // the empty skit frame isn't jarring.
            await new Promise((r) => setTimeout(r, 300));
          } else {
            // Small breath after the video finishes.
            await new Promise((r) => setTimeout(r, POST_CLIP_GAP_MS));
          }

          if (cancelled) return;
          i = (i + 1) % CYCLE.length;
          setCursor(i);
          continue;
        }

        const visit = visitCountsRef.current[i] || 0;
        visitCountsRef.current[i] = visit + 1;

        // v76 — figure out which portrait to show while this clip
        // plays. slide is determined by step kind; episode is driven
        // by the same cycle counter that picks the next skit, so the
        // portrait's mood matches the arc of this episode.
        const slideNum = SLIDE_KIND_TO_ROW[s.kind] || null;
        const episodeNum = slideNum
          ? (cycleCountRef.current % SKIT_COUNT) + 1
          : null;

        // Try the rotated take first; if missing, walk forward through
        // the sibling takes (wrapping) so we still play *something* as
        // long as at least one take exists. Keeps rotation fresh when
        // Josh has uploaded a full set, and graceful when he hasn't.
        const startedAt = Date.now();
        let played = false;
        if (s.slotBase) {
          const siblings = takesForBase(s.slotBase);
          for (let k = 0; k < TAKES_PER_SLIDE; k += 1) {
            const idx = (visit + k) % TAKES_PER_SLIDE;
            const slotId = siblings[idx];
            // Show portrait right before the clip starts so the
            // slide-in animation lines up with the first syllable.
            if (slideNum && episodeNum) {
              setActivePortrait({ slide: slideNum, episode: episodeNum });
            }
            // eslint-disable-next-line no-await-in-loop
            const ok = await playRef.current(slotId);
            if (ok) { played = true; break; }
            // If that take didn't exist, pull the portrait back and
            // we'll try the next sibling on the next loop iteration.
            setActivePortrait(null);
          }
        }
        // Clip is done (or all takes missing) — slide portrait out.
        setActivePortrait(null);
        const elapsed = Date.now() - startedAt;

        const floor = FALLBACK_DWELL_MS[s.kind] ?? MIN_SLIDE_MS;
        let minTotal;
        if (s.kind === 'sign-off') {
          minTotal = SIGN_OFF_HOLD_MS;
        } else if (s.kind === 'rotating-facts') {
          minTotal = Math.max(floor, FACTS_PER_VISIT * FACT_ROTATE_MS, MIN_SLIDE_MS);
        } else {
          minTotal = Math.max(floor, MIN_SLIDE_MS);
        }

        const postGap = played ? POST_CLIP_GAP_MS : NO_CLIP_BEAT_MS;
        const dwell = Math.max(postGap, minTotal - elapsed);
        if (dwell > 0) await new Promise((r) => setTimeout(r, dwell));

        if (cancelled) return;
        i = (i + 1) % CYCLE.length;
        setCursor(i); // render the new slide; loop doesn't depend on this
      }
    }
    run().catch((e) => console.warn('[retro] loop error:', e));
    return () => { cancelled = true; runningRef.current = false; };
  }, [gated]);

  async function onBegin() {
    await begin();
    setGated(false);
  }

  // Crawl content — hard news mixed with silly one-liners. The silly
  // lines are a curated pool; we rotate which 3 are mixed in each
  // render pass (memoized per-minute so it doesn't thrash).
  const sillyLines = useMemo(() => {
    const pool = SILLY_STATUS_LINES;
    const arr = [...pool];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, 4);
    // We intentionally re-shuffle when the minute rolls over so the
    // kiosk doesn't show the same 4 quips forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(now.getTime() / 60000)]);

  // Crawl is a mix of REAL info (colored) and SILLY asides (greyed). Each
  // entry carries a `kind` tag: 'brand' / 'news' / 'data' / 'silly'. The
  // <Crawl> component colors them accordingly so the silly lines read as
  // the tongue-in-cheek asides they are, and the real info pops.
  const crawlItems = useMemo(() => {
    const bits = [];
    bits.push({ kind: 'brand', text: 'VSFB-TV RETRO' });
    if (nextLaunch) {
      bits.push({ kind: 'news', text: `NEXT UP: ${(nextLaunch.mission_name || nextLaunch.name || 'TBD').toUpperCase()}` });
      bits.push({ kind: 'news', text: `VEHICLE: ${(nextLaunch.rocket_name || 'UNKNOWN').toUpperCase()}` });
      bits.push({ kind: 'news', text: `${formatPrettyDate(nextLaunch.net).toUpperCase()}` });
    }
    const klpc = weather.current;
    if (klpc?.tempF != null) bits.push({ kind: 'data', text: `LOMPOC ${Math.round(klpc.tempF)}°F` });
    // Sprinkle the silly lines between real items so they read as asides.
    bits.push({ kind: 'silly', text: sillyLines[0] });
    bits.push({ kind: 'brand', text: 'STAY TUNED' });
    bits.push({ kind: 'silly', text: sillyLines[1] });
    if (sillyLines[2]) bits.push({ kind: 'silly', text: sillyLines[2] });
    if (sillyLines[3]) bits.push({ kind: 'silly', text: sillyLines[3] });
    return bits.filter((b) => b && b.text);
  }, [nextLaunch, weather.current, sillyLines]);

  return (
    <div className="rt-app">
      <div className="rt-frame rt-wobble">
        <header className="rt-header">
          <div className="rt-logo">
            VSFB-TV RETRO
            <small>CENTRAL COAST · ALL DAY</small>
          </div>
          <div className="rt-clock">
            {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
            <span className="rt-date">{now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}</span>
          </div>
        </header>

        <div className="rt-stage">
          <WeatherMapSlide    active={step.kind === 'weather-map'}    cities={weather.cities} updatedAt={weather.updatedAt} />
          <NextLaunchSlide    active={step.kind === 'next-launch'}    launches={launches} />
          <RotatingFactsSlide active={step.kind === 'rotating-facts'} facts={facts} perCycleMs={FACT_ROTATE_MS} perCycleCount={FACTS_PER_VISIT} />
          <SignOffSlide       active={step.kind === 'sign-off'} />
          <SkitSlide
            active={step.kind === 'skit'}
            slot={activeSkitSlot}
            registerPlay={(fn) => { playSkitRef.current = fn; }}
            getGain={(s) => skitGainsRef.current[s] ?? 1}
            attachVideoGain={attachVideoGain}
          />
          {/* v77 — codec portrait is DORMANT. The runner still tracks
              activePortrait state and the component is kept in the
              codebase so it's a one-line flip to re-enable. For now
              we just don't mount it so nothing appears on screen. */}
          {/* <CodecPortrait portrait={activePortrait} /> */}
        </div>
      </div>

      <Crawl items={crawlItems} />

      <div className="rt-scanlines" aria-hidden="true" />
      <div className="rt-tracking"  aria-hidden="true" />
      <div className="rt-crt"       aria-hidden="true" />

      {gated && (
        <div className="rt-gate">
          <button type="button" onClick={onBegin}>▶ BEGIN BROADCAST</button>
        </div>
      )}

      {showDebug && debugLog && debugLog.length > 0 && (
        <div className="rt-debug-audio">
          <strong>LAST NARRATION CLIPS</strong>
          {debugLog.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
    </div>
  );
}

/* ---------- Silly ticker lines ---------- */

// Curated pool of goofy status updates that get mixed into the crawl
// alongside the real news. Keep them short (< 45 chars), retro-TV
// voice, and safe for the kiosk to display on a loop forever.
const SILLY_STATUS_LINES = [
  'COFFEE STATUS · BREWING',
  'SEAGULL ADVISORY · MILD',
  'COYOTE ON PAD ROAD · LOW PRIORITY',
  'MARINE LAYER · RUDE',
  'PARKING LOT TUMBLEWEEDS · TWO',
  'HIGHWAY 1 VIBES · CHILL',
  'FOG THICKNESS · PEA SOUP',
  'CORMORANT COUNT · UNCOUNTABLE',
  'STATION MORALE · SURPRISINGLY HIGH',
  'SONIC BOOM FORECAST · EVENTUALLY',
  'STRANGE CLOUD · BEING INVESTIGATED',
  'RACCOON NEAR GATE · NOT A SPY',
  'JAZZ CONFIDENCE · EXTREMELY HIGH',
  'NAP INDEX · ELEVATED',
  'TACO TRUCK ETA · SOON',
  'BATTERIES · MOSTLY CHARGED',
  'MOON PHASE · YES',
  'SNACK DRAWER · RESTOCKED',
  'BURRITO STATUS · WARM',
  'WIND OF CHANGE · LIGHT BREEZE',
  'RADIO STATIC · NOSTALGIC',
];

/* ---------- Slides ---------- */

function Slide({ active, title, children }) {
  return (
    <section className={`rt-slide ${active ? 'rt-slide-on' : ''}`} aria-hidden={!active}>
      <div className="rt-slide-title">{title}</div>
      {children}
    </section>
  );
}

/* Weather map — Central Coast (~5 cities) on an accurate SVG California
 * silhouette. Each city chip shows name + current temp. Positions are
 * computed by mapping lat/lng into the SVG viewBox using a plate-carree
 * (equirectangular) projection corrected for the mid-latitude cos(lat)
 * longitude compression so the map isn't visibly stretched. */
function WeatherMapSlide({ active, cities, updatedAt }) {
  // Viewbox covers the Central Coast with enough headroom to show
  // Point Conception's east-west dogleg AND room for chip labels.
  // Bounds:  35.9N..34.15N,  -121.20W..-119.30W
  const VB_W = 1200, VB_H = 800;
  const LAT_MAX = 35.95, LAT_MIN = 34.15;
  const LNG_MIN = -121.20, LNG_MAX = -119.30;
  // Correct longitude scale for mid-latitude (~35°N -> cos ~0.82) so
  // the coast's aspect ratio looks right, not stretched.
  const COS_LAT = Math.cos(((LAT_MAX + LAT_MIN) / 2) * Math.PI / 180);
  const lonRange = (LNG_MAX - LNG_MIN) * COS_LAT;
  const latRange = (LAT_MAX - LAT_MIN);
  // Fit within VB while preserving aspect.
  const scale = Math.min(VB_W / lonRange, VB_H / latRange);
  const mapW = lonRange * scale;
  const mapH = latRange * scale;
  const xOff = (VB_W - mapW) / 2;
  const yOff = (VB_H - mapH) / 2;
  const project = (lat, lng) => {
    const x = xOff + ((lng - LNG_MIN) * COS_LAT) * scale;
    const y = yOff + (LAT_MAX - lat) * scale;
    return { x, y };
  };

  // Precompute positions for labelled geographic anchors used to draw
  // the coastline. These coordinates come from real lat/lng of
  // recognizable coastal points — NOT hand-drawn pixels.
  // Tracing the coast from north to south:
  //   Piedras Blancas Light (35.666, -121.283)
  //   Cambria                 (35.566, -121.099)
  //   San Simeon Point        (35.650, -121.190)
  //   Cayucos                 (35.442, -120.899)
  //   Morro Bay / Morro Rock  (35.370, -120.866)
  //   Montana de Oro          (35.270, -120.883)
  //   Avila Beach             (35.180, -120.732)
  //   Pismo Beach             (35.140, -120.641)
  //   Oceano/Nipomo Dunes     (35.060, -120.630)
  //   Guadalupe Dunes         (34.970, -120.640)
  //   Point Sal               (34.903, -120.663)
  //   Purisima Point          (34.755, -120.642)
  //   Vandenberg (SLC-4)      (34.632, -120.611)
  //   Point Arguello          (34.577, -120.648)
  //   Point Conception        (34.449, -120.472)   <-- dogleg: coast turns east
  //   Gaviota                 (34.472, -120.229)
  //   El Capitan              (34.460, -120.024)
  //   Goleta Point            (34.401, -119.850)
  //   Santa Barbara Point     (34.398, -119.700)
  //   Carpinteria             (34.399, -119.518)
  //   Rincon Point            (34.374, -119.477)
  //   Ventura coast (east)    (34.280, -119.300)
  const coast = [
    [35.950, -121.350], // extend NW off-screen
    [35.900, -121.320], // offshore
    [35.666, -121.283], // Piedras Blancas
    [35.650, -121.190], // San Simeon Point
    [35.566, -121.099], // Cambria
    [35.480, -120.990], // Cayucos north
    [35.442, -120.899], // Cayucos
    [35.370, -120.866], // Morro Rock
    [35.270, -120.883], // Montana de Oro
    [35.180, -120.732], // Avila
    [35.140, -120.641], // Pismo
    [35.060, -120.630], // Oceano dunes
    [34.970, -120.640], // Guadalupe dunes
    [34.903, -120.663], // Point Sal
    [34.755, -120.642], // Purisima Pt
    [34.632, -120.611], // Vandenberg SLC-4
    [34.577, -120.648], // Point Arguello
    [34.449, -120.472], // Point Conception (dogleg)
    [34.472, -120.229], // Gaviota
    [34.460, -120.024], // El Capitan
    [34.410, -119.850], // Goleta Pt
    [34.398, -119.700], // Santa Barbara Pt
    [34.399, -119.518], // Carpinteria
    [34.374, -119.477], // Rincon Pt
    [34.280, -119.300], // SE off-screen
  ];
  // Close the land polygon back along the top/right of the viewBox so
  // everything inland of the coast fills as land.
  const coastPts = coast.map(([lat, lng]) => project(lat, lng));
  const landPath = [
    `M ${coastPts[0].x.toFixed(1)},${coastPts[0].y.toFixed(1)}`,
    ...coastPts.slice(1).map(p => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    // close along right edge and top back to start
    `L ${VB_W},${coastPts[coastPts.length - 1].y.toFixed(1)}`,
    `L ${VB_W},0`,
    `L 0,0`,
    `L 0,${coastPts[0].y.toFixed(1)}`,
    'Z',
  ].join(' ');

  // Santa Ynez mountain range — runs roughly E-W along 34.55°N
  // between Point Arguello (120.65W) and Ojai (119.30W).
  const ynezPts = [
    [34.58, -120.50],
    [34.56, -120.25],
    [34.53, -120.00],
    [34.52, -119.75],
    [34.54, -119.55],
    [34.52, -119.35],
  ].map(([lat, lng]) => project(lat, lng));
  const ynezPath = ynezPts.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`
  ).join(' ');

  // Offshore Channel Islands — real coastline vertices traced from
  // lat/lng of actual headlands & capes rather than centered ellipses.
  // Santa Rosa Island is ~15mi × 10mi; Santa Cruz Island is ~22mi × 6mi
  // with a pronounced isthmus on its north shore.
  const santaRosaOutline = [
    [34.030, -120.285], // Carrington Pt (NW tip)
    [34.024, -120.230],
    [34.010, -120.168], // Skunk Pt (NE corner)
    [33.985, -120.117],
    [33.942, -120.066], // East Pt (east tip)
    [33.898, -120.068],
    [33.875, -120.118], // South Pt
    [33.877, -120.205],
    [33.905, -120.275],
    [33.948, -120.328], // Ford Pt (SW lobe)
    [33.976, -120.379],
    [34.006, -120.370], // Brockway Pt (west)
    [34.028, -120.330],
  ];
  const santaCruzOutline = [
    [34.060, -119.917], // Diablo Pt (NW)
    [34.053, -119.863],
    [34.063, -119.810], // Prisoners Harbor
    [34.050, -119.753], // isthmus dip
    [34.058, -119.690],
    [34.050, -119.635], // Chinese Harbor
    [34.030, -119.568], // Scorpion Anchorage (NE)
    [33.998, -119.542], // San Pedro Pt (east tip)
    [33.972, -119.598],
    [33.955, -119.665],
    [33.963, -119.735], // Gull Island / south
    [33.940, -119.800],
    [33.944, -119.867],
    [33.976, -119.925], // Punta Arena (SW)
    [34.020, -119.938],
  ];
  // Deliver both outlines as SVG-ready path data, clipped so the south
  // lobes don't extend below the viewBox.
  const islandPath = (pts) => pts
    .map(([lat, lng]) => project(lat, lng))
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${Math.min(p.y, VB_H - 8).toFixed(1)}`)
    .join(' ') + ' Z';
  const santaRosaPath = islandPath(santaRosaOutline);
  const santaCruzPath = islandPath(santaCruzOutline);

  // Labels are anchored at one of the northern vertices (they'll
  // already be on-screen whereas the southern lobes get clipped).
  const santaRosaLabel = project(santaRosaOutline[0][0], santaRosaOutline[0][1]);
  const santaCruzLabel = project(santaCruzOutline[0][0], santaCruzOutline[0][1]);

  return (
    <Slide active={active} title="CENTRAL COAST · CURRENT CONDITIONS">
      <div className="rt-map-wrap">
        <svg className="rt-map-svg" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <pattern id="rt-land-tex" width="10" height="10" patternUnits="userSpaceOnUse">
              <rect width="10" height="10" fill="#1b4fa8" />
              <path d="M 0,10 L 10,0" stroke="#2a5fbf" strokeWidth="1" opacity="0.55" />
            </pattern>
            <pattern id="rt-sea-tex" width="14" height="14" patternUnits="userSpaceOnUse">
              <rect width="14" height="14" fill="#020a3a" />
              <path d="M 0,7 Q 3.5,4 7,7 T 14,7" stroke="#0a1c63" strokeWidth="1" fill="none" opacity="0.7" />
            </pattern>
            <filter id="rt-map-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" />
            </filter>
          </defs>

          {/* Ocean backdrop */}
          <rect x="0" y="0" width={VB_W} height={VB_H} fill="url(#rt-sea-tex)" />

          {/* Landmass — real coastline from lat/lng polyline */}
          <path d={landPath} fill="url(#rt-land-tex)" stroke="#ffc631" strokeWidth="3" strokeLinejoin="round" />

          {/* Santa Ynez range — dashed brown line */}
          <path d={ynezPath} fill="none" stroke="#b48a3a" strokeWidth="2.5" strokeDasharray="6 4" opacity="0.9" />
          <text
            x={((ynezPts[1].x + ynezPts[3].x) / 2).toFixed(0)}
            y={(ynezPts[2].y - 10).toFixed(0)}
            textAnchor="middle"
            fill="#d4a757"
            fontSize="16"
            fontFamily="'VT323', monospace"
            letterSpacing="2"
          >SANTA YNEZ MTS</text>

          {/* Channel Islands (Santa Rosa + Santa Cruz) — real coastline
              polygons traced from lat/lng of headlands and capes rather
              than ellipses. Southern lobes are clipped to the viewBox. */}
          <g opacity="0.9">
            <path d={santaCruzPath} fill="#103e7f" stroke="#ffc631" strokeWidth="1.8" strokeLinejoin="round" />
            <path d={santaRosaPath} fill="#103e7f" stroke="#ffc631" strokeWidth="1.8" strokeLinejoin="round" />
            <text x={santaCruzLabel.x} y={santaCruzLabel.y - 6} textAnchor="middle" fill="#9fc5ff" fontSize="13" fontFamily="'VT323', monospace" letterSpacing="2" opacity="0.85">SANTA CRUZ IS.</text>
            <text x={santaRosaLabel.x} y={santaRosaLabel.y - 6} textAnchor="middle" fill="#9fc5ff" fontSize="13" fontFamily="'VT323', monospace" letterSpacing="2" opacity="0.85">SANTA ROSA IS.</text>
          </g>

          {/* Ocean label — pushed out into open water, well west of
              the coastline and clearly inside the ocean polygon.
              v78: nudged down ~1in (120 SVG units ≈ 1 inch at typical
              kiosk render) so it sits comfortably south of the top
              chrome and Piedras Blancas. */}
          <text x={25} y={260} fill="#5fa5ff" fontSize="26" fontFamily="'VT323', monospace" letterSpacing="8" opacity="0.75">PACIFIC OCEAN</text>
          <text x={project(34.25, -120.00).x} y={project(34.25, -120.00).y} fill="#5fa5ff" fontSize="16" fontFamily="'VT323', monospace" letterSpacing="4" opacity="0.7">SANTA BARBARA CH.</text>

          {/* Vandenberg SFB — real KVBG coords from api.weather.gov
              (34.72944, -120.57667). The VSFB label is placed WEST of
              the pin (out over the ocean) so it can't collide with the
              Lompoc city chip just south of it. */}
          {(() => {
            const p = project(34.72944, -120.57667);
            return (
              <g>
                <circle cx={p.x} cy={p.y} r="6" fill="#ff6a3a" stroke="#fff" strokeWidth="2" />
                <circle cx={p.x} cy={p.y} r="2" fill="#fff" />
                <text x={p.x - 10} y={p.y + 5} textAnchor="end" fill="#ff9a6a" fontSize="18" fontFamily="'VT323', monospace" letterSpacing="2">VSFB</text>
              </g>
            );
          })()}

          {/* City chips — temp readouts. Each chip is big enough to
              contain the longest city name ("SAN LUIS OBISPO" = 15
              chars, "SANTA BARBARA" = 13) without clipping. Chip
              offsets are chosen per-city so chips and leader lines
              don't overlap each other or the VSFB marker at
              (~481, 543).
                KPRB (462,125): NE — clear open sky above it
                KSBP (454,317): E  — far from everything else
                KSMX (527,469): E  — 150px below SLO, out over land east
                KLPC (521,570): SW — goes out over ocean, below VSFB
                KSBA (748,677): NE — pushed up-right into open water
          */}
          {cities.map((c) => {
            const { x, y } = project(c.lat, c.lng);
            const temp = c.obs?.tempF;
            const offsetByCode = {
              KPRB: { dx:  34, dy: -60, anchor: 'start' },
              KSBP: { dx:  48, dy:   0, anchor: 'start' },
              KSMX: { dx:  48, dy:   0, anchor: 'start' },
              KLPC: { dx: -48, dy:  52, anchor: 'end'   },
              KSBA: { dx:  30, dy: -48, anchor: 'start' },
            };
            const off = offsetByCode[c.code] || { dx: 48, dy: 0, anchor: 'start' };
            const chipW = 238, chipH = 64;
            const chipX = off.anchor === 'end' ? off.dx - chipW : off.dx;
            const chipY = off.dy - chipH / 2;
            const textX = off.anchor === 'end' ? off.dx - chipW / 2 : off.dx + chipW / 2;
            // Leader from pin to the chip's inner edge.
            const leaderX2 = off.dx;
            const leaderY2 = off.dy;
            return (
              <g key={c.code} transform={`translate(${x}, ${y})`}>
                <line x1="0" y1="0" x2={leaderX2} y2={leaderY2} stroke="#ffc631" strokeWidth="1.5" opacity="0.9" />
                <circle r="8" fill="#ffe47a" stroke="#0c1a63" strokeWidth="2.5" />
                <circle r="3" fill="#0c1a63" />
                <g className="rt-map-chip">
                  <rect x={chipX} y={chipY} rx="4" ry="4" width={chipW} height={chipH} fill="#0c1a63" stroke="#ffc631" strokeWidth="2" />
                  <text x={textX} y={chipY + 26} textAnchor="middle" className="rt-map-city">{c.name.toUpperCase()}</text>
                  <text x={textX} y={chipY + 54} textAnchor="middle" className="rt-map-temp">
                    {temp != null ? `${temp}°F` : '—'}
                  </text>
                </g>
              </g>
            );
          })}

          {/* v79 — "UPDATED HH:MM" pill in the bottom-left corner so the
              viewer can see the chips are polling live. Only rendered
              once we've actually received an observation — otherwise
              it'd lie about liveness while stations are still loading. */}
          {updatedAt ? (
            <g transform={`translate(24, ${VB_H - 32})`} opacity="0.9">
              <rect x="0" y="-20" rx="4" ry="4" width="200" height="28" fill="#0c1a63" stroke="#ffc631" strokeWidth="1.5" />
              <text x="100" y="0" textAnchor="middle" fill="#ffe47a" fontSize="15" fontFamily="'VT323', monospace" letterSpacing="3">
                UPDATED {new Date(updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </text>
            </g>
          ) : null}

          {/* Compass rose */}
          <g transform={`translate(${VB_W - 70}, ${VB_H - 70})`} opacity="0.85">
            <circle r="30" fill="#0c1a63" stroke="#ffc631" strokeWidth="2" />
            <path d="M 0,-24 L 5,0 L 0,24 L -5,0 Z" fill="#ffc631" />
            <text y="-32" textAnchor="middle" fill="#ffc631" fontSize="12" fontFamily="'VT323', monospace">N</text>
          </g>
        </svg>
      </div>
    </Slide>
  );
}

// Rocket glyph — inline SVG so we don't have to ship another asset.
// Stylized retro rocket silhouette, scales with font-size via currentColor.
function RocketIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 64 96" aria-hidden="true">
      <g fill="currentColor">
        {/* Body */}
        <path d="M32 2 C 20 14, 20 38, 20 58 L 20 72 L 44 72 L 44 58 C 44 38, 44 14, 32 2 Z" />
        {/* Nose cone highlight */}
        <path d="M32 2 C 28 10, 28 24, 28 34 L 36 34 C 36 24, 36 10, 32 2 Z" opacity="0.45" />
        {/* Left fin */}
        <path d="M20 56 L 8 82 L 20 82 Z" />
        {/* Right fin */}
        <path d="M44 56 L 56 82 L 44 82 Z" />
        {/* Center fin */}
        <path d="M28 72 L 28 88 L 36 88 L 36 72 Z" />
        {/* Window */}
        <circle cx="32" cy="30" r="5" fill="#0c1a63" />
      </g>
    </svg>
  );
}

function NextLaunchSlide({ active, launches }) {
  // v79 — show up to 12 rows (was 5) and let the list auto-scroll
  // if more than ~5 fit on screen. Scroll stops when the last row's
  // bottom edge is flush with the viewport bottom — no looping.
  const list = (launches || []).slice(0, 12);
  const primary = list[0];
  const rest    = list.slice(1);

  // v82 — the list is scrolled inside its OWN clipping viewport (not
  // the whole slide), so rows can't spill over the primary card.
  const viewportRef = useRef(null);
  const listRef     = useRef(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const ul       = listRef.current;
    if (!ul) return undefined;
    if (!active) {
      ul.style.transform = 'translateY(0)';
      return undefined;
    }

    let raf = 0;
    let cancelled = false;
    const HOLD_TOP_MS    = 3000;
    const HOLD_BOTTOM_MS = 3000;
    const PX_PER_SEC     = 28;

    const start = () => {
      if (cancelled) return;
      // Measure ONLY the viewport (just the list), not the whole slide.
      const maxTranslate = Math.max(0, ul.scrollHeight - (viewport?.clientHeight || 0));
      if (maxTranslate <= 0) {
        ul.style.transform = 'translateY(0)';
        return;
      }
      ul.style.transform = 'translateY(0)';
      const scrollMs = (maxTranslate / PX_PER_SEC) * 1000;
      const t0 = performance.now() + HOLD_TOP_MS;

      const tick = (now) => {
        if (cancelled) return;
        const elapsed = now - t0;
        let y = 0;
        if (elapsed < 0) {
          y = 0;
        } else if (elapsed >= scrollMs) {
          y = -maxTranslate;
        } else {
          y = -(elapsed / scrollMs) * maxTranslate;
        }
        ul.style.transform = `translateY(${y}px)`;
        if (elapsed < scrollMs + HOLD_BOTTOM_MS) {
          raf = requestAnimationFrame(tick);
        }
      };
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(start);
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active, rest.length]);

  return (
    <Slide active={active} title="UPCOMING LAUNCHES · VSFB">
      <div className="rt-launch-list-wrap">
        {primary ? (
          <div className="rt-launch-primary">
            <RocketIcon className="rt-launch-primary-icon" />
            <div className="rt-launch-primary-body">
              <div className="rt-mission">{primary.mission_name || primary.name || 'TBD'}</div>
              <div className="rt-rocket-name">{(primary.rocket_name || '').toUpperCase()}</div>
              <div className="rt-primary-meta">
                <span className="rt-when">{primary.net ? formatPrettyDate(primary.net) : 'Schedule pending'}</span>
                {primary.pad_name ? <span className="rt-pad">· PAD {primary.pad_name}</span> : null}
              </div>
              {primary.net ? <div className="rt-tminus">{formatTminus(primary.net)}</div> : null}
            </div>
          </div>
        ) : (
          <div className="rt-launch-primary"><div className="rt-launch-primary-body"><div className="rt-mission">NO LAUNCHES ON THE BOARD</div></div></div>
        )}

        {rest.length > 0 && (
          <div className="rt-launch-viewport" ref={viewportRef}>
            <ul className="rt-launch-list" ref={listRef}>
              {rest.map((L, i) => (
              <li key={(L.id || L.name || i) + '-' + i} className="rt-launch-row">
                <RocketIcon className="rt-launch-row-icon" />
                <div className="rt-launch-row-main">
                  <div className="rt-launch-row-mission">{(L.mission_name || L.name || 'TBD').toUpperCase()}</div>
                  <div className="rt-launch-row-sub">
                    <span className="rt-launch-row-rocket">{(L.rocket_name || '').toUpperCase()}</span>
                    {L.pad_name ? <span className="rt-launch-row-pad">· {L.pad_name}</span> : null}
                  </div>
                </div>
                <div className="rt-launch-row-when">
                  {L.net ? formatPrettyDate(L.net).toUpperCase() : 'TBD'}
                </div>
              </li>
            ))}
            </ul>
          </div>
        )}
      </div>
    </Slide>
  );
}

/* Rotating facts — pulled from the ambient STATIC_FACTS pool via
 * buildFacts(). Each visit to this slide shows `perCycleCount` facts,
 * dwelling `perCycleMs` each. A shuffle-deck keeps the order fresh. */
function RotatingFactsSlide({ active, facts, perCycleMs, perCycleCount }) {
  const [idx, setIdx] = useState(0);
  const [deck, setDeck] = useState(() => shuffle([...Array(facts.length).keys()]));

  // Rebuild the deck if the underlying facts pool changes size
  useEffect(() => {
    setDeck(shuffle([...Array(facts.length).keys()]));
    setIdx(0);
  }, [facts.length]);

  // When the slide becomes active, reset the counter and re-shuffle
  // so each visit shows a different trio.
  useEffect(() => {
    if (active) {
      setDeck((prev) => shuffle(prev.length ? [...prev] : [...Array(facts.length).keys()]));
      setIdx(0);
    }
  }, [active, facts.length]);

  // Tick through facts while active.
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % Math.min(perCycleCount, Math.max(1, deck.length)));
    }, perCycleMs);
    return () => clearInterval(id);
  }, [active, perCycleMs, perCycleCount, deck.length]);

  const pick = deck[idx] ?? 0;
  const fact = facts[pick] || facts[0] || { headline: '—', body: '', category: '' };

  return (
    <Slide active={active} title="INTERESTING FACTS">
      <div className="rt-fact rt-fact-ambient">
        <div>
          <div className="rt-fact-kicker">{(fact.category || 'DID YOU KNOW?').toUpperCase()}</div>
          <div className="rt-fact-headline">{fact.headline}</div>
          {/* v77 — the suffix ("acres", "orbital missions", etc) used to
              sit inline to the right of the big number. That made it
              visually compete with the body text. It now renders as a
              separate, smaller line BELOW the number so it reads as the
              topic of the value, not part of it. */}
          {fact.suffix ? (
            <div className="rt-fact-suffix-block">{fact.suffix}</div>
          ) : null}
          <div className="rt-fact-body">{fact.body}</div>
        </div>
        <div className="rt-fact-dots" aria-hidden="true">
          {Array.from({ length: perCycleCount }).map((_, i) => (
            <span key={i} className={`rt-fact-dot ${i === idx ? 'rt-fact-dot-on' : ''}`} />
          ))}
        </div>
      </div>
    </Slide>
  );
}

function SignOffSlide({ active }) {
  return (
    <Slide active={active} title="VSFB-TV">
      <div className="rt-signoff">
        <img className="rt-signoff-face" src={joshHeadUrl} alt="Josh" />
        <div className="rt-signoff-text">
          <div className="rt-signoff-kicker">THANKS FOR TUNING IN</div>
          <div className="rt-signoff-body">
            FORECAST CONFIDENCE: <em>MEDIUM</em>
            <br />
            JAZZ CONFIDENCE: <em>EXTREMELY HIGH</em>
          </div>
          <div className="rt-signoff-kicker">STAY TUNED… OR DON’T.<br/>WE’LL STILL BE HERE.</div>
        </div>
      </div>
    </Slide>
  );
}

/* v71 Skit slide — plays a short video clip between cycles of the
 * show, inside the same TV chrome (header + clock + crawl stay up).
 *
 * How it plugs into the runner:
 *   - The runner sets `activeSkitSlot = 'skit-N'` then awaits a play
 *     promise registered via `registerPlay(fn)`.
 *   - That fn HEAD-probes /skit/<slot>. If 404, it resolves immediately
 *     with played:false so the runner skips this step cleanly.
 *   - If the file exists we mount a <video>, call .play(), and resolve
 *     on 'ended' / 'error' / a safety timeout.
 *
 * We mute the music bed for the video duration so narration the
 * character recorded ON the video (dialogue) isn't competing with
 * jazz. The bed resumes when the skit ends.
 */
function SkitSlide({ active, slot, registerPlay, getGain, attachVideoGain }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | loading | playing | ended | missing | error
  const episodeTitle = useMemo(() => {
    const meta = SKIT_SLOTS.find((s) => s.id === slot);
    return meta?.episodeTitle || (slot ? slot.toUpperCase() : '');
  }, [slot]);

  // Register the play() function on mount. We return a promise that
  // resolves when the video finishes (or errors).
  useEffect(() => {
    if (!registerPlay) return undefined;
    const fn = (targetSlot) => new Promise((resolve) => {
      // Probe existence first. HEAD isn't supported by our range-aware
      // handler, so do a range-1 GET (matches useNarration's trick).
      fetch(skitUrl(targetSlot), {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store',
      })
        .then((r) => {
          if (!r.ok && r.status !== 206) {
            setStatus('missing');
            resolve({ played: false, durationMs: 0 });
            return;
          }
          // Wait for videoRef to mount (the <video> is only rendered
          // when `active` is true and `slot` is set — the runner sets
          // both BEFORE calling this fn, but React commit lands after
          // a frame. Poll briefly.)
          const start = Date.now();
          const tick = () => {
            const v = videoRef.current;
            if (!v) {
              if (Date.now() - start > 1500) {
                setStatus('error');
                resolve({ played: false, durationMs: 0 });
                return;
              }
              setTimeout(tick, 40);
              return;
            }
            setStatus('loading');
            let settled = false;
            const finish = (played) => {
              if (settled) return;
              settled = true;
              v.removeEventListener('ended', onEnded);
              v.removeEventListener('error', onError);
              clearTimeout(safety);
              setStatus(played ? 'ended' : 'error');
              resolve({ played, durationMs: Date.now() - start });
            };
            const onEnded = () => finish(true);
            const onError = () => finish(false);
            v.addEventListener('ended', onEnded);
            v.addEventListener('error', onError);
            // Safety cap — never let a pathological video hang the
            // broadcast. 3 minutes is more than generous for skits.
            const safety = setTimeout(() => finish(true), 3 * 60 * 1000);
            try { v.currentTime = 0; } catch {}
            // Apply per-skit gain via Web Audio so values > 1 truly
            // amplify (native video.volume caps at 1). Admin controls
            // this from /admin/retro; gain=1 is "as recorded."
            try {
              const g = typeof getGain === 'function' ? getGain(targetSlot) : 1;
              attachVideoGain?.(v, g);
            } catch (e) { console.warn('[retro] skit gain attach failed:', e); }
            v.play()
              .then(() => setStatus('playing'))
              .catch((e) => {
                console.warn('[retro] skit play blocked:', e);
                finish(false);
              });
          };
          tick();
        })
        .catch(() => {
          setStatus('error');
          resolve({ played: false, durationMs: 0 });
        });
    });
    registerPlay(fn);
    return () => { registerPlay(null); };
  }, [registerPlay]);

  return (
    <Slide active={active} title="ROCKET NEWS">
      <div className="rt-skit-wrap">
        {active && slot ? (
          <video
            key={slot}
            ref={videoRef}
            className="rt-skit-video"
            src={skitUrl(slot)}
            // Autoplay inline on iOS requires playsInline. We rely on
            // the user having already clicked BEGIN BROADCAST so the
            // AudioContext is unlocked — video audio should play.
            playsInline
            preload="auto"
          />
        ) : (
          <div className="rt-skit-placeholder">
            <div className="rt-skit-bug">ROCKET NEWS</div>
          </div>
        )}
        {/* Lower-third overlay during playback — episode badge */}
        {active && slot && status !== 'missing' && (
          <div className="rt-skit-lower">
            <span className="rt-skit-lower-kicker">ROCKET NEWS</span>
            <span className="rt-skit-lower-title">{episodeTitle}</span>
          </div>
        )}
        {/* Upper-right "commercial in progress" tag — shows while the
            skit is loading or playing, hides if no skit is available. */}
        {active && slot && status !== 'missing' && (
          <div className="rt-skit-commercial" aria-label="Commercial in progress">
            <span className="rt-skit-commercial-dot" />
            COMMERCIAL IN PROGRESS
          </div>
        )}
      </div>
    </Slide>
  );
}

/* v76 Codec portrait — MGS-style character card that slides in from
 * the right when a narration line starts and slides out when it ends.
 * Keeps the most recent portrait mounted during the slide-out so the
 * animation can actually play (instead of yanking it off on unmount).
 */
function CodecPortrait({ portrait }) {
  // Keep the last shown portrait around so the slide-out animation
  // has something to render. When `portrait` goes null, we flip the
  // visible flag off but hold onto `last` through the exit transition.
  const [last, setLast] = useState(portrait);
  const [visible, setVisible] = useState(Boolean(portrait));

  useEffect(() => {
    if (portrait) {
      setLast(portrait);
      setVisible(true);
    } else {
      setVisible(false);
      // Clear the stale portrait after the exit animation so it's
      // not lingering in the DOM forever. 500ms matches the CSS.
      const t = setTimeout(() => setLast(null), 500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [portrait]);

  if (!last) return null;
  const src = portraitUrl(last.slide, last.episode);
  if (!src) return null;
  return (
    <div
      className={`rt-codec ${visible ? 'rt-codec-on' : 'rt-codec-off'}`}
      aria-hidden={!visible}
    >
      <div className="rt-codec-frame">
        <img className="rt-codec-img" src={src} alt="" />
        <div className="rt-codec-scan" aria-hidden="true" />
      </div>
      <div className="rt-codec-label">
        <span className="rt-codec-freq">140.85</span>
        <span className="rt-codec-name">JOSH</span>
      </div>
    </div>
  );
}

function Crawl({ items }) {
  // Build one pass then repeat 3x so the marquee always has something
  // flowing. Each item is tagged by `kind` — the CSS colors brand/news/
  // data items and greys out silly asides so they read as tongue-in-cheek.
  const buildPass = (passKey) => items.flatMap((item, i) => {
    const kind = item.kind || 'news';
    const marker = kind === 'silly' ? '•' : '◆';
    return [
      <span key={`${passKey}-t${i}`} className={`rt-crawl-item rt-crawl-${kind}`}>
        <b>{marker}</b> {item.text}
      </span>,
      <span key={`${passKey}-s${i}`} className="sep">·</span>,
    ];
  });
  return (
    <div className="rt-crawl">
      <div className="rt-crawl-inner">
        {buildPass('a')}
        {buildPass('b')}
        {buildPass('c')}
      </div>
    </div>
  );
}

/* --- util --- */
function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
