// Mock data for offline development and as fallback when FlightClub is unreachable.
//
// We model TWO distinct Falcon 9 flight profiles, because VSFB booster
// recoveries split cleanly in two:
//
//   - RTLS (Return-To-Launch-Site) → SLC-4E lifts off, booster flips,
//     burns back, and lands at Landing Zone 4 just north of the pad.
//     Signature: downrange distance curves all the way back to ~0 at
//     touchdown, boostback burn event in the timeline.
//
//   - ASDS (droneship) → booster heads downrange ~270 km and lands on
//     Of Course I Still Love You in the Pacific. Signature: downrange
//     ends at ~270 km (never returns), no boostback burn, deeper
//     staging (MECO later, higher velocity at staging).
//
// Event timing anchors are drawn from SpaceX webcast callouts on recent
// west-coast flights of each type — the cadence is remarkably consistent
// across missions of the same profile. Numbers are eyeball-accurate, not
// physics-perfect; the goal is a graph that reads authentically for the
// specific mission type.
//
// `pickMockSimulation(launch)` / `pickMockEvents(launch)` below select
// the right profile based on the launch's `is_rtls` flag so the fallback
// shown when FlightClub has no mission data matches reality.

function generateVsfbRtlsProfile() {
  // Standard Falcon 9 VSFB RTLS event timeline (seconds from liftoff).
  // Compared to ASDS: MECO is earlier (~141 vs ~156s), stage sep is
  // earlier, and there's a boostback burn that ASDS missions skip.
  const T_MAX_Q         =  71;
  const T_MECO          = 141;
  const T_SEP           = 144;
  const T_SES1          = 152;
  const T_BOOSTBACK     = 157;  // boostback burn ignition
  const T_BOOSTBACK_END = 190;  // boostback burn cutoff
  const T_FAIRING       = 220;
  const T_ENTRY_BURN    = 383;  // entry burn ignition
  const T_ENTRY_END     = 405;  // entry burn cutoff
  const T_LANDING_BURN  = 445;  // landing burn ignition
  const T_LANDING       = 460;  // touchdown at LZ-4
  const T_SECO          = 527;
  const T_DEPLOY        = 3700; // ~1hr for Starlink-class payloads

  // -------------------- Stage 1: up, flip, boostback, return to LZ-4 --------------------
  //
  // Physics sketch, in miles:
  //   MECO:         alt ~42 mi, dr ~37 mi, vel ~4,250 mph   (earlier + slower than ASDS)
  //   Apex:         alt ~75 mi, dr ~56 mi                    (near end of boostback)
  //   Entry burn:   alt ~28 mi, dr ~25 mi                    (curling back)
  //   Landing burn: alt ~2 mi,  dr ~1 mi                     (vertical descent)
  //   Touchdown:    alt  0,     dr ~0.25 mi                  (LZ-4 is ~¼ mi from SLC-4E)
  //
  // Stored in km internally (the downstream code converts to mi at render time).
  const MI_TO_KM = 1.60934;

  const stage1 = [];
  for (let t = 0; t <= T_LANDING + 20; t += 1) {
    let alt = 0, vel = 0, dr = 0, accel = 0, q = 0;

    if (t < T_MECO) {
      // ---- Powered ascent ----
      const frac = t / T_MECO;
      alt = 67 * Math.pow(frac, 1.85);           // km — ~67 km (42 mi) at MECO
      vel = 1900 * Math.pow(frac, 1.25);         // m/s — ~1900 m/s at MECO (~4,250 mph)
      dr  = 58 * Math.pow(frac, 2.25);           // km — ~58 km (36 mi) at MECO
      accel = 14 + 16 * frac;
      q = 30000 * Math.exp(-Math.pow((t - T_MAX_Q) / 20, 2));
    } else if (t < T_BOOSTBACK) {
      // ---- Post-MECO coast / stage sep ----
      const dt = t - T_MECO;
      const span = T_BOOSTBACK - T_MECO;
      const frac = dt / span;
      alt = 67 + 15 * frac;                      // still climbing a bit
      vel = 1900 - 200 * frac;                    // slowing from drag / re-orientation
      dr  = 58 + 10 * frac;
    } else if (t < T_BOOSTBACK_END) {
      // ---- Boostback burn: kill downrange velocity, start reversing ----
      const dt = t - T_BOOSTBACK;
      const span = T_BOOSTBACK_END - T_BOOSTBACK;
      const frac = dt / span;
      alt = 82 + 18 * frac;                      // keeps climbing to apex ~120 km (75 mi)
      // Velocity dips as boostback cancels downrange component, then reverses.
      vel = 1700 - 1400 * frac;                   // ends near 300 m/s heading back
      // Downrange peaks at apex then starts decreasing
      dr  = 68 + 22 * Math.sin(frac * Math.PI / 2); // arcs up to ~90 km (56 mi)
      accel = 18;                                // burn acceleration
    } else if (t < T_ENTRY_BURN) {
      // ---- Coast back toward launch site; apex then descent ----
      const dt = t - T_BOOSTBACK_END;
      const span = T_ENTRY_BURN - T_BOOSTBACK_END;
      const frac = dt / span;
      // Alt: apex around 20% into this segment, then falls
      const apexFrac = 0.2;
      const apexAlt = 120;
      if (frac < apexFrac) {
        alt = 100 + (apexAlt - 100) * (frac / apexFrac);
      } else {
        const fallFrac = (frac - apexFrac) / (1 - apexFrac);
        alt = apexAlt - (apexAlt - 45) * fallFrac;
      }
      // Velocity builds as it falls
      vel = 300 + 1400 * frac;
      // Downrange decreases as we return — peak at ~90 km, curl back to ~40 km
      dr = 90 - 50 * frac;
    } else if (t < T_ENTRY_END) {
      // ---- Entry burn: slow the booster through peak heating ----
      const frac = (t - T_ENTRY_BURN) / (T_ENTRY_END - T_ENTRY_BURN);
      alt = 45 - 10 * frac;
      vel = 1700 - 900 * frac;                   // slashed by entry burn
      dr = 40 - 10 * frac;
      q = 15000 * Math.exp(-Math.pow((frac - 0.5) / 0.4, 2));
      accel = 28;                                // heavy deceleration
    } else if (t < T_LANDING_BURN) {
      // ---- Terminal descent, no engines ----
      const frac = (t - T_ENTRY_END) / (T_LANDING_BURN - T_ENTRY_END);
      alt = 35 - 33 * frac;                      // falling hard
      vel = 800 - 500 * frac;                    // slowing via drag
      dr = 30 - 28 * frac;                        // most of the return happens here
    } else if (t < T_LANDING) {
      // ---- Landing burn ----
      const frac = (t - T_LANDING_BURN) / (T_LANDING - T_LANDING_BURN);
      alt = 2 * (1 - Math.pow(frac, 1.2));       // ~2 km → 0
      vel = 300 * Math.pow(1 - frac, 1.4);        // ~300 m/s → 0
      dr = 2 - 1.6 * frac;                        // ends at ~0.4 km (LZ-4 offset from SLC-4E)
      accel = 35;                                 // hoverslam deceleration
    } else {
      // ---- Landed at LZ-4 ----
      alt = 0; vel = 0; dr = 0.4;                 // LZ-4 sits ~400m NE of SLC-4E
      accel = 0;
    }
    stage1.push({ t, alt, vel, dr, accel, q });
  }

  // -------------------- Stage 2: boring old "goes to orbit" profile --------------------
  //
  // Stage 2's job is unchanged by RTLS vs ASDS — it keeps going downrange
  // and climbs to orbital altitude. Same general shape as before.
  const stage2 = [];
  for (let t = T_SEP; t <= T_DEPLOY; t += 5) {
    const dt = t - T_SEP;
    let alt, vel, dr;
    if (dt < T_SECO - T_SEP) {
      // Burn to orbit
      const frac = dt / (T_SECO - T_SEP);
      alt = 67 + (250 - 67) * Math.pow(frac, 0.5);
      vel = 1900 + (7800 - 1900) * Math.pow(frac, 1.0);
      dr  = 58 + 1850 * frac;
    } else {
      // Coast to deploy
      const frac = (dt - (T_SECO - T_SEP)) / (T_DEPLOY - T_SECO);
      alt = 250 + 280 * frac;
      vel = 7800;
      dr  = 1908 + 18000 * frac;
    }
    stage2.push({ t, alt, vel, dr, accel: t < T_SECO ? 10 : 0, q: 0 });
  }

  const events = [
    { t: 0,                key: 'liftoff',             label: 'liftoff' },
    { t: T_MAX_Q,          key: 'maxq',                label: 'max-Q' },
    { t: T_MECO,           key: 'meco',                label: 'MECO' },
    { t: T_SEP,            key: 'stage_sep',           label: 'stage sep' },
    { t: T_SES1,           key: 'ses1',                label: 'SES-1' },
    { t: T_BOOSTBACK,      key: 'boostback_start',     label: 'boostback' },
    { t: T_BOOSTBACK_END,  key: 'boostback_end',       label: 'boostback end' },
    { t: T_FAIRING,        key: 'fairing',             label: 'fairing sep' },
    { t: T_ENTRY_BURN,     key: 'entry_burn_start',    label: 'entry burn' },
    { t: T_LANDING_BURN,   key: 'landing_burn_start',  label: 'landing burn' },
    { t: T_LANDING,        key: 'landing',             label: 'LZ-4 touchdown' },
    { t: T_SECO,           key: 'seco',                label: 'SECO' },
    { t: T_DEPLOY,         key: 'deploy',              label: 'payload deploy' },
  ];

  return { stages: [{ stage: 1, points: stage1 }, { stage: 2, points: stage2 }], events };
}

