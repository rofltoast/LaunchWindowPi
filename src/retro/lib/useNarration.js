import { useCallback, useEffect, useRef, useState } from 'react';
import { clipUrl } from './slots.js';

/**
 * Playback engine for narration clips over a looping music bed.
 *
 * Lifecycle:
 *   const { begin, play, busy, musicReady } = useNarration('/audio/retro-loop.mp3');
 *   await begin();                      // unlocks audio + starts bed immediately
 *   const ok = await play('weather-now'); // returns true if clip existed
 *
 * v66 design notes:
 *
 *  * Music bed starts as soon as begin() resolves — no clip preloading
 *    up front. The v65 preload-all-clips approach ate ~5s of silence
 *    before the bed came in, which was unacceptable on the kiosk.
 *
 *  * play(slot) is serialized through a single promise chain
 *    (`playQueueRef`). If play() is called twice back-to-back the
 *    second call literally waits for the first to resolve. This is
 *    the structural guarantee that two clips can't overlap or
 *    double-fire — not a guard that maybe works, an actual queue.
 *
 *  * Clip elements are cached by slot ID after first use, so the
 *    second visit to a slot reuses the same decoded element.
 *    createMediaElementSource (which may only be called once per
 *    element) is therefore only called on first play of that clip.
 *
 *  * Small visible debug log (?debug=1) shows the last few fires so
 *    it's easy to see which slot is playing when.
 */

