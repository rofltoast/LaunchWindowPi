import { useMemo, useRef, useEffect, useState } from 'react';

// Internal geometry (dr, alt) is stored in km because that's what the
// simulation upstream gives us. We display axes in miles though, so tick
// labels are converted at render time.
const KM_TO_MI = 0.621371;

/**
 * Live trajectory visualization with dynamic viewport.
 *
 * Key behaviors:
 *   - The viewport auto-scales to the current flight phase, NOT the full mission.
 *     Early in ascent we zoom in tight on stage 1; as the rocket climbs and
 *     goes downrange we gradually expand the bounds. This avoids the "rocket
 *     stuck at the bottom-left of a graph that goes to 18,000 km downrange"
 *     problem where you can't see anything during the visually interesting part.
 *   - The viewport smoothly interpolates between targets so it feels organic
 *     rather than snapping between scales.
 *   - Event labels use simple collision avoidance so they don't overlap when
 *     multiple events happen close together (liftoff, max-Q, MECO, stage-sep
 *     all happen in the first 180s).
 */
export function TrajectoryGraph({ simulation, events, tPlusSeconds }) {
  const VB_W = 800;
  const VB_H = 400;
  const PAD = { l: 56, r: 24, t: 16, b: 44 };

  const stage1Points = simulation?.stages?.[0]?.points || [];
  const stage2Points = simulation?.stages?.[1]?.points || [];

  const t = tPlusSeconds != null ? tPlusSeconds : -Infinity;

  // ---- Dynamic viewport target ----
  // Strategy: bounds grow as the rocket progresses. Look at the furthest
  // point the rocket has reached PLUS a projection ~90 seconds ahead, so
  // upcoming trajectory stays visible.
  const targetBounds = useMemo(() => {
    const allPoints = [...stage1Points, ...stage2Points];
    if (!allPoints.length) return { maxDr: 300, maxAlt: 200 };

    const current = interpolateCurrent(stage1Points, stage2Points, t);

    let pastMaxDr = 0, pastMaxAlt = 0;
    for (const p of allPoints) {
      if (p.t <= t) {
        if (p.dr > pastMaxDr) pastMaxDr = p.dr;
        if (p.alt > pastMaxAlt) pastMaxAlt = p.alt;
      }
    }
    if (current) {
      pastMaxDr = Math.max(pastMaxDr, current.dr);
      pastMaxAlt = Math.max(pastMaxAlt, current.alt);
    }

    // Project ahead for headroom
    let projDr = pastMaxDr, projAlt = pastMaxAlt;
    const tAhead = t + 90;
    for (const p of allPoints) {
      if (p.t > t && p.t <= tAhead) {
        if (p.dr > projDr) projDr = p.dr;
        if (p.alt > projAlt) projAlt = p.alt;
      }
    }

    const minDr = 30;
    const minAlt = 15;

    const maxDr = niceScale(Math.max(projDr * 1.2, minDr));
    const maxAlt = niceScale(Math.max(projAlt * 1.3, minAlt));

    return { maxDr, maxAlt };
  }, [t, stage1Points, stage2Points]);

  // Smoothly interpolate bounds toward target.
  //
  // Important performance notes:
  //   - The SVG below is heavy (dozens of elements, event markers with
  //     collision-resolved labels, a useMemo chain keyed on `bounds`).
  //     Re-rendering it at 60fps melts a Raspberry Pi and lags even a laptop.
  //   - So we only setState when the value materially changes, and STOP the
  //     animation loop when we've reached the target. A fresh loop kicks off
  //     when the target moves (targetBounds useEffect below).
  const [bounds, setBounds] = useState(targetBounds);
  const boundsRef = useRef(targetBounds);
  const targetRef = useRef(targetBounds);
  const rafRef = useRef(null);

  // Kick off / keep alive an animation loop whenever the target changes.
  // Depend on the primitive values (not the object) so that identical targets
  // across ticks don't trigger this effect.
  useEffect(() => {
    targetRef.current = targetBounds;

    // If we're already animating, the running loop will see the new target.
    if (rafRef.current != null) return;

    // Already at target? Nothing to animate.
    const cur = boundsRef.current;
    if (
      Math.abs(cur.maxDr - targetBounds.maxDr) / (targetBounds.maxDr || 1) < 0.005 &&
      Math.abs(cur.maxAlt - targetBounds.maxAlt) / (targetBounds.maxAlt || 1) < 0.005
    ) {
      return;
    }

    function step() {
      const target = targetRef.current;
      const current = boundsRef.current;
      const lerpRate = 0.08;
      let newDr = current.maxDr + (target.maxDr - current.maxDr) * lerpRate;
      let newAlt = current.maxAlt + (target.maxAlt - current.maxAlt) * lerpRate;
      const drClose = Math.abs(newDr - target.maxDr) / (target.maxDr || 1) < 0.005;
      const altClose = Math.abs(newAlt - target.maxAlt) / (target.maxAlt || 1) < 0.005;
      if (drClose) newDr = target.maxDr;
      if (altClose) newAlt = target.maxAlt;

      const next = { maxDr: newDr, maxAlt: newAlt };
      boundsRef.current = next;
      setBounds(next);

      if (drClose && altClose) {
        rafRef.current = null; // settle — stop the loop
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
  }, [targetBounds.maxDr, targetBounds.maxAlt]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const plotW = VB_W - PAD.l - PAD.r;
  const plotH = VB_H - PAD.t - PAD.b;

  function xFor(dr) { return PAD.l + (dr / bounds.maxDr) * plotW; }
  function yFor(alt) { return VB_H - PAD.b - (alt / bounds.maxAlt) * plotH; }

  function splitPath(points) {
    const past = [], future = [];
    for (const p of points) {
      (p.t <= t ? past : future).push(p);
    }
    if (past.length && future.length) future.unshift(past[past.length - 1]);
    return { past, future };
  }

  const s1 = splitPath(stage1Points);
  const s2 = splitPath(stage2Points);

  const currentPos = useMemo(
    () => interpolateCurrent(stage1Points, stage2Points, t),
    [t, stage1Points, stage2Points]
  );

  // Event markers with collision-resolved label positions
  const eventMarkers = useMemo(() => {
    if (!events || events.length === 0) return [];
    const markers = [];
    for (const ev of events) {
      const stagePts = ev.t <= (stage1Points[stage1Points.length - 1]?.t || 0)
        ? stage1Points
        : stage2Points;
      if (!stagePts.length) continue;
      const pos = interpolateAt(stagePts, ev.t);
      if (!pos) continue;
      // Skip markers outside current viewport (with small grace margin)
      if (pos.dr > bounds.maxDr * 1.05 || pos.alt > bounds.maxAlt * 1.05) continue;
      const cx = xFor(pos.dr);
      const cy = yFor(pos.alt);
      const status = ev.t < t - 2 ? 'past' : ev.t < t + 30 ? 'next' : 'future';
      markers.push({ ev, cx, cy, status });
    }

    // Simple collision avoidance: sort by y, place labels, push down if overlapping
    markers.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
    const LABEL_H = 13;
    const LABEL_W = 60;
    const placed = [];
    for (const m of markers) {
      let anchor = 'start';
      let lx = m.cx + 7;
      // Near right edge? Flip to left side of marker
      if (m.cx > VB_W - PAD.r - LABEL_W) {
        anchor = 'end';
        lx = m.cx - 7;
      }
      let ly = m.cy - 5;
      let tries = 0;
      while (tries < 10 && placed.some((p) =>
        Math.abs(p.ly - ly) < LABEL_H && Math.abs(p.lx - lx) < LABEL_W
      )) {
        ly += LABEL_H;
        tries++;
      }
      // Keep label in bounds
      if (ly > VB_H - PAD.b - 4) ly = VB_H - PAD.b - 4;
      if (ly < PAD.t + LABEL_H) ly = PAD.t + LABEL_H;

      m.labelX = lx;
      m.labelY = ly;
      m.labelAnchor = anchor;
      placed.push({ lx, ly });
    }
    return markers;
  }, [events, stage1Points, stage2Points, t, bounds]);

  const axisTicksX = niceTicks(bounds.maxDr, 5);
  const axisTicksY = niceTicks(bounds.maxAlt, 4);

  const AXIS_FS = 11;
  const EVENT_FS = 10;
  const AXIS_LABEL_FS = 11;

  return (
    <svg
      className="traj-svg"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Axis lines */}
      <line className="traj-axis" x1={PAD.l} y1={VB_H - PAD.b} x2={VB_W - PAD.r} y2={VB_H - PAD.b} />
      <line className="traj-axis" x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={VB_H - PAD.b} />

      {/* X grid + labels */}
      {axisTicksX.map((tick) => (
        <g key={`x-${tick}`}>
          <line
            className="traj-axis"
            x1={xFor(tick)} y1={PAD.t}
            x2={xFor(tick)} y2={VB_H - PAD.b}
            strokeDasharray="2 4"
            opacity="0.2"
          />
          <text
            className="traj-axis-label"
            x={xFor(tick)} y={VB_H - PAD.b + 14}
            textAnchor="middle"
            fontSize={AXIS_FS}
          >{formatTick(tick * KM_TO_MI)}</text>
        </g>
      ))}
      <text
        className="traj-axis-label"
        x={VB_W - PAD.r} y={VB_H - 6}
        textAnchor="end"
        fontSize={AXIS_LABEL_FS}
      >
        downrange (mi)
      </text>

      {/* Y grid + labels */}
      {axisTicksY.map((tick) => (
        <g key={`y-${tick}`}>
          <line
            className="traj-axis"
            x1={PAD.l} y1={yFor(tick)}
            x2={VB_W - PAD.r} y2={yFor(tick)}
            strokeDasharray="2 4"
            opacity="0.2"
          />
          <text
            className="traj-axis-label"
            x={PAD.l - 6} y={yFor(tick) + 4}
            textAnchor="end"
            fontSize={AXIS_FS}
          >{formatTick(tick * KM_TO_MI)}</text>
        </g>
      ))}
      <text
        className="traj-axis-label"
        x={14} y={PAD.t + plotH / 2}
        textAnchor="middle"
        transform={`rotate(-90, 14, ${PAD.t + plotH / 2})`}
        fontSize={AXIS_LABEL_FS}
      >altitude (mi)</text>

      {/* Launch pad marker */}
      <g>
        <circle className="traj-pad" cx={xFor(0)} cy={yFor(0)} r="3" />
        <text
          className="traj-axis-label"
          x={xFor(0) + 6}
          y={yFor(0) + 14}
          fontSize={AXIS_FS}
        >pad</text>
      </g>

      {/* Future paths (dashed) */}
      <path className="traj-path-future" d={pointsToPath(s1.future, xFor, yFor)} />
      <path className="traj-path-future" d={pointsToPath(s2.future, xFor, yFor)} />

      {/* Past paths (solid, bright) */}
      <path
        className="traj-path"
        d={pointsToPath(s1.past, xFor, yFor)}
        style={{ stroke: 'var(--accent1)' }}
      />
      <path
        className="traj-path"
        d={pointsToPath(s2.past, xFor, yFor)}
        style={{ stroke: 'var(--accent2)' }}
      />

      {/* Event markers with collision-avoided labels */}
      {eventMarkers.map((m) => (
        <g key={`${m.ev.key}-${m.ev.t}`}>
          <circle
            className={`traj-event traj-event-${m.status}`}
            cx={m.cx} cy={m.cy}
            r={m.status === 'next' ? 5 : 3}
          >
            {m.status === 'next' && (
              <animate attributeName="r" values="4;7;4" dur="1.4s" repeatCount="indefinite" />
            )}
          </circle>
          {/* Leader line when label is offset from marker */}
          {Math.abs(m.labelY - m.cy) > 10 && (
            <line
              x1={m.cx} y1={m.cy}
              x2={m.labelX + (m.labelAnchor === 'end' ? 2 : -2)}
              y2={m.labelY - 3}
              stroke="var(--dim)"
              strokeWidth="0.5"
              opacity="0.5"
            />
          )}
          <text
            className="traj-event-label"
            x={m.labelX}
            y={m.labelY}
            textAnchor={m.labelAnchor}
            opacity={m.status === 'future' ? 0.5 : 1}
            fontSize={EVENT_FS}
          >{m.ev.label}</text>
        </g>
      ))}

      {/* Current rocket position */}
      {currentPos && (
        <g>
          <circle
            className="traj-rocket"
            cx={xFor(currentPos.dr)}
            cy={yFor(currentPos.alt)}
            r="5"
          >
            <animate attributeName="r" values="5;8;5" dur="1s" repeatCount="indefinite" />
          </circle>
          <circle
            className="traj-rocket"
            cx={xFor(currentPos.dr)}
            cy={yFor(currentPos.alt)}
            r="10"
            fill="none"
            stroke="var(--accent2)"
            strokeWidth="1"
            opacity="0.6"
          >
            <animate attributeName="r" values="5;20;5" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.8;0;0.8" dur="1.5s" repeatCount="indefinite" />
          </circle>
        </g>
      )}
    </svg>
  );
}

function interpolateCurrent(s1, s2, t) {
  if (t < 0) return null;
  if (s2.length && t >= s2[0].t) return interpolateAt(s2, t);
  if (s1.length) return interpolateAt(s1, Math.min(t, s1[s1.length - 1].t));
  return null;
}

function pointsToPath(points, xFor, yFor) {
  if (!points.length) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(p.dr).toFixed(1)} ${yFor(p.alt).toFixed(1)}`)
    .join(' ');
}

function interpolateAt(points, t) {
  if (!points.length) return null;
  if (t <= points[0].t) return points[0];
  if (t >= points[points.length - 1].t) return points[points.length - 1];
  let i = 0;
  while (i < points.length - 1 && points[i + 1].t < t) i++;
  const a = points[i], b = points[i + 1];
  const frac = (t - a.t) / (b.t - a.t || 1);
  return {
    t,
    alt: a.alt + (b.alt - a.alt) * frac,
    vel: a.vel + (b.vel - a.vel) * frac,
    dr: a.dr + (b.dr - a.dr) * frac,
    accel: (a.accel || 0) + ((b.accel || 0) - (a.accel || 0)) * frac,
  };
}

/**
 * Snap a value up to a "nice" round scale to prevent viewport jitter.
 */
function niceScale(value) {
  if (value <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  let rounded;
  if (normalized <= 1.5) rounded = 1.5;
  else if (normalized <= 2) rounded = 2;
  else if (normalized <= 3) rounded = 3;
  else if (normalized <= 5) rounded = 5;
  else if (normalized <= 7.5) rounded = 7.5;
  else rounded = 10;
  return rounded * magnitude;
}

function niceTicks(max, count) {
  if (max <= 0) return [0];
  const step = max / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(step)));
  const normalized = step / magnitude;
  let rounded;
  if (normalized <= 1) rounded = 1;
  else if (normalized <= 2) rounded = 2;
  else if (normalized <= 2.5) rounded = 2.5;
  else if (normalized <= 5) rounded = 5;
  else rounded = 10;
  const tickSize = rounded * magnitude;
  const ticks = [];
  for (let v = 0; v <= max + 0.001; v += tickSize) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

function formatTick(v) {
  if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  if (v === Math.floor(v)) return String(v);
  return v.toFixed(1);
}
