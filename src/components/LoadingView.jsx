import { useEffect, useState, useRef } from 'react';
import { Box } from './Box.jsx';
import headImg from '../assets/josh-head.png';

// Quippy one-liners that cycle during the loading bar. New one every ~1.1s.
// Keep them short so they fit on one line on small panels.
const QUIPS = [
  'fueling rockets...',
  'convincing the FAA we are not lost...',
  'briefing pad 4E cat about sonic booms...',
  'taring the scales on stage 1...',
  'polishing the payload fairing...',
  'negotiating with elon for a cheaper falcon...',
  'calibrating the weather oracle...',
  'asking the marine layer to please move along...',
  'running launch-library rate-limit detox...',
  'listening for booster burps over lompoc...',
  'reticulating splines on the trajectory...',
  'adjusting the attitude-control thrusters...',
  'pretending we understand orbital mechanics...',
  'dusting off the sonic-boom warning siren...',
  'double-checking we are pointed at space...',
  'asking josh if the kiosk is plugged in...',
  // --- batch 2: more nonsense ---
  'torquing bolt 37 to factory spec...',
  'waking up the range safety officer...',
  'filing flight plan with neptune...',
  'chasing the pelican off the crawlerway...',
  'topping off the LOX with a funnel...',
  'staring at the countdown clock meaningfully...',
  'arguing with merlin about thrust curves...',
  'reminding the booster it needs to come back...',
  'asking SLC-4E nicely to not be on fire...',
  'checking if we remembered the payload...',
  'locating the missing allen wrench...',
  'reading the falcon manual cover to cover...',
  'bribing the winds aloft forecast...',
  'counting backward from ten thousand...',
  'yelling "we have ignition" at nothing in particular...',
  'verifying the rocket points the correct way up...',
  'asking bezos if we can borrow a second stage...',
  'dusting off the holy water for stage 2 sep...',
  'pinging ground control major tom...',
  'warming up the RP-1 with our hands...',
  'waiting for the green light from the buffalo...',
  'rebooting the second stage just in case...',
  'googling what a droneship is...',
  'rephrasing the pre-flight checklist as a haiku...',
  'asking the seagull to please step aside...',
];

// Pick a random starting index so successive reloads don't start on the same quip.
function pickStartIdx() {
  return Math.floor(Math.random() * QUIPS.length);
}

/**
 * LoadingView — shown before the first launch-list fetch resolves, and as
 * the "no upcoming launches" empty state. Shows a progress bar that fills
 * over ~5-6s, cycling quippy messages, with Josh's head riding along the
 * top of the bar with a bounce.
 *
 * The progress doesn't represent real work; it's purely decorative. When
 * `isEmpty` is true (data loaded, but no launches for VSFB) we show a
 * gentler idle-state message after the bar completes instead of looping.
 */
