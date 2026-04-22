import { useEffect, useMemo, useState } from 'react';
import { fetchCurrent, fetchCurrentAt, fetchForecast } from './nws.js';
import { fetchUpcomingVSFBLaunches } from '../../lib/ll2.js';
import { buildFacts } from '../../lib/quick-facts.js';
import { WEATHER_MAP_CITIES } from './slots.js';

/**
 * Single hook that loads everything the slideshow needs. Refreshes:
 *   - weather map (5 Central Coast cities) every 10 min
 *   - launches every 5 min
 *   - facts pool derived from ambient STATIC_FACTS + launch-contextual
 *     extras (same source the ambient view uses)
 */
export function useRetroData() {
  // v79 — added updatedAt so the UI can prove to the viewer that the
  // chips are polling. Also bumped the refresh cadence from 10m -> 5m
  // so a visible "UPDATED HH:MM" timestamp rolls over on camera.
  const [weather, setWeather] = useState({
    current: null,
    forecast: null,
    cities: [],
    updatedAt: null,
  });
  const [launches, setLaunches] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function refreshWeather() {
      try {
        // Parallel: KLPC headline + forecast + every map city.
        // fetchCurrentAt swallows its own errors so one flaky station
        // doesn't nuke the whole map.
        const [current, forecast, ...cityObs] = await Promise.all([
          fetchCurrent().catch(() => null),
          fetchForecast().catch(() => null),
          ...WEATHER_MAP_CITIES.map((c) => fetchCurrentAt(c.code)),
        ]);
        const cities = WEATHER_MAP_CITIES.map((c, i) => ({
          ...c,
          obs: cityObs[i] || null,
        }));
        // Only stamp updatedAt when we actually got at least one live
        // observation; otherwise we'd be lying about liveness.
        const gotAny = cityObs.some((o) => o && o.tempF != null) || current?.tempF != null;
        if (!cancelled) setWeather({
          current,
          forecast,
          cities,
          updatedAt: gotAny ? new Date().toISOString() : null,
        });
      } catch (e) {
        if (!cancelled) setErr(e);
      }
    }
    async function refreshLaunches() {
      try {
        // v79 — was 5, bumped to 12 so the slide has enough rows to
        // warrant the auto-scroll behavior when overflowing.
        const list = await fetchUpcomingVSFBLaunches({ limit: 12 });
        if (!cancelled) setLaunches(list || []);
      } catch (e) {
        if (!cancelled) setErr(e);
      }
    }
    refreshWeather();
    refreshLaunches();
    // v79 — refresh weather every 5m (was 10m) so the "UPDATED" label
    // on the map visibly rolls over during a typical kiosk viewing.
    const w = setInterval(refreshWeather, 5 * 60 * 1000);
    const l = setInterval(refreshLaunches, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(w); clearInterval(l); };
  }, []);

  // Facts pool — same source as the ambient view. Rebuild when the
  // lead launch changes so booster-specific facts update.
  const leadLaunch = launches[0] || null;
  const facts = useMemo(() => buildFacts(leadLaunch, null), [leadLaunch]);

  return { weather, launches, facts, err };
}