// ---------------------------------------------------------------------
// VSFB ASDS droneship profile (most Starlink-class missions from SLC-4E)
// ---------------------------------------------------------------------
//
// Droneship flights stage deeper (MECO later + faster), skip the boostback
// burn entirely, and the booster keeps going downrange until it lands on
// Of Course I Still Love You in the Pacific ~270 km off the California
// coast. Event timing modeled on recent west-coast ASDS Starlink flights.
function generateVsfbAsdsProfile() {
  // Standard Falcon 9 ASDS event timeline (seconds from liftoff).
  const T_MAX_Q        =  72;
  const T_MECO         = 156;   // later + faster than RTLS
  const T_SEP          = 159;
  const T_SES1         = 167;
  const T_FAIRING      = 210;
  const T_ENTRY_BURN   = 395;
  const T_ENTRY_END    = 415;
  const T_LANDING_BURN = 470;
  const T_LANDING      = 490;   // touchdown on OCISLY
  const T_SECO         = 540;
  const T_DEPLOY       = 3700;

  // Stage 1 — goes up, keeps going downrange, no boostback.
  //
  // Physics sketch, in miles:
  //   MECO:         alt ~50 mi, dr ~45 mi, vel ~5,500 mph   (deeper stage than RTLS)
  //   Apex:         alt ~85 mi, dr ~110 mi
  //   Entry burn:   alt ~40 mi, dr ~160 mi
  //   Landing burn: alt ~3 mi,  dr ~170 mi
  //   Touchdown:    alt  0,     dr ~168 mi (~270 km)        (OCISLY in Pacific)
  const stage1 = [];
  for (let t = 0; t <= T_LANDING + 20; t += 1) {
    let alt = 0, vel = 0, dr = 0, accel = 0, q = 0;

    if (t < T_MECO) {
      // ---- Powered ascent ----
      const frac = t / T_MECO;
      alt = 80 * Math.pow(frac, 1.9);             // km — ~80 km at MECO (~50 mi)
      vel = 2450 * Math.pow(frac, 1.3);            // m/s — ~2450 m/s at MECO (~5,500 mph)
      dr  = 72 * Math.pow(frac, 2.2);              // km — ~72 km at MECO (~45 mi)
      accel = 15 + 15 * frac;
      q = 30000 * Math.exp(-Math.pow((t - T_MAX_Q) / 20, 2));
    } else if (t < T_ENTRY_BURN) {
      // ---- Coasting apex, continues downrange (no boostback) ----
      const dt = t - T_MECO;
      const span = T_ENTRY_BURN - T_MECO;
      const frac = dt / span;
      // Apex around 35% into this segment, then falls
      const apexFrac = 0.35;
      const apexAlt = 138;                         // ~86 mi apex
      if (frac < apexFrac) {
        alt = 80 + (apexAlt - 80) * (frac / apexFrac);
      } else {
        const fallFrac = (frac - apexFrac) / (1 - apexFrac);
        alt = apexAlt - (apexAlt - 55) * fallFrac;
      }
      vel = 2450 - 300 * frac;                     // gently slowing from drag at altitude
      // Downrange CONTINUES TO GROW — booster isn't coming back
      dr = 72 + (260 - 72) * Math.pow(frac, 0.85);  // up to ~260 km (~161 mi)
    } else if (t < T_ENTRY_END) {
      // ---- Entry burn ----
      const frac = (t - T_ENTRY_BURN) / (T_ENTRY_END - T_ENTRY_BURN);
      alt = 55 - 15 * frac;
      vel = 2150 - 1000 * frac;                    // slashed by entry burn
      dr = 260 + 7 * frac;                          // still gaining a bit downrange
      q = 18000 * Math.exp(-Math.pow((frac - 0.5) / 0.4, 2));
      accel = 30;
    } else if (t < T_LANDING_BURN) {
      // ---- Terminal descent ----
      const frac = (t - T_ENTRY_END) / (T_LANDING_BURN - T_ENTRY_END);
      alt = 40 - 36 * frac;
      vel = 1150 - 800 * frac;
      dr = 267 + 3 * frac;                          // last bit of downrange before landing
    } else if (t < T_LANDING) {
      // ---- Landing burn ----
      const frac = (t - T_LANDING_BURN) / (T_LANDING - T_LANDING_BURN);
      alt = 4 * (1 - Math.pow(frac, 1.2));          // ~4 km → 0
      vel = 350 * Math.pow(1 - frac, 1.4);           // ~350 m/s → 0
      dr = 270;                                     // holds steady on droneship target
      accel = 35;
    } else {
      // ---- Landed on OCISLY ----
      alt = 0; vel = 0; dr = 270;
      accel = 0;
    }
    stage1.push({ t, alt, vel, dr, accel, q });
  }

  // Stage 2 — same as RTLS profile (stage 2 doesn't care where the booster lands).
  const stage2 = [];
  for (let t = T_SEP; t <= T_DEPLOY; t += 5) {
    const dt = t - T_SEP;
    let alt, vel, dr;
    if (dt < T_SECO - T_SEP) {
      const frac = dt / (T_SECO - T_SEP);
      alt = 80 + (250 - 80) * Math.pow(frac, 0.5);
      vel = 2450 + (7800 - 2450) * Math.pow(frac, 1.0);
      dr  = 72 + 1800 * frac;
    } else {
      const frac = (dt - (T_SECO - T_SEP)) / (T_DEPLOY - T_SECO);
      alt = 250 + 280 * frac;
      vel = 7800;
      dr  = 1872 + 18000 * frac;
    }
    stage2.push({ t, alt, vel, dr, accel: t < T_SECO ? 10 : 0, q: 0 });
  }

  // Events: no boostback, landing event re-labeled for the droneship.
  const events = [
    { t: 0,                key: 'liftoff',             label: 'liftoff' },
    { t: T_MAX_Q,          key: 'maxq',                label: 'max-Q' },
    { t: T_MECO,           key: 'meco',                label: 'MECO' },
    { t: T_SEP,            key: 'stage_sep',           label: 'stage sep' },
    { t: T_SES1,           key: 'ses1',                label: 'SES-1' },
    { t: T_FAIRING,        key: 'fairing',             label: 'fairing sep' },
    { t: T_ENTRY_BURN,     key: 'entry_burn_start',    label: 'entry burn' },
    { t: T_LANDING_BURN,   key: 'landing_burn_start',  label: 'landing burn' },
    { t: T_LANDING,        key: 'landing',             label: 'droneship landing' },
    { t: T_SECO,           key: 'seco',                label: 'SECO' },
    { t: T_DEPLOY,         key: 'deploy',              label: 'payload deploy' },
  ];

  return { stages: [{ stage: 1, points: stage1 }, { stage: 2, points: stage2 }], events };
}

