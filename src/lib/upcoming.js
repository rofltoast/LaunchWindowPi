/**
 * Upcoming-launch list utilities.
 *
 * v41 behavior:
 *
 *   1. "Far-out" launches (NET > 40 days from now) display as TBD
 *      instead of a specific calendar date. LL2 dates that far out are
 *      routinely off by weeks and give a false sense of precision on a
 *      public kiosk.
 *
 *   2. Group launches whose mission names share a meaningful prefix
 *      (e.g. "SDA Tranche 2 Transport Layer A/B/C", "Transporter-14
 *      payload #1/#2/#3", "USSF-106A/B/C"). These show as a single row
 *      with a ×N badge. This supersedes the v39 "same-day same-rocket"
 *      rule — a shared mission name is a stronger signal than a shared
 *      day, and naturally handles the rideshare case too.
 *
 * The old v39 export name `groupRideshare` is kept for compatibility so
 * the two layout components don't need to change their import name.
 */

const DAY_MS = 86_400_000;
const FAR_OUT_DAYS = 40;

export function groupRideshare(launches, { now = Date.now() } = {}) {
  if (!Array.isArray(launches) || launches.length === 0) return [];

  // First bucket by a common-prefix key. Each bucket holds launches that
  // share enough of their mission name to be plausibly the same campaign
  // (SDA Tranche 2 Transport Layer, Transporter-14, USSF-106, etc.).
  const buckets = [];
  const bucketKeys = [];

  for (const l of launches) {
    const normalized = normalizeName(l.mission_name);
    let placed = false;
    for (let i = 0; i < buckets.length; i++) {
      const shared = sharedPrefix(bucketKeys[i], normalized);
      // Require a shared prefix of at least 2 tokens AND at least 10
      // chars so random single-word overlaps ("Starlink", "NROL") don't
      // collapse unrelated missions.
      if (shared.tokens >= 2 && shared.chars >= 10) {
        buckets[i].push(l);
        bucketKeys[i] = shared.prefix;
        placed = true;
        break;
      }
    }
    if (!placed) {
      buckets.push([l]);
      bucketKeys.push(normalized);
    }
  }

  return buckets.map((arr, i) => buildGroup(arr, bucketKeys[i], now));
}

/**
 * Lowercase + collapse whitespace + strip punctuation so that
 * "SDA Tranche 2 — Transport Layer A" and
 * "SDA Tranche 2 Transport Layer B" compare token-for-token.
 */
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\u2010-\u2015\-]/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Longest shared whitespace-delimited prefix between two normalized
 * names, returned as both the joined string, the token count, and the
 * char count (for threshold checks).
 */
function sharedPrefix(a, b) {
  const ta = a.split(' ').filter(Boolean);
  const tb = b.split(' ').filter(Boolean);
  const out = [];
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    if (ta[i] !== tb[i]) break;
    out.push(ta[i]);
  }
  const prefix = out.join(' ');
  return { prefix, tokens: out.length, chars: prefix.length };
}

function buildGroup(arr, sharedKey, now) {
  const launches = arr.slice().sort((a, b) => {
    const ta = a.net ? new Date(a.net).getTime() : Infinity;
    const tb = b.net ? new Date(b.net).getTime() : Infinity;
    if (ta !== tb) return ta - tb;
    return (a.mission_name || '').localeCompare(b.mission_name || '');
  });
  const first = launches[0];
  const count = launches.length;
  const earliest = first.net ? new Date(first.net).getTime() : null;
  const farOut = earliest != null && earliest - now > FAR_OUT_DAYS * DAY_MS;

  return {
    launches,
    net: first.net,
    rocket_name: first.rocket_name,
    has_rtls: launches.some((l) => l.is_rtls),
    display_name: deriveDisplayName(launches, sharedKey),
    count,
    // "TBD" when far out (>40d), else formatted by the UI from `net`.
    far_out: farOut,
    display_date: farOut ? 'TBD' : null,
    id: first.id + (count > 1 ? `+${count - 1}` : ''),
    primary: first,
  };
}

/**
 * Pick the best display name for a group. For singletons, the raw
 * mission name. For multi-launch groups:
 *   1. If the whole group matches a known rideshare series (Transporter,
 *      Bandwagon, Starlink Group), use that.
 *   2. Otherwise: reconstruct the shared prefix using the casing from
 *      the first launch, so "sda tranche 2 transport layer" becomes
 *      "SDA Tranche 2 Transport Layer".
 *   3. Final fallback: primary name + "+N payload".
 */
function deriveDisplayName(launches, sharedKey) {
  if (launches.length === 1) return launches[0].mission_name;

  const names = launches.map((l) => l.mission_name || '').filter(Boolean);
  const patterns = [
    /\b(Transporter[-\s]?\d+)\b/i,
    /\b(Bandwagon[-\s]?\d+)\b/i,
    /\b(Starlink\s+Group\s+\d+-\d+)\b/i,
  ];
  for (const re of patterns) {
    const matches = names.map((n) => {
      const m = n.match(re);
      return m ? m[1].replace(/\s+/g, ' ').trim() : null;
    });
    if (matches.every(Boolean)) {
      const unique = new Set(matches.map((s) => s.toLowerCase()));
      if (unique.size === 1) {
        return `${matches[0]} · Rideshare`;
      }
    }
  }

  if (sharedKey && sharedKey.length >= 10) {
    const reconstructed = reconstructCasing(names[0], sharedKey);
    if (reconstructed) return reconstructed;
  }

  const extra = launches.length - 1;
  return `${launches[0].mission_name} · +${extra} payload${extra === 1 ? '' : 's'}`;
}

/**
 * Given a shared normalized-lowercase prefix and the original raw name
 * of the first launch, walk the raw name token-by-token and return the
 * same number of original tokens. This preserves user-facing casing
 * ("SDA Tranche 2 Transport Layer" instead of "sda tranche 2 …").
 */
function reconstructCasing(rawName, sharedKey) {
  const sharedTokens = sharedKey.split(' ').filter(Boolean).length;
  if (sharedTokens === 0) return null;
  // Tokenize the raw name the same way normalizeName does (split on
  // non-alphanumerics) but keep the original substrings.
  const parts = String(rawName).split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length < sharedTokens) return null;
  return parts.slice(0, sharedTokens).join(' ');
}