export function LoadingView({ isEmpty = false, ll2Status = 'loading' }) {
  // `isEmpty` is kept for backward-compat, but `ll2Status` is the
  // source of truth now. Map the old prop onto the new one if callers
  // still pass it, so neither signal gets lost.
  if (isEmpty && ll2Status === 'loading') ll2Status = 'empty';
  // `progress` in 0..100. Animated via requestAnimationFrame so we get
  // smooth head motion, not a 10-step CSS transition.
  const [progress, setProgress] = useState(0);
  const [quipIdx, setQuipIdx] = useState(pickStartIdx);
  const [cycle, setCycle] = useState(0); // how many times the bar has refilled
  const startRef = useRef(null);

  const DURATION_MS = 5500;  // bar takes 5.5s to fill — satisfies "at least 5s"

  // Progress bar animation (one full fill per cycle, looping forever)
  useEffect(() => {
    let raf;
    function tick(ts) {
      if (startRef.current == null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const pct = Math.min(100, (elapsed / DURATION_MS) * 100);
      setProgress(pct);
      if (pct >= 100) {
        // Restart the cycle. 250ms pause at full before resetting so the
        // eye registers "complete" before it slams back to 0.
        setTimeout(() => {
          startRef.current = null;
          setProgress(0);
          setCycle((c) => c + 1);
        }, 250);
        return;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cycle]);

  // Rotate quips about every 1.1s — roughly 5 quips per fill cycle.
  useEffect(() => {
    const id = setInterval(() => {
      setQuipIdx((i) => (i + 1) % QUIPS.length);
    }, 1100);
    return () => clearInterval(id);
  }, []);

  // Head physics: X follows progress, Y bounces on a sine wave.
  // The sine frequency is tied to the progress so each full-bar has
  // ~4 bounces — visually feels like hops across stepping stones.
  const headSizePx = 56;
  const bounceHeight = 28; // px above the baseline at peak
  const bounces = 4;
  const phase = (progress / 100) * Math.PI * bounces;
  const yOffset = -Math.abs(Math.sin(phase)) * bounceHeight; // negative = up

  // Title + subtitle copy per status. When we're rate-limited the user
  // should know that explicitly — the backoff will retry in ~1-15 min
  // depending on how many consecutive failures we've had. Colour-wise,
  // only the rate-limit state uses the warn/accent tone.
  const copy = (() => {
    switch (ll2Status) {
      case 'rate-limited':
        return {
          title: 'LL2 RATE LIMIT EXCEEDED',
          subtitle: 'thespacedevs free tier is ~15 req/hr · backing off and retrying',
          tone: 'warn',
        };
      case 'error':
        return {
          title: 'LL2 UNREACHABLE',
          subtitle: 'can\'t reach ll.thespacedevs.com · retrying with backoff',
          tone: 'warn',
        };
      case 'empty':
        return {
          title: 'NO UPCOMING VSFB LAUNCHES',
          subtitle: 'checking every 10 minutes · sit tight',
          tone: 'accent1',
        };
      case 'entering-live':
        return {
          title: 'ENTERING LIVE VIEW',
          subtitle: 'spooling trajectory data · standby for telemetry',
          tone: 'accent1',
        };
      case 'loading':
      default:
        return {
          title: 'LOADING LAUNCH LIBRARY',
          subtitle: 'fetching data from ll.thespacedevs.com',
          tone: 'accent1',
        };
    }
  })();
  const { title, subtitle, tone } = copy;

  return (
    <div className="ambient-grid">
      <Box title="KIOSK STATUS" className="ambient-hero">
        <div style={{ padding: '20px 10px 10px', textAlign: 'center' }}>
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

          {/* Bouncing-head progress bar. Track is the usual .bar; the head
              is absolutely positioned, translated via transform for 60fps. */}
          <div
            style={{
              position: 'relative',
              marginTop: 40,
              marginLeft: headSizePx / 2,
              marginRight: headSizePx / 2,
              height: headSizePx + 20,
            }}
          >
            {/* Bouncing head. Positioned so its bottom sits just above the bar. */}
            <img
              src={headImg}
              alt="josh"
              style={{
                position: 'absolute',
                left: `calc(${progress}% - ${headSizePx / 2}px)`,
                bottom: `calc(12px + ${-yOffset}px)`,
                width: headSizePx,
                height: 'auto',
                pointerEvents: 'none',
                // Tiny shadow so the head reads even on lighter themes
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
                // Rotate a little based on sine so it feels alive
                transform: `rotate(${Math.sin(phase) * 6}deg)`,
                transition: 'none',
              }}
            />
            {/* Progress bar track + fill, pinned to bottom of this block */}
            <div
              className="bar"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 10,
              }}
            >
              <div
                className="bar-fill"
                style={{
                  width: `${progress}%`,
                  background:
                    'linear-gradient(90deg, var(--accent2), var(--accent1), var(--accent3))',
                  transition: 'none',
                }}
              />
            </div>
          </div>

          {/* Quippy rotating status line */}
          <div
            style={{
              marginTop: 24,
              fontSize: 'clamp(12px, 0.8vw + 5px, 16px)',
              minHeight: '1.6em',
            }}
          >
            <span className="dim">&gt;&nbsp;</span>
            <span className="accent3" key={quipIdx} style={{ animation: 'fadeIn 0.25s ease-out' }}>
              {QUIPS[quipIdx]}
            </span>
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
    </div>
  );
}