// Pre-build both profiles at module load. They're cheap (<5ms each, single
// pass over ~500 integer timesteps) and held forever — no point regenerating
// them on every live-mode entry.
const rtlsProfile = generateVsfbRtlsProfile();
const asdsProfile = generateVsfbAsdsProfile();

// Legacy exports — kept for any caller that still wants "just give me a
// profile." Default to RTLS to match the v7 behavior; new callers should
// use pickMockSimulation / pickMockEvents with a launch object instead.
export const MOCK_SIMULATION = { stages: rtlsProfile.stages };
export const MOCK_EVENTS = rtlsProfile.events;

// The named exports callers should use: pass the launch object and get
// back the profile that matches its recovery type.
export const MOCK_SIMULATION_RTLS = { stages: rtlsProfile.stages };
export const MOCK_SIMULATION_ASDS = { stages: asdsProfile.stages };
export const MOCK_EVENTS_RTLS = rtlsProfile.events;
export const MOCK_EVENTS_ASDS = asdsProfile.events;

/**
 * Choose the right mock simulation for a given launch based on its
 * recovery type. RTLS missions get the boostback-and-return profile,
 * everything else (droneship, expendable, unknown) gets the ASDS
 * downrange profile. Falls back to RTLS when no launch is passed.
 */
export function pickMockSimulation(launch) {
  if (launch?.is_rtls) return MOCK_SIMULATION_RTLS;
  return MOCK_SIMULATION_ASDS;
}

