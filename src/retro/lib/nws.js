/**
 * NWS (api.weather.gov) client — goes through our nginx proxy at
 * /api/nws/ to keep the User-Agent header set correctly and cache
 * responses (NWS is free but asks for respectful polling).
 *
 * We care about three endpoints:
 *   GET /stations/KLPC/observations/latest   -> current conditions
 *   GET /gridpoints/LOX/117,64/forecast      -> 36h forecast (periods[])
 *   GET /products/types/AFD/locations/LOX    -> Area Forecast Discussion
 *     (for marine layer / fog callouts)
 *
 * Station/gridpoint coordinates:
 *   KLPC = Lompoc Airport — nearest METAR to VSFB
 *   LOX/117,64 = the NWS LOX WFO grid cell covering VSFB pads
 *   Derived once from api.weather.gov/points/34.7420,-120.5724
 */

const BASE = '/api/nws';

async function jget(path) {
  const res = await fetch(BASE + path, { headers: { Accept: 'application/geo+json' } });
  if (!res.ok) throw new Error(`NWS ${path} failed: ${res.status}`);
  return res.json();
}

/** Current observation at KLPC. Returns a simplified shape. */
export async function fetchCurrent() {
  const j = await jget('/stations/KLPC/observations/latest');
  const p = j.properties || {};
  return {
    observedAt: p.timestamp,
    tempC: p.temperature?.value ?? null,
    tempF: p.temperature?.value == null ? null : p.temperature.value * 9 / 5 + 32,
    dewpointC: p.dewpoint?.value ?? null,
    windDirDeg: p.windDirection?.value ?? null,
    windSpeedKph: p.windSpeed?.value ?? null,   // m/s — actually; NWS labels it "km_h-1" but returns m/s in metric
    windSpeedMph: p.windSpeed?.value == null ? null : p.windSpeed.value * 2.23694,
    windGustMph: p.windGust?.value == null ? null : p.windGust.value * 2.23694,
    visibilityMi: p.visibility?.value == null ? null : p.visibility.value / 1609.344,
    relativeHumidity: p.relativeHumidity?.value ?? null,
    cloudLayers: (p.cloudLayers || []).map((c) => ({
      amount: c.amount,
      baseFt: c.base?.value == null ? null : c.base.value * 3.28084,
    })),
    text: p.textDescription || '',
    barometricMb: p.barometricPressure?.value == null ? null : p.barometricPressure.value / 100,
    iconUrl: p.icon || null,
  };
}

/** 36-hour forecast (periods[]). */
export async function fetchForecast() {
  const j = await jget('/gridpoints/LOX/117,64/forecast');
  const periods = (j.properties?.periods || []).slice(0, 6).map((p) => ({
    name: p.name,
    isDaytime: p.isDaytime,
    tempF: p.temperature,
    tempUnit: p.temperatureUnit,
    wind: p.windSpeed,
    windDir: p.windDirection,
    short: p.shortForecast,
    detailed: p.detailedForecast,
    icon: p.icon,
    startTime: p.startTime,
    endTime: p.endTime,
  }));
  return { periods };
}

/**
 * Marine layer / fog callout — pulled from the Area Forecast Discussion
 * by heuristically grabbing the AVIATION and MARINE sections (short).
 * Falls back to null if NWS is flaky.
 */
export async function fetchMarineCallout() {
  try {
    const j = await jget('/products/types/AFD/locations/LOX');
    const latest = j['@graph']?.[0];
    if (!latest?.id) return null;
    const product = await jget(`/products/${latest.id.split('/').pop()}`);
    const text = product.productText || '';
    const grab = (label) => {
      const re = new RegExp(`${label}[\\s\\.]*\\n([\\s\\S]*?)(?:\\n\\.[A-Z]|\\n\\$\\$)`, 'i');
      const m = text.match(re);
      return m ? m[1].replace(/\s+/g, ' ').trim() : null;
    };
    return {
      marine: grab('\\.MARINE'),
      aviation: grab('\\.AVIATION'),
      issuedAt: product.issuanceTime || null,
    };
  } catch {
    return null;
  }
}

/**
 * Current observation for an arbitrary METAR station (for the weather
 * map slide — KPRB, KCSL, KSMX, KLPC, KSBA, etc). Returns { tempF, text }
 * or null on any failure. Kept *cheap* (no cloudLayers, etc.) — the map
 * only needs the temperature chip.
 */
export async function fetchCurrentAt(stationId) {
  try {
    const j = await jget(`/stations/${stationId}/observations/latest`);
    const p = j.properties || {};
    const c = p.temperature?.value;
    const tempF = c == null ? null : Math.round(c * 9 / 5 + 32);
    return { tempF, text: p.textDescription || '' };
  } catch {
    return null;
  }
}

/** Friendly wind direction from degrees. */
export function windDir(deg) {
  if (deg == null) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}
