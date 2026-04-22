import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SKIT_SLOTS, SLOT_GROUPS, skitUrl } from '../../retro/lib/slots.js';
import '../../retro/styles/retro.css';

/**
 * Narrator Studio — v67 record-in-browser.
 *
 * Workflow:
 *   1. Page loads and shows all 24 slots (4 slides × 6 takes) grouped by slide.
 *   2. User clicks "ENABLE MICROPHONE" once — the browser permission prompt
 *      appears. After approval, a RECORD button lights up on every slot.
 *   3. Click RECORD → captures audio via MediaRecorder → becomes the slot's
 *      pending file → user previews, then hits UPLOAD + FILTER.
 *   4. File-drop / CHOOSE FILE path still works alongside recording.
 *
 * Pi endpoints used (unchanged from v57):
 *   GET    /voice-api/status           -> slot presence/mtime
 *   GET    /voice-api/templates        -> script lines per slot
 *   PUT    /voice-api/templates        -> edit script lines
 *   POST   /voice-api/:slot            -> upload + pi runs retro chain
 *   POST   /voice-api/:slot/reprocess  -> re-run ffmpeg on stored raw
 *   DELETE /voice-api/:slot            -> remove clip
 *   GET    /voice/:slot.mp3            -> audio preview
 *
 * Mic permission notes:
 *   - getUserMedia requires a secure context (https:// or localhost). The
 *     kiosk is served over the cloudflared tunnel (https), so on the real
 *     deploy this is fine. On direct-LAN http:// it will fail — we detect
 *     that and show a helpful banner.
 *   - We request permission lazily (on click), not on mount, so the page
 *     loads without a browser prompt. After approval the stream is reused
 *     across all subsequent recordings in the same session.
 */

// Suggested delivery cue per slide. All six takes for a slide share the
// same cue — the takes rotate automatically so we just need one vibe.
const SLIDE_META = {
  forecast: {
    title: 'FORECAST INTRO (weather map)',
    sub: 'Plays when the Central-Coast weather map slide appears.',
    cue: 'Brooklyn 99 energy. Calm-ish, weather-anchor toss. Keep it under ~10s.',
  },
  launch: {
    title: 'LAUNCH INTRO',
    sub: 'Plays when the upcoming-launches slide appears.',
    cue: 'A little more gas than forecast — like announcing a rocket at a ballpark.',
  },
  facts: {
    title: 'QUICK FACTS INTRO',
    sub: 'Plays when the rotating-facts slide appears.',
    cue: 'Bright, curious, fast. Treat it like an exclamation more than a sentence.',
  },
  signoff: {
    title: 'SIGN-OFF',
    sub: 'Plays over the Josh-head logo at the end of the cycle.',
    cue: 'Warm, dry. Land the bit. Goofy > serious.',
  },
};

