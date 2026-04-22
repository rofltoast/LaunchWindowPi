import { useEffect, useRef } from 'react';

export function useInterval(callback, delay) {
  const savedCallback = useRef();
  useEffect(() => { savedCallback.current = callback; }, [callback]);
  useEffect(() => {
    if (delay == null) return;
    const tick = () => savedCallback.current && savedCallback.current();
    const id = setInterval(tick, delay);
    return () => clearInterval(id);
  }, [delay]);
}

export function formatTMinus(seconds) {
  if (seconds == null) return '--:--:--';
  const sign = seconds < 0 ? '+' : '-';
  const abs = Math.abs(seconds);
  const h = String(Math.floor(abs / 3600)).padStart(2, '0');
  const m = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(abs % 60)).padStart(2, '0');
  return `T${sign}${h}:${m}:${s}`;
}

export function formatCountdown(seconds) {
  if (seconds == null) return '--:--:--';
  const abs = Math.abs(seconds);
  if (abs >= 86400) {
    const d = Math.floor(abs / 86400);
    const h = Math.floor((abs % 86400) / 3600);
    return `${d}d ${String(h).padStart(2, '0')}h`;
  }
  const h = String(Math.floor(abs / 3600)).padStart(2, '0');
  const m = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(abs % 60)).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
