/**
 * Stale-data warning banner. Rendered when the app hasn't successfully
 * refreshed LL2 in more than STALE_DATA_THRESHOLD_MS (20 min default).
 *
 * Why this exists: on Apr 19 a VSFB launch got scrubbed from ~7:50 to
 * 9:00 AM. Right around the same time, LL2's free tier started 429ing
 * us, so the kiosk's last cached response still had the 7:50 NET. The
 * countdown ticked to zero, the app flipped into live mode, and played
 * telemetry for a rocket that wasn't actually going anywhere. This
 * banner makes the staleness loud — in red, flashing the longer it's
 * been — so anyone watching the kiosk knows the countdown might be
 * wrong and to verify on spacex.com.
 */
export function StaleDataBanner({ dataAgeMs, ll2Status }) {
  const mins = Math.floor((dataAgeMs || 0) / 60_000);
  const ageLabel = mins < 60
    ? `${mins}m`
    : `${Math.floor(mins / 60)}h ${mins % 60}m`;

  const reason = (() => {
    if (ll2Status === 'rate-limited') return 'LL2 rate-limited';
    if (ll2Status === 'error') return 'LL2 unreachable';
    return 'LL2 not responding';
  })();

  return (
    <div
      className="warn-flash"
      style={{
        marginBottom: 10,
        padding: '6px 12px',
        background: '#d1312a',
        color: '#fff',
        fontWeight: 700,
        letterSpacing: 2,
        fontSize: 'clamp(10px, 0.8vw + 3px, 13px)',
        textAlign: 'center',
        border: '2px solid #ff6b63',
        borderRadius: 2,
        textShadow: '0 0 6px rgba(0,0,0,0.4)',
        lineHeight: 1.35,
      }}
    >
      ⚠ DATA STALE · {ageLabel.toUpperCase()} · {reason.toUpperCase()} · verify liftoff on spacex.com
    </div>
  );
}
