// Open-Meteo adapter — no API key required.
// Docs: https://open-meteo.com/en/docs

import { CONFIG } from './config.js';
import { MOCK_WEATHER } from './mocks.js';

export async function fetchWeatherVSFB() {
  if (CONFIG.USE_MOCKS) return MOCK_WEATHER;
  const { lat, lon } = CONFIG.LAUNCH_SITE_COORDS;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,cloud_cover,visibility,weather_code',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'America/Los_Angeles',
  });
  const res = await fetch(`${CONFIG.OPEN_METEO_BASE}/forecast?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo failed: ${res.status}`);
  const json = await res.json();
  const c = json.current || {};
  return {
    temp_f: c.temperature_2m,
    humidity: c.relative_humidity_2m,
    wind_mph: c.wind_speed_10m,
    wind_deg: c.wind_direction_10m,
    cloud_pct: c.cloud_cover,
    visibility_m: c.visibility,
    code: c.weather_code,
    description: describeCode(c.weather_code, c.cloud_cover),
  };
}

function describeCode(code, clouds) {
  // Per WMO weather codes
  if (code === 0) return clouds > 50 ? 'partly cloudy' : 'clear';
  if (code <= 3) return 'partly cloudy';
  if (code <= 48) return 'fog';
  if (code <= 67) return 'rain';
  if (code <= 77) return 'snow';
  if (code <= 82) return 'showers';
  if (code <= 99) return 'thunderstorm';
  return 'unknown';
}

export function compassDir(deg) {
  if (deg == null) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

export function viewingScore(w) {
  if (!w) return { score: 0, label: 'unknown' };
  // Simple heuristic: visibility, cloud cover, wind
  let score = 100;
  if (w.cloud_pct > 30) score -= (w.cloud_pct - 30) * 0.8;
  if (w.wind_mph > 15) score -= (w.wind_mph - 15) * 2;
  if (w.visibility_m && w.visibility_m < 10000) score -= (10000 - w.visibility_m) / 100;
  score = Math.max(0, Math.min(100, score));
  let label = 'excellent';
  if (score < 80) label = 'good';
  if (score < 60) label = 'fair';
  if (score < 40) label = 'poor';
  return { score: Math.round(score), label };
}