export default function RetroAdmin() {
  const [status, setStatus] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [dirty, setDirty] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  // v71: separate status for the skit video slots
  const [skitStatus, setSkitStatus] = useState(null);

  // Shared mic state. Once the user clicks "ENABLE MICROPHONE" we keep
  // the stream alive and expose a factory for the per-slot recorders
  // so we only prompt once per session.
  const micStreamRef = useRef(null);
  const [micState, setMicState] = useState('idle'); // 'idle'|'requesting'|'ready'|'denied'|'unsupported'
  const [micError, setMicError] = useState(null);

  useEffect(() => () => {
    // Release the mic when the page unmounts so the OS indicator goes away.
    try { micStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
  }, []);

  const secureOk = typeof window !== 'undefined' && (
    window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  );
  const hasGUM = typeof navigator !== 'undefined'
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function'
    && typeof window.MediaRecorder === 'function';

  async function enableMic() {
    if (!secureOk) {
      setMicState('unsupported');
      setMicError('Microphone recording requires an https:// URL (or localhost). Use the tunnel URL, or drop an audio file instead.');
      return;
    }
    if (!hasGUM) {
      setMicState('unsupported');
      setMicError('This browser does not support MediaRecorder. Try a recent Chrome, Safari, or Firefox, or upload an audio file.');
      return;
    }
    setMicState('requesting');
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = stream;
      setMicState('ready');
    } catch (e) {
      const name = e?.name || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setMicState('denied');
        setMicError('Microphone permission was denied. Click the 🔒 in the address bar → Site settings → allow Microphone, then reload.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setMicState('denied');
        setMicError('No microphone detected. Plug one in, then click ENABLE MICROPHONE again.');
      } else {
        setMicState('denied');
        setMicError(`Could not start microphone: ${e?.message || name || e}`);
      }
    }
  }

  async function refresh() {
    try {
      const [s, t, sk] = await Promise.all([
        fetch('/voice-api/status').then((r) => r.json()),
        fetch('/voice-api/templates').then(async (r) => (r.status === 404 ? {} : r.json())),
        fetch('/skit-api/list').then(async (r) => (r.ok ? r.json() : { skits: [] })).catch(() => ({ skits: [] })),
      ]);
      setStatus(s);
      setTemplates(t);
      setSkitStatus(sk);
      setError(null);
    } catch (e) {
      setError(`load failed: ${e.message}`);
    }
  }

  // Build skit slot list merged with server presence info.
  const skitRows = useMemo(() => {
    const byId = new Map();
    for (const sk of (skitStatus?.skits || [])) byId.set(sk.slot, sk);
    return SKIT_SLOTS.map((s) => {
      const present = byId.get(s.id);
      return {
        slot: s.id,
        label: s.label,
        episodeTitle: s.episodeTitle,
        bytes: present?.bytes ?? 0,
        ext: present?.ext ?? null,
        mtime: present?.mtime ?? null,
        present: Boolean(present),
        // v75: per-skit volume gain (0..3). 1 = as-recorded. Server
        // stores this in /data/voice/skits/_meta.json.
        gain: Number(present?.gain ?? 1),
      };
    });
  }, [skitStatus]);

  useEffect(() => { refresh(); }, []);

  // Flatten SLOT_GROUPS into per-slot entries with status+template data so
  // the uploader rows can render directly.
  const groupsWithData = useMemo(() => {
    const byId = new Map();
    for (const s of (status?.slots || [])) byId.set(s.slot, s);
    return SLOT_GROUPS.map((g) => ({
      ...g,
      meta: SLIDE_META[g.id] || { title: g.label, sub: '', cue: '' },
      slots: g.slots.map((slot) => ({
        slot: slot.id,
        takeLabel: slot.label,
        bytes: byId.get(slot.id)?.bytes ?? 0,
        mtime: byId.get(slot.id)?.mtime ?? null,
        processed: byId.get(slot.id)?.processed ?? false,
        // v77: per-take portrait — overrides the default MGS-codec grid
        // when the (dormant) portrait overlay is re-enabled.
        hasPortrait: byId.get(slot.id)?.hasPortrait ?? false,
        portraitExt: byId.get(slot.id)?.portraitExt ?? null,
        portraitMtime: byId.get(slot.id)?.portraitMtime ?? null,
        template: templates?.[slot.id] ?? '',
      })),
    }));
  }, [status, templates]);

  // Any slots the server has that aren't part of the v66 catalog show up
  // in a leftover section so Josh can delete stale recordings.
  const knownIds = useMemo(
    () => new Set(SLOT_GROUPS.flatMap((g) => g.slots.map((s) => s.id))),
    [],
  );
  const extraSlots = useMemo(() => {
    const extras = (status?.slots || []).filter((s) => !knownIds.has(s.slot));
    return extras.map((s) => ({
      slot: s.slot,
      takeLabel: 'legacy',
      bytes: s.bytes ?? 0,
      mtime: s.mtime ?? null,
      processed: s.processed ?? false,
      hasPortrait: s.hasPortrait ?? false,
      portraitExt: s.portraitExt ?? null,
      portraitMtime: s.portraitMtime ?? null,
      template: templates?.[s.slot] ?? '',
    }));
  }, [status, templates, knownIds]);

  async function saveTemplates() {
    setSaving(true);
    try {
      const next = { ...(templates || {}), ...dirty };
      for (const k of Object.keys(next)) if (!next[k]) delete next[k];
      const res = await fetch('/voice-api/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(await res.text());
      setDirty({});
      setToast('scripts saved');
      await refresh();
    } catch (e) {
      setError(`save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  function flash(msg) {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200);
  }

  const dirtyCount = Object.keys(dirty).length;

  return (
    <div className="rt-admin">
      <h1>VSFB-TV · NARRATOR STUDIO</h1>
      <div className="rt-sub">
        Record each take right here in the browser, or drop an audio file in. The pi runs the
        VHS/CRT filter server-side, so any format works — <code>.m4a</code>, <code>.wav</code>,{' '}
        <code>.mp3</code>, <code>.aiff</code>, <code>.webm</code>. Each slide has <strong>six
        takes</strong> — the kiosk rotates them so repeat viewers hear variety.
      </div>

      <MicBanner micState={micState} micError={micError} onEnable={enableMic} />

      {error ? <div className="rt-error">⚠ {error}</div> : null}
      {toast ? <div className="rt-toast">{toast}</div> : null}

      <div className="rt-studio-actions">
        <button type="button" onClick={saveTemplates} disabled={dirtyCount === 0 || saving}>
          {saving ? 'SAVING…' : dirtyCount > 0 ? `SAVE ${dirtyCount} SCRIPT${dirtyCount === 1 ? '' : 'S'}` : 'SCRIPTS SAVED'}
        </button>
        <button type="button" onClick={refresh} disabled={saving}>REFRESH</button>
        <a className="rt-link" href="/retro" target="_blank" rel="noreferrer">OPEN /RETRO ▶</a>
      </div>

      {groupsWithData.map((group) => (
        <div className="rt-group" key={group.id}>
          <div className="rt-group-head">
            <h2>{group.meta.title}</h2>
            {group.meta.sub ? <div className="rt-group-sub">{group.meta.sub}</div> : null}
            {group.meta.cue ? <div className="rt-group-cue"><em>Delivery:</em> {group.meta.cue}</div> : null}
          </div>
          <div className="rt-upload-grid">
            {group.slots.map((s) => (
              <SlotUploader
                key={s.slot}
                slot={s}
                dirtyText={dirty[s.slot]}
                micState={micState}
                micStreamRef={micStreamRef}
                onEdit={(text) => setDirty((d) => ({ ...d, [s.slot]: text }))}
                onAfterMutate={async (label) => { flash(label); await refresh(); }}
                onError={(msg) => setError(msg)}
              />
            ))}
          </div>
        </div>
      ))}

      {extraSlots.length > 0 && (
        <div className="rt-group">
          <div className="rt-group-head">
            <h2>LEGACY / EXTRA SLOTS</h2>
            <div className="rt-group-sub">
              Slots on the pi that aren't part of the current v66 catalog. Safe to delete.
            </div>
          </div>
          <div className="rt-upload-grid">
            {extraSlots.map((s) => (
              <SlotUploader
                key={s.slot}
                slot={s}
                dirtyText={dirty[s.slot]}
                micState={micState}
                micStreamRef={micStreamRef}
                onEdit={(text) => setDirty((d) => ({ ...d, [s.slot]: text }))}
                onAfterMutate={async (label) => { flash(label); await refresh(); }}
                onError={(msg) => setError(msg)}
              />
            ))}
          </div>
        </div>
      )}

      {/* v71: Rocket News skit videos. Plays between full cycles of the
          show (after sign-off) and rotates 1 → 12 in order so the
          character-devolution arc airs in sequence. */}
      <div className="rt-group rt-group-skits">
        <div className="rt-group-head">
          <h2>ROCKET NEWS · SKIT VIDEOS</h2>
          <div className="rt-group-sub">
            One video per episode, played in order between full cycles of the show.
            Accepts <code>.mp4</code>, <code>.webm</code>, <code>.mov</code>, <code>.m4v</code>, <code>.mkv</code>, <code>.ogv</code>.
            Missing episodes are skipped automatically.
          </div>
          <div className="rt-group-cue">
            <em>Arc (6 eps):</em> 1–2 professional phase, 3–4 cracks showing, 5–6 unqualified / full DGAF.
            Keep each skit under ~60s so the broadcast keeps moving.
          </div>
        </div>
        <div className="rt-upload-grid">
          {skitRows.map((row) => (
            <SkitUploader
              key={row.slot}
              row={row}
              onAfterMutate={async (label) => { flash(label); await refresh(); }}
              onError={(msg) => setError(msg)}
            />
          ))}
        </div>
      </div>

      <HelpPanel />
    </div>
  );
}

function MicBanner({ micState, micError, onEnable }) {
  if (micState === 'ready') {
    return (
      <div className="rt-mic-banner rt-mic-ok">
        <strong>MIC READY.</strong> Recording is armed on every slot below. Click RECORD, speak your take,
        click STOP, then preview before UPLOAD + FILTER.
      </div>
    );
  }
  if (micState === 'denied' || micState === 'unsupported') {
    return (
      <div className="rt-mic-banner rt-mic-warn">
        <strong>MIC UNAVAILABLE.</strong> {micError}
        <div style={{ marginTop: 8 }}>
          You can still <em>drag-and-drop</em> or <em>CHOOSE FILE</em> to upload pre-recorded audio.
          {micState === 'denied' ? (
            <button type="button" className="rt-mic-enable" onClick={onEnable}>TRY AGAIN</button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="rt-mic-banner">
      <strong>RECORD FROM YOUR BROWSER.</strong> Grant microphone permission once and every slot below
      gets a RECORD button. You can still upload files from Voice Memos if you prefer.
      <button
        type="button"
        className="rt-mic-enable"
        onClick={onEnable}
        disabled={micState === 'requesting'}
      >
        {micState === 'requesting' ? 'WAITING FOR PERMISSION…' : '🎙  ENABLE MICROPHONE'}
      </button>
    </div>
  );
}

function SlotUploader({ slot, dirtyText, micState, micStreamRef, onEdit, onAfterMutate, onError }) {
  const text = dirtyText ?? slot.template ?? '';
  const isDirty = dirtyText !== undefined && dirtyText !== slot.template;
  const cacheBust = slot.mtime || 0;
  const fileRef = useRef(null);
  const [pending, setPending] = useState(null); // {file,url}|null — user selected/recorded, not uploaded
  const [busy, setBusy] = useState(null); // 'upload' | 'reprocess' | 'delete' | null
  const [progress, setProgress] = useState(0);

  // Recording state
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [recError, setRecError] = useState(null);

  useEffect(() => () => {
    // Clean up on unmount: stop any in-flight recording, revoke urls,
    // clear tick interval.
    try { recorderRef.current?.stop?.(); } catch {}
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    if (pending?.url) { try { URL.revokeObjectURL(pending.url); } catch {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose() { fileRef.current?.click(); }

  function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    replacePending({ file: f, url: URL.createObjectURL(f) });
  }

  function replacePending(next) {
    if (pending?.url) try { URL.revokeObjectURL(pending.url); } catch {}
    setPending(next);
  }

  function discardPending() {
    if (pending?.url) try { URL.revokeObjectURL(pending.url); } catch {}
    setPending(null);
  }

  // Pick a mime type the current browser actually supports. Safari only
  // supports mp4/aac; Chrome/Firefox prefer webm/opus. The pi ffmpeg
  // chain accepts all of these.
  function pickMime() {
    const MR = window.MediaRecorder;
    if (!MR || typeof MR.isTypeSupported !== 'function') return '';
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const m of candidates) if (MR.isTypeSupported(m)) return m;
    return '';
  }

  function extForMime(mime) {
    if (!mime) return 'webm';
    if (mime.startsWith('audio/webm')) return 'webm';
    if (mime.startsWith('audio/mp4'))  return 'm4a';
    if (mime.startsWith('audio/ogg'))  return 'ogg';
    if (mime.startsWith('audio/mpeg')) return 'mp3';
    return 'webm';
  }

  async function startRecording() {
    if (recording) return;
    setRecError(null);
    const stream = micStreamRef.current;
    if (!stream) {
      setRecError('Microphone not ready. Click ENABLE MICROPHONE at the top of the page.');
      return;
    }
    const mime = pickMime();
    let rec;
    try {
      rec = mime
        ? new window.MediaRecorder(stream, { mimeType: mime })
        : new window.MediaRecorder(stream);
    } catch (e) {
      setRecError(`recorder failed: ${e?.message || e}`);
      return;
    }
    chunksRef.current = [];
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    rec.onerror = (ev) => {
      setRecError(`recorder error: ${ev?.error?.message || ev?.error?.name || 'unknown'}`);
    };
    rec.onstop = () => {
      const type = rec.mimeType || mime || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      const ext = extForMime(type);
      const name = `${slot.slot}-take.${ext}`;
      const file = new File([blob], name, { type, lastModified: Date.now() });
      replacePending({ file, url: URL.createObjectURL(blob) });
      setRecording(false);
      setRecSeconds(0);
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
      recorderRef.current = null;
    };
    recorderRef.current = rec;
    try {
      rec.start();
    } catch (e) {
      setRecError(`could not start: ${e?.message || e}`);
      recorderRef.current = null;
      return;
    }
    setRecording(true);
    setRecSeconds(0);
    const t0 = Date.now();
    timerRef.current = window.setInterval(() => {
      setRecSeconds(Math.floor((Date.now() - t0) / 1000));
    }, 250);
    // Safety stop at 60s so a stuck recorder doesn't eat RAM forever.
    window.setTimeout(() => {
      if (recorderRef.current === rec && rec.state === 'recording') {
        try { rec.stop(); } catch {}
      }
    }, 60_000);
  }

  function stopRecording() {
    const rec = recorderRef.current;
    if (!rec) return;
    try { rec.stop(); } catch {}
  }

  async function upload() {
    if (!pending?.file) return;
    setBusy('upload');
    setProgress(0);
    try {
      await xhrUpload(`/voice-api/${slot.slot}`, pending.file, (p) => setProgress(p));
      discardPending();
      await onAfterMutate(`${slot.slot}: uploaded · filtered on pi`);
    } catch (e) {
      onError(`${slot.slot} upload failed: ${e.message}`);
    } finally {
      setBusy(null);
      setProgress(0);
    }
  }

  async function reprocess() {
    setBusy('reprocess');
    try {
      const r = await fetch(`/voice-api/${slot.slot}/reprocess`, { method: 'POST' });
      if (!r.ok) throw new Error(await r.text());
      await onAfterMutate(`${slot.slot}: re-filtered`);
    } catch (e) {
      onError(`${slot.slot} reprocess failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${slot.slot}" clip from the pi?`)) return;
    setBusy('delete');
    try {
      const r = await fetch(`/voice-api/${slot.slot}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      await onAfterMutate(`${slot.slot}: deleted`);
    } catch (e) {
      onError(`${slot.slot} delete failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    replacePending({ file: f, url: URL.createObjectURL(f) });
  }

  const micReady = micState === 'ready';

  return (
    <div className={`rt-uploader ${slot.processed ? 'rt-has' : ''} ${isDirty ? 'rt-dirty' : ''}`}>
      <div className="rt-up-head">
        <div>
          <div className="rt-up-title">{slot.takeLabel ? slot.takeLabel.toUpperCase() : slot.slot.toUpperCase()}</div>
          <code className="rt-up-id">{slot.slot}</code>
        </div>
        <div className="rt-up-status">
          {slot.processed
            ? <span className="rt-pill rt-pill-have">● LIVE · {(slot.bytes / 1024).toFixed(1)} KB</span>
            : <span className="rt-pill rt-pill-empty">○ EMPTY</span>}
          {slot.mtime
            ? <span className="rt-meta"> {new Date(slot.mtime).toLocaleString()}</span>
            : null}
        </div>
      </div>

      <div className="rt-up-body">
        <div className="rt-up-script">
          <label>SAY THIS:</label>
          <textarea
            value={text}
            placeholder="(no script — leave empty to skip this slot)"
            onChange={(e) => onEdit(e.target.value)}
            rows={3}
          />
          {isDirty ? <div className="rt-dirty-tag">UNSAVED SCRIPT</div> : null}
        </div>

        <div
          className={`rt-up-drop ${pending ? 'rt-up-drop-have' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          {pending ? (
            <>
              <div className="rt-up-filename">
                <strong>{pending.file.name}</strong>
                <span className="rt-meta">{(pending.file.size / 1024).toFixed(1)} KB</span>
              </div>
              <audio controls src={pending.url} preload="metadata" />
              <div className="rt-up-drop-actions">
                <button
                  type="button"
                  className="rt-up-btn-primary"
                  onClick={upload}
                  disabled={busy !== null}
                >
                  {busy === 'upload' ? `UPLOADING ${progress}%…` : 'UPLOAD + FILTER'}
                </button>
                <button type="button" onClick={discardPending} disabled={busy !== null}>DISCARD</button>
                {micReady && !recording ? (
                  <button type="button" onClick={startRecording} disabled={busy !== null}>
                    RE-RECORD
                  </button>
                ) : null}
              </div>
              {busy === 'upload'
                ? <div className="rt-up-progress"><div style={{ width: `${progress}%` }} /></div>
                : null}
            </>
          ) : recording ? (
            <>
              <div className="rt-rec-indicator">
                <span className="rt-rec-dot" /> RECORDING · {String(recSeconds).padStart(2, '0')}s
              </div>
              <button
                type="button"
                className="rt-up-btn-primary rt-rec-stop"
                onClick={stopRecording}
              >
                ■ STOP
              </button>
              <div className="rt-meta">Speak clearly. Max 60s. Auto-stops.</div>
            </>
          ) : (
            <>
              {micReady ? (
                <button
                  type="button"
                  className="rt-up-btn-rec"
                  onClick={startRecording}
                  disabled={busy !== null}
                >
                  ● RECORD TAKE
                </button>
              ) : (
                <div className="rt-meta" style={{ color: '#ffe47a' }}>
                  Enable the microphone above to record in-browser.
                </div>
              )}
              <div className="rt-up-drop-hint">or drop an audio file here</div>
              <button type="button" onClick={choose}>CHOOSE FILE</button>
              <div className="rt-meta">.m4a · .wav · .mp3 · .webm · ≤ 50 MB</div>
            </>
          )}
          {recError ? <div className="rt-rec-err">⚠ {recError}</div> : null}
          <input
            ref={fileRef}
            type="file"
            accept="audio/m4a,audio/mp4,audio/x-m4a,audio/mpeg,audio/wav,audio/x-wav,audio/aiff,audio/x-aiff,audio/webm,audio/ogg,.m4a,.mp4,.mp3,.wav,.aif,.aiff,.webm,.ogg"
            style={{ display: 'none' }}
            onChange={onFile}
          />
        </div>
      </div>

      <div className="rt-up-live">
        <label>ON-AIR CLIP:</label>
        {slot.processed ? (
          <>
            <audio controls preload="none" src={`/voice/${slot.slot}.mp3?t=${cacheBust}`} />
            <div className="rt-up-live-actions">
              <button type="button" onClick={reprocess} disabled={busy !== null} title="Re-run the retro filter on the stored raw take">
                {busy === 'reprocess' ? 'RE-FILTERING…' : 'RE-FILTER'}
              </button>
              <button type="button" className="ghost danger" onClick={remove} disabled={busy !== null}>
                {busy === 'delete' ? 'DELETING…' : 'DELETE'}
              </button>
            </div>
          </>
        ) : (
          <span className="rt-meta">nothing uploaded yet</span>
        )}
      </div>

      {/* v77 — per-take portrait-card picker. The image shown here is
          what will pop into the codec card overlay when this specific
          take plays (once the overlay is re-enabled). Independent of
          whether the audio clip exists — you can stage portraits ahead
          of the voice line or vice versa. */}
      <PortraitPicker slot={slot} onAfterMutate={onAfterMutate} onError={onError} />
    </div>
  );
}

/* v77 — portrait card picker. Sits inside each SlotUploader and lets
 * Josh upload / preview / delete a custom portrait image for the
 * (currently dormant) MGS codec overlay. Independent of the audio
 * upload flow — uses /voice-api/:slot/portrait endpoints.
 */
function PortraitPicker({ slot, onAfterMutate, onError }) {
  const [busy, setBusy] = useState(null); // 'upload' | 'delete' | null
  const [progress, setProgress] = useState(0);
  const [cacheBust, setCacheBust] = useState(() => Date.now());
  const fileRef = useRef(null);

  function choose() { fileRef.current?.click(); }

  async function upload(file) {
    if (!file) return;
    if (!/^image\//i.test(file.type) && !/\.(png|jpe?g|gif|webp)$/i.test(file.name)) {
      onError?.('Portrait must be an image (PNG, JPG, GIF, or WebP).');
      return;
    }
    setBusy('upload');
    setProgress(0);
    try {
      await xhrUpload(`/voice-api/${slot.slot}/portrait`, file, setProgress);
      setCacheBust(Date.now());
      await onAfterMutate?.(`portrait uploaded · ${slot.slot}`);
    } catch (e) {
      onError?.(`portrait upload failed: ${e.message}`);
    } finally {
      setBusy(null);
      setProgress(0);
    }
  }

  async function remove() {
    if (!slot.hasPortrait) return;
    if (!window.confirm(`Delete the portrait for ${slot.slot}?`)) return;
    setBusy('delete');
    try {
      const r = await fetch(`/voice-api/${slot.slot}/portrait`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      await onAfterMutate?.(`portrait removed · ${slot.slot}`);
    } catch (e) {
      onError?.(`portrait delete failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  function onFile(e) {
    const f = e.target.files?.[0];
    if (f) upload(f);
    e.target.value = '';
  }
  function onDrop(e) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) upload(f);
  }

  return (
    <div className="rt-up-portrait">
      <label>
        PORTRAIT CARD:
        <span className="rt-up-portrait-hint">
          (shown in the codec overlay when this take plays)
        </span>
      </label>
      <div
        className={`rt-up-portrait-drop ${slot.hasPortrait ? 'rt-up-portrait-have' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        {slot.hasPortrait ? (
          <img
            className="rt-up-portrait-img"
            alt={`Portrait for ${slot.slot}`}
            src={`/voice-portrait/${slot.slot}?t=${cacheBust}`}
          />
        ) : (
          <div className="rt-up-portrait-empty">NO PORTRAIT</div>
        )}
        <div className="rt-up-portrait-actions">
          <button type="button" onClick={choose} disabled={busy !== null}>
            {busy === 'upload' ? `UPLOADING ${progress}%…` : slot.hasPortrait ? 'REPLACE' : 'UPLOAD PORTRAIT'}
          </button>
          {slot.hasPortrait ? (
            <button type="button" className="ghost danger" onClick={remove} disabled={busy !== null}>
              {busy === 'delete' ? 'DELETING…' : 'DELETE'}
            </button>
          ) : null}
        </div>
        {busy === 'upload' ? (
          <div className="rt-up-progress"><div style={{ width: `${progress}%` }} /></div>
        ) : null}
        <div className="rt-meta">PNG · JPG · GIF · WebP · ≤ 10 MB</div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={onFile}
      />
    </div>
  );
}

// Wrapper around XHR to get upload progress events (fetch doesn't have
// them yet in Safari). Returns the parsed JSON response on success.
function xhrUpload(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error('network error'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { resolve({}); }
      } else {
        reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText?.slice(0, 200) || 'upload failed'}`));
      }
    };
    xhr.send(file);
  });
}

/* v71 SkitUploader — video counterpart of SlotUploader. Simpler: no
 * template editing, no record button, no preview player (videos are
 * previewed inline via <video controls>). File picker + drag/drop +
 * upload with progress. Delete removes from the pi. */
function SkitUploader({ row, onAfterMutate, onError }) {
  const [pending, setPending] = useState(null); // { file, url }
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Volume gain for this skit (0.0 .. 3.0). Local state so the slider
  // feels instant; persisted to the server when the user releases the
  // thumb. Live preview <video> also reflects the chosen gain.
  const [gain, setGain] = useState(Number.isFinite(row.gain) ? row.gain : 1);
  const [gainSaving, setGainSaving] = useState(false);
  const previewVideoRef = useRef(null);
  // Keep local gain in sync if the parent refetches and row.gain changes.
  useEffect(() => {
    if (Number.isFinite(row.gain)) setGain(row.gain);
  }, [row.gain]);
  // Apply gain to the preview <video> element whenever either changes.
  // Note: preview is capped at 1.0 because we can't easily build a
  // Web-Audio pipeline just for the preview. The kiosk uses GainNode.
  useEffect(() => {
    const v = previewVideoRef.current;
    if (v) { try { v.volume = Math.min(1, Math.max(0, gain)); } catch {} }
  }, [gain, pending, row.present]);

  async function saveGain(nextGain) {
    setGainSaving(true);
    try {
      const r = await fetch('/skit-api/meta', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [row.slot]: { gain: nextGain } }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      onError?.(`volume save failed: ${e.message}`);
    } finally {
      setGainSaving(false);
    }
  }

  // Human-friendly "size" string
  const bytesStr = (n) => {
    if (!n) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  function takeFile(f) {
    if (!f) return;
    if (pending?.url) { try { URL.revokeObjectURL(pending.url); } catch {} }
    setPending({ file: f, url: URL.createObjectURL(f) });
    setProgress(0);
  }

  function onPick(e) {
    const f = e.target.files && e.target.files[0];
    if (f) takeFile(f);
    // Reset so picking the same filename twice still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) takeFile(f);
  }

  async function doUpload() {
    if (!pending?.file) return;
    setUploading(true);
    try {
      await xhrUpload(`/skit-api/${row.slot}`, pending.file, setProgress);
      if (pending?.url) { try { URL.revokeObjectURL(pending.url); } catch {} }
      setPending(null);
      setProgress(0);
      await onAfterMutate(`${row.label} saved`);
    } catch (e) {
      onError?.(`upload failed: ${e.message}`);
    } finally {
      setUploading(false);
    }
  }

  async function doDelete() {
    if (!row.present) return;
    if (!confirm(`Delete skit for ${row.label}?`)) return;
    try {
      const r = await fetch(`/skit-api/${row.slot}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await onAfterMutate(`${row.label} deleted`);
    } catch (e) {
      onError?.(`delete failed: ${e.message}`);
    }
  }

  const liveUrl = row.present ? `${skitUrl(row.slot)}?t=${row.mtime ?? Date.now()}` : null;

  return (
    <div className={`rt-skit-slot ${dragOver ? 'rt-drag' : ''}`}
         onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
         onDragLeave={() => setDragOver(false)}
         onDrop={onDrop}>
      <div className="rt-skit-slot-hd">
        <div>
          <div className="rt-skit-slot-title">{row.label}</div>
          <div className="rt-skit-slot-ep">“{row.episodeTitle}”</div>
        </div>
        <div className={`rt-skit-pill ${row.present ? 'rt-skit-pill-ok' : 'rt-skit-pill-missing'}`}>
          {row.present ? `${row.ext?.toUpperCase() ?? 'FILE'} · ${bytesStr(row.bytes)}` : 'NO VIDEO'}
        </div>
      </div>

      <div className="rt-skit-preview">
        {pending?.url ? (
          <video ref={previewVideoRef} className="rt-skit-preview-video" src={pending.url} controls preload="metadata" />
        ) : liveUrl ? (
          <video ref={previewVideoRef} className="rt-skit-preview-video" src={liveUrl} controls preload="metadata" />
        ) : (
          <div className="rt-skit-preview-empty">Drop video here or choose a file.</div>
        )}
      </div>

      {/* Per-skit volume. 0-300%; broadcast uses Web Audio so values
          above 100% actually amplify. Preview <video> is capped at 100%
          by the browser — trust the number, not the browser's ears. */}
      <div className="rt-skit-volume">
        <div className="rt-skit-volume-hd">
          <span className="rt-skit-volume-label">BROADCAST VOLUME</span>
          <span className="rt-skit-volume-val">
            {Math.round(gain * 100)}%{gainSaving ? ' · saving…' : ''}
          </span>
        </div>
        <input
          type="range"
          min="0" max="3" step="0.05"
          value={gain}
          onChange={(e) => setGain(Number(e.target.value))}
          onMouseUp={() => saveGain(gain)}
          onTouchEnd={() => saveGain(gain)}
          onKeyUp={() => saveGain(gain)}
          className="rt-skit-volume-slider"
          aria-label={`${row.label} broadcast volume`}
        />
        <div className="rt-skit-volume-ticks">
          <span>0%</span><span>100%</span><span>200%</span><span>300%</span>
        </div>
        {gain !== 1 && (
          <button type="button" className="ghost rt-skit-volume-reset"
                  onClick={() => { setGain(1); saveGain(1); }}>
            RESET TO 100%
          </button>
        )}
      </div>

      <div className="rt-skit-slot-actions">
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/x-m4v,video/x-matroska,video/ogg,.mp4,.webm,.mov,.m4v,.mkv,.ogv"
          style={{ display: 'none' }}
          onChange={onPick}
        />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          CHOOSE FILE
        </button>
        <button type="button" className="primary"
                onClick={doUpload} disabled={!pending || uploading}>
          {uploading ? `UPLOADING ${progress}%` : pending ? 'UPLOAD' : 'NOTHING TO UPLOAD'}
        </button>
        {row.present && !pending && (
          <button type="button" className="ghost danger" onClick={doDelete} disabled={uploading}>
            DELETE
          </button>
        )}
      </div>
    </div>
  );
}

function HelpPanel() {
  return (
    <details className="rt-help">
      <summary>TIPS &amp; TEMPLATE VARIABLES</summary>
      <p><strong>Recording tips.</strong> Quiet room, laptop mic 6–8 inches from your mouth, speak
      at normal volume. The pi boosts levels via <code>loudnorm</code> so you don't need to record hot.
      Each slide has six takes — the kiosk rotates them, so vary the energy between takes instead
      of repeating the same line word-for-word.</p>

      <p><strong>What happens on upload.</strong> The file is stored raw under the slot, then an
      ffmpeg chain (telephone-bandpass + compressor + phaser + vibrato + short echo + loudnorm)
      renders the final mp3 the kiosk streams. Re-filter re-runs the chain on the stored raw take —
      handy if the filter config changes.</p>

      <p><strong>Template variables.</strong> Scripts support <code>{'{variableName}'}</code>{' '}
      interpolation, but with manual recordings they're only a reference — what you record is what
      the kiosk plays. The variables below are the ones the auto-TTS fallback supports.</p>

      <table className="rt-help-table">
        <thead><tr><th>Variable</th><th>Source</th><th>Example</th></tr></thead>
        <tbody>
          <tr><td><code>{'{rocketName}'}</code></td><td>LL2</td><td>Falcon 9 Block 5</td></tr>
          <tr><td><code>{'{missionName}'}</code></td><td>LL2</td><td>Starlink Group 11-4</td></tr>
          <tr><td><code>{'{pad}'}</code></td><td>LL2</td><td>4 East</td></tr>
          <tr><td><code>{'{whenHuman}'}</code></td><td>LL2 NET</td><td>tomorrow at 2:47 pm</td></tr>
          <tr><td><code>{'{tempF}'}</code></td><td>NWS KLPC</td><td>64</td></tr>
          <tr><td><code>{'{wxShort}'}</code></td><td>NWS KLPC</td><td>partly cloudy</td></tr>
          <tr><td><code>{'{forecastShort}'}</code></td><td>NWS forecast</td><td>partly cloudy</td></tr>
        </tbody>
      </table>
      <p>Missing variables render as <code>[varName?]</code> so you can spot them in playback.</p>
    </details>
  );
}