export function useNarration(bedUrl) {
  const ctxRef = useRef(null);
  const bedElRef = useRef(null);
  // v85 — decoded AudioBufferSourceNode for the music bed.
  const bedBufSrcRef = useRef(null);
  const bedGainRef = useRef(null);
  const narGainRef = useRef(null);

  // slotId → { el, sourceNode }
  const cacheRef = useRef(/** @type {Record<string, {el: HTMLAudioElement}>} */({}));
  // Single promise chain that play() appends to — guarantees no overlap.
  const playQueueRef = useRef(Promise.resolve());

  const [musicReady, setMusicReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [debugLog, setDebugLog] = useState(/** @type {string[]} */([]));

  useEffect(() => () => {
    try { bedBufSrcRef.current?.stop?.(); } catch {}
    try { bedElRef.current?.pause?.(); } catch {}
    try { ctxRef.current?.close?.(); } catch {}
    Object.values(cacheRef.current).forEach(({ el }) => {
      try { el.pause(); } catch {}
    });
  }, []);

  const begin = useCallback(async () => {
    if (ctxRef.current) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    ctxRef.current = ctx;
    // Resume if created in 'suspended' state (headless Chrome sometimes
    // does this under --autoplay-policy even though the policy says no
    // gesture required). Without this, the audio graph connects but
    // produces zero samples to Pulse. Belt-and-suspenders.
    try { if (ctx.state === 'suspended') await ctx.resume(); } catch {}

    // Music bed — v85: decoded AudioBufferSourceNode, not
    // MediaElementSource. The old <audio>+MES path silently failed on
    // the Hetzner headless streamer: play() resolved OK, Pulse opened
    // a sink input, but zero samples ever flowed. We saw ~3s of voice
    // clips hit the monitor cleanly, then dead silence in the gaps —
    // the bed was attached to the graph but never actually driving
    // samples through it, despite being "playing". AudioBufferSource
    // bypasses MediaElement's autoplay/activation interaction entirely:
    // once start() is called on a decoded buffer, it runs until stop().
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.45;
    bedGain.connect(ctx.destination);
    bedGainRef.current = bedGain;

    const narGain = ctx.createGain();
    narGain.gain.value = 1.0;
    narGain.connect(ctx.destination);
    narGainRef.current = narGain;

    // Fetch + decode the bed in the background, then start it. We
    // don't await this before returning — that would delay begin() by
    // however long the bed takes to download. Voice clips can fire
    // immediately; the bed will fade in as soon as the buffer decodes.
    (async () => {
      try {
        const resp = await fetch(bedUrl, { cache: 'force-cache' });
        const arr = await resp.arrayBuffer();
        const buf = await ctx.decodeAudioData(arr);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(bedGain);
        src.start(0);
        bedBufSrcRef.current = src;
        // `bedEl` is kept for API compatibility (paused check etc).
        // For the new path, we fake it with an object that mirrors the
        // minimal surface the rest of this hook touches.
        bedElRef.current = { paused: false, play: () => Promise.resolve() };
        setMusicReady(true);
      } catch (e) {
        console.warn('[retro] bed decode/start failed:', e);
      }
    })();
  }, [bedUrl]);

  // Get or create the cached <audio> element for a slot. Returns null
  // if the slot has no clip file on the server.
  async function ensureClip(slot) {
    const cached = cacheRef.current[slot];
    if (cached) return cached;
    // Probe with a tiny range GET. If the clip doesn't exist we return
    // null so the runner can advance without audio.
    try {
      const probe = await fetch(clipUrl(slot), {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store',
      });
      if (!probe.ok && probe.status !== 206) return null;
    } catch {
      return null;
    }
    const ctx = ctxRef.current;
    const narGain = narGainRef.current;
    if (!ctx || !narGain) return null;
    const el = new Audio(clipUrl(slot));
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    try {
      const node = ctx.createMediaElementSource(el);
      node.connect(narGain);
    } catch (e) {
      console.warn('[retro] source node failed:', slot, e);
    }
    const entry = { el };
    cacheRef.current[slot] = entry;
    return entry;
  }

  const play = useCallback((slot) => {
    if (!slot || !ctxRef.current) return Promise.resolve(false);
    // Append to the serialization chain — the only way two plays can
    // ever run is one-after-the-other.
    const next = playQueueRef.current.then(() => runOne());
    playQueueRef.current = next.catch(() => {});
    return next;

    async function runOne() {
      const ctx = ctxRef.current;
      const bedGain = bedGainRef.current;
      if (!ctx || !bedGain) return false;

      // v85 — music bed is an AudioBufferSourceNode now, started
      // from begin(). No per-clip recovery kick needed; if the buffer
      // didn't decode/start we'll see it in console and the gain node
      // stays at whatever level we set. Keeping a resume() guard for
      // the AudioContext in case it suspended mid-life (tab hidden,
      // etc.) — cheap to call when already running.
      try { if (ctx.state === 'suspended') await ctx.resume(); } catch {}

      const entry = await ensureClip(slot);
      if (!entry) {
        console.warn('[retro] clip missing:', slot);
        return false;
      }

      const stamp = new Date().toLocaleTimeString();
      setDebugLog((prev) => [`${stamp}  ${slot}`, ...prev].slice(0, 5));
      // eslint-disable-next-line no-console
      console.log('[retro] play →', slot, '@', stamp);

      // Rewind this clip (and pause every other cached clip, in case
      // a stray one is still draining).
      Object.entries(cacheRef.current).forEach(([id, e]) => {
        if (id === slot) return;
        try { e.el.pause(); } catch {}
      });
      const el = entry.el;
      try { el.pause(); } catch {}
      try { el.currentTime = 0; } catch {}

      const t0 = ctx.currentTime;
      bedGain.gain.cancelScheduledValues(t0);
      bedGain.gain.linearRampToValueAtTime(0.12, t0 + 0.3);
      setBusy(true);

      const ok = await new Promise((resolve) => {
        let settled = false;
        const finish = (v) => {
          if (settled) return;
          settled = true;
          el.removeEventListener('ended', onEnd);
          el.removeEventListener('error', onErr);
          clearTimeout(safety);
          resolve(v);
        };
        const onEnd = () => finish(true);
        const onErr = () => { console.warn('[retro] clip error:', slot); finish(false); };
        el.addEventListener('ended', onEnd);
        el.addEventListener('error', onErr);
        const est = (Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 30) * 1000 + 2000;
        const safety = window.setTimeout(() => finish(true), Math.min(est, 30000));
        el.play().catch((e) => { console.warn('[retro] clip play blocked:', e); finish(false); });
      });

      const t1 = ctx.currentTime;
      bedGain.gain.cancelScheduledValues(t1);
      bedGain.gain.linearRampToValueAtTime(0.45, t1 + 0.6);
      setBusy(false);
      return ok;
    }
  }, []);

  const stop = useCallback(() => {
    Object.values(cacheRef.current).forEach(({ el }) => {
      try { el.pause(); } catch {}
    });
    const bedGain = bedGainRef.current;
    if (bedGain && ctxRef.current) {
      const t = ctxRef.current.currentTime;
      bedGain.gain.cancelScheduledValues(t);
      bedGain.gain.linearRampToValueAtTime(0.45, t + 0.3);
    }
    setBusy(false);
  }, []);

  /** Duck the music bed while an external audio source (e.g. a skit
   *  video with its own dialogue) is playing. `on=true` pulls the bed
   *  down to a whisper; `on=false` restores normal level. */
  const duck = useCallback((on) => {
    const bedGain = bedGainRef.current;
    const ctx = ctxRef.current;
    if (!bedGain || !ctx) return;
    const t = ctx.currentTime;
    bedGain.gain.cancelScheduledValues(t);
    bedGain.gain.linearRampToValueAtTime(on ? 0.08 : 0.45, t + 0.4);
  }, []);

  // Video-gain wiring — route a <video> element's audio through Web
  // Audio so we can apply a per-skit gain that can exceed 1.0 (the
  // native video.volume caps at 1). Each element may only be wrapped
  // in createMediaElementSource ONCE per AudioContext, so we cache the
  // source node per element and reuse it.
  const videoGainCacheRef = useRef(
    /** @type {WeakMap<HTMLMediaElement, GainNode>} */ (new WeakMap()),
  );

  /**
   * Attach the given video element to Web Audio and set its gain. If
   * the AudioContext isn't ready yet (begin() hasn't run), falls back
   * to element.volume (capped at 1). Returns a setter the caller can
   * use to change gain later (e.g. when the next skit has a different
   * level). Safe to call multiple times per element.
   */
  const attachVideoGain = useCallback((el, gain) => {
    if (!el) return () => {};
    const clean = Math.max(0, Number.isFinite(gain) ? gain : 1);
    const ctx = ctxRef.current;
    if (!ctx) {
      // Audio context not up yet — approximate with native volume.
      try { el.volume = Math.min(1, clean); } catch {}
      return (g) => { try { el.volume = Math.min(1, Math.max(0, Number(g) || 0)); } catch {} };
    }
    let gainNode = videoGainCacheRef.current.get(el);
    if (!gainNode) {
      try {
        const src = ctx.createMediaElementSource(el);
        gainNode = ctx.createGain();
        src.connect(gainNode).connect(ctx.destination);
        videoGainCacheRef.current.set(el, gainNode);
      } catch (e) {
        // Some browsers throw if the element was already bound to
        // a different context. Fall back to native volume.
        console.warn('[retro] video gain attach failed:', e);
        try { el.volume = Math.min(1, clean); } catch {}
        return (g) => { try { el.volume = Math.min(1, Math.max(0, Number(g) || 0)); } catch {} };
      }
    }
    // native volume stays at 1 so GainNode fully controls level.
    try { el.volume = 1; } catch {}
    const t = ctx.currentTime;
    gainNode.gain.cancelScheduledValues(t);
    gainNode.gain.setValueAtTime(clean, t);
    return (g) => {
      const v = Math.max(0, Number.isFinite(g) ? g : 1);
      const tt = ctx.currentTime;
      gainNode.gain.cancelScheduledValues(tt);
      gainNode.gain.linearRampToValueAtTime(v, tt + 0.05);
    };
  }, []);

  return { begin, play, stop, duck, attachVideoGain, busy, musicReady, debugLog };
}
