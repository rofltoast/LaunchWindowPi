// FlightClub.io adapter.
// Docs: https://api.flightclub.io/swagger-ui/index.html
//
// IMPORTANT: FlightClub's exact endpoint contracts are not publicly documented
// outside their Swagger UI, which we haven't been able to fully verify from
// this build environment. The functions here implement our BEST GUESS at the
// API based on community projects and their public behavior.
//
// DOCUMENTED ENDPOINTS we target:
//   GET /missions               -> list of missions (keyed by LL2 id)
//   GET /missions/{id}/simulation -> trajectory time series
//   GET /missions/{id}/events    -> event markers (liftoff, MECO, etc.)
//
// If the actual endpoints differ, update `PATHS` below — all call sites
// consume normalized output, so one file changes.
//
// The app gracefully falls back to a built-in "nominal Falcon 9 ascent"
// profile (in mocks.js) when FlightClub is unavailable. The trajectory
// graph will still look beautiful and the event timeline will still tick.

import { CONFIG } from './config.js';
import { pickMockSimulation, pickMockEvents } from './mocks.js';

const BASE = CONFIG.FLIGHTCLUB_BASE;

const PATHS = {
  missionsByLL2: (ll2Id) => `/missions?launchLibraryId=${encodeURIComponent(ll2Id)}`,
  simulation: (missionId) => `/missions/${encodeURIComponent(missionId)}/simulation`,
  events: (missionId) => `/missions/${encodeURIComponent(missionId)}/events`,
};

/**
 * Find a FlightClub mission id for a given Launch Library 2 id.
 * Returns null if no matching sim exists.
 */
export async function findMissionByLL2Id(ll2Id) {
  if (CONFIG.USE_MOCKS) return 'mock-mission-id';
  try {
    const res = await fetch(BASE + PATHS.missionsByLL2(ll2Id));
    if (!res.ok) return null;
    const data = await res.json();
    // Try common shapes: array | { results: [...] } | { missions: [...] }
    const arr = Array.isArray(data) ? data : data.results || data.missions || [];
    return arr[0]?.id || arr[0]?.missionId || null;
  } catch (e) {
    console.warn('FlightClub mission lookup failed:', e.message);
    return null;
  }
}

/**
 * Fetch the full simulation trajectory for a mission.
 * Returns normalized: { stages: [{ stage, points: [{ t, alt, vel, dr, accel }] }] }
 *
 * `launch` (optional) is used to pick the right fallback profile when
 * FlightClub has no data — RTLS vs ASDS — so we don't render a droneship
 * trajectory for an RTLS mission (or vice-versa) when we fall through.
 */
export async function fetchSimulation(missionId, launch = null) {
  if (CONFIG.USE_MOCKS || !missionId) return pickMockSimulation(launch);
  try {
    const res = await fetch(BASE + PATHS.simulation(missionId));
    if (!res.ok) throw new Error(`FC sim ${res.status}`);
    const data = await res.json();
    return normalizeSimulation(data);
  } catch (e) {
    console.warn('FlightClub sim fetch failed, falling back to nominal profile:', e.message);
    return pickMockSimulation(launch);
  }
}

export async function fetchEvents(missionId, launch = null) {
  if (CONFIG.USE_MOCKS || !missionId) return pickMockEvents(launch);
  try {
    const res = await fetch(BASE + PATHS.events(missionId));
    if (!res.ok) throw new Error(`FC events ${res.status}`);
    const data = await res.json();
    return normalizeEvents(data);
  } catch (e) {
    console.warn('FlightClub events fetch failed, using defaults:', e.message);
    return pickMockEvents(launch);
  }
}

/**
 * Normalize a FlightClub sim into our internal shape.
 * Adapts to several plausible response shapes.
 */
function normalizeSimulation(data) {
  // Shape guesses we handle:
  //   { stages: [{ telemetry: [{ time, altitude, velocity, ...}]}]}
  //   [{ stage: 1, telemetry: [...]}]
  //   { simulation: [...] }
  const stageList = Array.isArray(data?.stages) ? data.stages
    : Array.isArray(data) ? data
    : Array.isArray(data?.simulation) ? [{ stage: 1, telemetry: data.simulation }]
    : [];

  const stages = stageList.map((s, idx) => ({
    stage: s.stage ?? s.stageNumber ?? idx + 1,
    points: (s.telemetry || s.points || []).map((p) => ({
      t: p.time ?? p.t ?? 0,
      alt: p.altitude ?? p.alt ?? 0,               // km
      vel: p.velocity ?? p.vel ?? 0,               // m/s
      dr: p.downrange_distance ?? p.downrange ?? p.dr ?? 0, // km
      accel: p.acceleration ?? p.accel ?? 0,       // m/s^2
      q: p.q ?? p.dynamic_pressure ?? 0,
    })),
  }));

  if (stages.length === 0) throw new Error('FC sim: no stages parsed');
  return { stages };
}

function normalizeEvents(data) {
  const arr = Array.isArray(data) ? data : data?.events || [];
  return arr.map((e) => ({
    t: e.time ?? e.t ?? 0,
    key: e.key ?? e.type ?? 'unknown',
    label: e.label ?? humanizeEventKey(e.key ?? e.type ?? 'unknown'),
  }));
}

function humanizeEventKey(k) {
  const map = {
    liftoff: 'liftoff',
    maxq: 'max-Q',
    meco: 'MECO',
    stage_sep: 'stage sep',
    sep: 'stage sep',
    ses1: 'SES-1',
    ses_1: 'SES-1',
    meco2: 'SECO',
    seco: 'SECO',
    landing_burn_start: 'landing burn',
    landing: 'touchdown',
    boostback_start: 'boostback',
    entry_burn_start: 'entry burn',
    deploy: 'payload deploy',
  };
  return map[k] || k.replace(/_/g, ' ');
}

/**
 * Given a simulation and a T+seconds value, return the interpolated
 * telemetry for each stage at that moment. Used to "play" the sim in sync
 * with the real launch clock.
 */
export function sampleSimAtT(sim, tSeconds) {
  if (!sim?.stages) return [];
  return sim.stages.map((stage) => {
    const pts = stage.points;
    if (!pts.length) return null;
    // Find bracketing points
    let i = 0;
    while (i < pts.length - 1 && pts[i + 1].t <= tSeconds) i++;
    const a = pts[i];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const span = b.t - a.t || 1;
    const frac = Math.max(0, Math.min(1, (tSeconds - a.t) / span));
    return {
      stage: stage.stage,
      t: tSeconds,
      alt: lerp(a.alt, b.alt, frac),
      vel: lerp(a.vel, b.vel, frac),
      dr: lerp(a.dr, b.dr, frac),
      accel: lerp(a.accel, b.accel, frac),
      q: lerp(a.q, b.q, frac),
      atEnd: i >= pts.length - 1,
    };
  }).filter(Boolean);
}

function lerp(a, b, t) { return a + (b - a) * t; }