export function pickMockEvents(launch) {
  if (launch?.is_rtls) return MOCK_EVENTS_RTLS;
  return MOCK_EVENTS_ASDS;
}

export const MOCK_UPCOMING_LAUNCHES = [
  {
    id: 'mock-launch-1',
    name: 'Falcon 9 Block 5 | Starlink Group 11-42',
    mission_name: 'Starlink Group 11-42',
    mission_description: 'A batch of Starlink satellites for the SpaceX megaconstellation. Booster returning to LZ-4 for a propulsive landing.',
    mission_type: 'Communications',
    orbit: 'Low Earth Orbit',
    net: new Date(Date.now() + 2 * 3600 * 1000 + 14 * 60 * 1000).toISOString(),
    status: 'Go for Launch',
    status_abbrev: 'Go',
    rocket_name: 'Falcon 9 Block 5',
    rocket_family: 'Falcon',
    rocket_variant: 'Block 5',
    rocket_length_m: 70,
    rocket_diameter_m: 3.7,
    rocket_mass_t: 549,
    rocket_leo_kg: 22800,
    rocket_thrust_kN: 7607,
    provider_name: 'SpaceX',
    pad_name: 'Space Launch Complex 4E',
    pad_location: 'Vandenberg SFB, CA',
    mission_patch: null,
    webcast_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    webcast_type: 'YouTube',
    probability: 90,
    weather_concerns: '',
    // Booster coming home to LZ-4 → sonic boom expected.
    // Flip this to false (or the abbrev to 'OCISLY') to preview the
    // droneship variant of the hero card.
    landing_attempt: true,
    landing_location_abbrev: 'LZ-4',
    landing_location_name: 'Landing Zone 4',
    is_rtls: true,
  },
];

export const MOCK_WEATHER = {
  temp_f: 58,
  humidity: 72,
  wind_mph: 12,
  wind_deg: 315,
  cloud_pct: 15,
  visibility_m: 16000,
  code: 0,
  description: 'clear',
};
