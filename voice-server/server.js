#!/usr/bin/env node
/**
 * VSFB retro narrator-clip storage server (v0.3.0)
 *
 * In v54 the mic recorder is gone. Clips are now generated on Josh's Mac
 * by the `vsfb-narrator` CLI (XTTS voice-clone + retro ffmpeg chain) and
 * POST'd here as finished mp3s. The pi's only jobs are:
 *
 *   - Store + serve the mp3 files the retro page plays.
 *   - Store + serve the template JSON (so edits in /admin/retro sync to
 *     the Mac generator without redeploying).
 *   - Store + serve the reference voice sample (so a new Mac can pick up
 *     where the old one left off).
 *
 * Endpoints:
 *   GET    /voice-api/list              -> { clips: [{slot, bytes, mtime, processed}] }
 *   POST   /voice-api/:slot[?raw=1]     -> upload audio (raw body or multipart)
 *   DELETE /voice-api/:slot             -> remove clip
 *   POST   /voice-api/:slot/reprocess[?raw=1]  -> re-run ffmpeg on the stored raw
 *   GET    /voice/:slot[.mp3]           -> serve processed clip
 *
 *   GET    /voice-api/templates         -> templates.json (404 if absent)
 *   PUT    /voice-api/templates         -> write templates.json
 *
 *   GET    /voice-api/voice-sample      -> serve the reference .wav (404 if absent)
 *   POST   /voice-api/voice-sample      -> store the reference .wav
 *
 *   GET    /voice-api/status            -> per-slot { slot, bytes, mtime, templateText }
 *   GET    /voice-api/healthcheck/exists -> {exists:false} (container healthcheck ping)
 *
 * Storage layout ($DATA_DIR, default /data/voice):
 *   <slot>.mp3                processed clip the kiosk plays
 *   <slot>.raw.<ext>          original upload (for /reprocess)
 *   templates.json            slot-id -> template-string map
 *   voice-sample.wav          reference voice for XTTS on the Mac
 *   .staging/                 same-FS scratch for uploads (avoids EXDEV)
 *
 * Slots are constrained to [a-z0-9][a-z0-9-]{0,48}$ to keep paths safe.
 *
 * Zero npm deps — Node 20+ stdlib only.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.PORT || 8090);
const DATA_DIR = process.env.DATA_DIR || '/data/voice';
// v71: skits are videos stored on the same volume as voice clips but
// under a subdirectory so listSlots() never picks them up. Using a
// subdir also means no compose / volume changes are needed to enable
// skits on an existing deploy.
const SKIT_DIR = process.env.SKIT_DIR || path.join(DATA_DIR, 'skits');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SKIT_DIR, { recursive: true });

// Video formats we accept for skits. The browser picks its own codec
// based on the stored extension, so we just keep the original file.
const SKIT_EXT_RE = /^(mp4|webm|mov|m4v|mkv|ogv)$/i;
const SKIT_CONTENT_TYPES = {
  mp4: 'video/mp4', m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm', mkv: 'video/x-matroska',
  ogv: 'video/ogg',
};
const MAX_SKIT_BYTES = 200 * 1024 * 1024; // 200MB cap per skit video

// Stage uploads INSIDE DATA_DIR so the final rename stays on the same
// filesystem. The container's /tmp is overlayfs while /data/voice is a
// bind mount; rename() across those fails with EXDEV.
const STAGE_DIR = path.join(DATA_DIR, '.staging');
fs.mkdirSync(STAGE_DIR, { recursive: true });

const TEMPLATES_PATH = path.join(DATA_DIR, 'templates.json');
const VOICE_SAMPLE_PATH = path.join(DATA_DIR, 'voice-sample.wav');

// v74b: per-skit metadata (volume gain today; space for cue/notes later).
// Lives alongside the raw video files so wiping the skits dir via
// `rm -rf /data/voice/skits/*` takes the metadata with it.
const SKITS_META_PATH = path.join(SKIT_DIR, '_meta.json');
const MAX_SKITS_META_BYTES = 64 * 1024;
const SKIT_GAIN_MIN = 0;
const SKIT_GAIN_MAX = 3;   // 300%. The kiosk uses Web Audio so >1 truly amplifies.

const SLOT_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;      // 50MB hard cap per clip
const MAX_SAMPLE_BYTES = 200 * 1024 * 1024;     // 200MB cap for voice sample
const MAX_TEMPLATE_BYTES = 512 * 1024;          // 512KB cap for template JSON

// v77 — per-take custom portrait cards for the (currently dormant)
// codec overlay. Each narration slot (forecast-intro-1 etc) can have
// its own portrait image uploaded from /admin/retro. Stored next to
// the mp3 as <slot>.portrait.<ext>. We serve it at /voice-portrait/<slot>.
const PORTRAIT_EXT_RE = /^(png|jpg|jpeg|gif|webp)$/i;
const PORTRAIT_CONTENT_TYPES = {
  png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
};
const MAX_PORTRAIT_BYTES = 10 * 1024 * 1024;    // 10MB cap per portrait image

// Retro chain — same as the Mac-side `vsfb-narrator` so pi-fallback
// matches the Mac-generated output.
const RETRO_FILTER = [
  'aresample=22050',
  'highpass=f=300',
  'lowpass=f=3400',
  'acompressor=threshold=-18dB:ratio=2.5:attack=10:release=150',
  'aphaser=in_gain=0.4:out_gain=0.7:delay=2:decay=0.4:speed=0.5',
  'vibrato=f=4:d=0.0025',
  'aecho=0.6:0.3:40:0.2',
  'loudnorm=I=-20:LRA=7:TP=-2',
].join(',');

const RAW_FILTER = 'aresample=22050,loudnorm=I=-20:LRA=7:TP=-2';

// --------------------------------------------------------- helpers

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json' : 'text/plain',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function processedPath(slot) { return path.join(DATA_DIR, `${slot}.mp3`); }
function findRawPath(slot) {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith(`${slot}.raw.`));
  return files.length ? path.join(DATA_DIR, files[0]) : null;
}
function findPortraitPath(slot) {
  const prefix = `${slot}.portrait.`;
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith(prefix));
  for (const f of files) {
    const ext = f.slice(prefix.length).toLowerCase();
    if (PORTRAIT_EXT_RE.test(ext)) return path.join(DATA_DIR, f);
  }
  return null;
}
function statSafe(p) { try { return fs.statSync(p); } catch { return null; } }

function moveInto(src, dst) {
  try {
    fs.renameSync(src, dst);
  } catch (e) {
    if (e?.code === 'EXDEV') {
      fs.copyFileSync(src, dst);
      try { fs.unlinkSync(src); } catch {}
    } else {
      throw e;
    }
  }
}

function listSlots() {
  const entries = {};
  for (const f of fs.readdirSync(DATA_DIR)) {
    const mp3 = f.match(/^([a-z0-9][a-z0-9-]{0,48})\.mp3$/);
    if (mp3) {
      const st = statSafe(path.join(DATA_DIR, f));
      entries[mp3[1]] = { ...(entries[mp3[1]] || {}),
        processed: true,
        bytes: st?.size ?? 0,
        mtime: st?.mtimeMs ?? null,
      };
      continue;
    }
    const raw = f.match(/^([a-z0-9][a-z0-9-]{0,48})\.raw\./);
    if (raw) {
      entries[raw[1]] = { ...(entries[raw[1]] || {}), hasRaw: true };
      continue;
    }
    // v77 — per-take portrait card. <slot>.portrait.<ext>
    const portrait = f.match(/^([a-z0-9][a-z0-9-]{0,48})\.portrait\.([a-z0-9]{2,5})$/i);
    if (portrait && PORTRAIT_EXT_RE.test(portrait[2])) {
      const st = statSafe(path.join(DATA_DIR, f));
      entries[portrait[1]] = { ...(entries[portrait[1]] || {}),
        hasPortrait: true,
        portraitExt: portrait[2].toLowerCase(),
        portraitMtime: st?.mtimeMs ?? null,
      };
    }
  }
  return Object.entries(entries).map(([slot, v]) => ({ slot, ...v }));
}

function readTemplates() {
  try {
    return JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// Skit metadata — { [slot]: { gain: number (0..SKIT_GAIN_MAX) } }
function readSkitsMeta() {
  try {
    const j = JSON.parse(fs.readFileSync(SKITS_META_PATH, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    console.warn('[voice-server] skit meta read failed:', e.message);
    return {};
  }
}
function writeSkitsMeta(obj) {
  const tmp = `${SKITS_META_PATH}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, SKITS_META_PATH);
}
function clampGain(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(SKIT_GAIN_MIN, Math.min(SKIT_GAIN_MAX, n));
}

/**
 * Read a bounded request body. For multipart, extract the first file
 * part as-is. Returns {tmpPath, extHint, bytes}.
 */
function receiveUpload(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const ctype = (req.headers['content-type'] || '').toLowerCase();
    const tmpPath = path.join(STAGE_DIR, `up-${randomBytes(6).toString('hex')}.bin`);
    const out = fs.createWriteStream(tmpPath);
    let total = 0;
    const abort = (err) => {
      try { out.destroy(); } catch {}
      try { fs.unlinkSync(tmpPath); } catch {}
      reject(err);
    };

    if (ctype.startsWith('multipart/form-data')) {
      const m = ctype.match(/boundary=([^;]+)/i);
      if (!m) return reject(new Error('missing multipart boundary'));
      const boundary = Buffer.from('--' + m[1]);
      let buf = Buffer.alloc(0);
      let state = 'preamble';
      let extHint = null;

      req.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) return abort(new Error(`body > ${maxBytes} bytes`));
        buf = Buffer.concat([buf, chunk]);
        while (true) {
          if (state === 'preamble') {
            const bi = buf.indexOf(boundary);
            if (bi < 0) return;
            buf = buf.slice(bi + boundary.length);
            if (buf.length >= 2 && buf[0] === 0x2d && buf[1] === 0x2d) { state = 'done'; return; }
            if (buf.length >= 2 && buf[0] === 0x0d && buf[1] === 0x0a) buf = buf.slice(2);
            state = 'headers'; continue;
          }
          if (state === 'headers') {
            const hend = buf.indexOf('\r\n\r\n');
            if (hend < 0) return;
            const headers = buf.slice(0, hend).toString('utf8');
            const dispo = headers.match(/filename="([^"]+)"/i);
            if (dispo) {
              const ex = dispo[1].split('.').pop();
              if (ex && /^[a-z0-9]{2,5}$/i.test(ex)) extHint = ex.toLowerCase();
            }
            buf = buf.slice(hend + 4);
            state = 'data'; continue;
          }
          if (state === 'data') {
            const bi = buf.indexOf(boundary);
            if (bi < 0) {
              const safeLen = Math.max(0, buf.length - (boundary.length - 1));
              if (safeLen > 0) { out.write(buf.slice(0, safeLen)); buf = buf.slice(safeLen); }
              return;
            }
            let end = bi;
            if (end >= 2 && buf[end - 2] === 0x0d && buf[end - 1] === 0x0a) end -= 2;
            out.write(buf.slice(0, end));
            buf = buf.slice(bi + boundary.length);
            if (buf.length >= 2 && buf[0] === 0x2d && buf[1] === 0x2d) { state = 'done'; return; }
            if (buf.length >= 2 && buf[0] === 0x0d && buf[1] === 0x0a) buf = buf.slice(2);
            state = 'headers'; continue;
          }
          return;
        }
      });
      req.on('end', () => {
        out.end(() => resolve({ tmpPath, extHint, bytes: total }));
      });
      req.on('error', abort);
    } else {
      // Raw body — mime -> ext hint.
      const mime = ctype.split(';')[0];
      const extHint = ({
        'audio/webm': 'webm',
        'audio/ogg':  'ogg',
        'audio/mp4':  'mp4',
        'audio/x-m4a':'m4a',
        'audio/mpeg': 'mp3',
        'audio/wav':  'wav',
        'audio/wave': 'wav',
        // v77 — portrait images come through this code path too, so
        // map the common MIME types straight to file extensions.
        'image/png':  'png',
        'image/jpeg': 'jpg',
        'image/jpg':  'jpg',
        'image/gif':  'gif',
        'image/webp': 'webp',
      })[mime] || 'mp3';
      req.on('data', (c) => {
        total += c.length;
        if (total > maxBytes) return abort(new Error(`body > ${maxBytes} bytes`));
        out.write(c);
      });
      req.on('end', () => out.end(() => resolve({ tmpPath, extHint, bytes: total })));
      req.on('error', abort);
    }
  });
}

function runFfmpeg(input, output, filter) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-vn', '-ac', '1',
      '-af', filter,
      '-c:a', 'libmp3lame', '-b:a', '64k',
      output,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => { err += d.toString(); });
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${err.trim()}`));
    });
  });
}

// ------------------------------------------------------- JSON body reader

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) return reject(new Error(`body > ${maxBytes} bytes`));
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error(`bad json: ${e.message}`)); }
    });
    req.on('error', reject);
  });
}

// ------------------------------------------------------- request router

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // ---- GET /voice-api/list ----
    if (pathname === '/voice-api/list' && req.method === 'GET') {
      return send(res, 200, { clips: listSlots() });
    }

    // ---- GET /voice-api/status ----
    if (pathname === '/voice-api/status' && req.method === 'GET') {
      const tpls = readTemplates() || {};
      const clips = listSlots();
      const byId = {};
      for (const c of clips) byId[c.slot] = c;
      const combined = Object.keys({ ...tpls, ...byId }).sort().map((slot) => ({
        slot,
        bytes: byId[slot]?.bytes ?? 0,
        mtime: byId[slot]?.mtime ?? null,
        processed: Boolean(byId[slot]?.processed),
        hasPortrait: Boolean(byId[slot]?.hasPortrait),
        portraitExt: byId[slot]?.portraitExt ?? null,
        portraitMtime: byId[slot]?.portraitMtime ?? null,
        templateText: tpls[slot] ?? null,
      }));
      return send(res, 200, {
        slots: combined,
        voiceSample: Boolean(statSafe(VOICE_SAMPLE_PATH)),
        voiceSampleBytes: statSafe(VOICE_SAMPLE_PATH)?.size ?? 0,
      });
    }

    // ---- Templates ----
    if (pathname === '/voice-api/templates' && req.method === 'GET') {
      const tpls = readTemplates();
      if (!tpls) return send(res, 404, { error: 'no templates yet' });
      return send(res, 200, tpls);
    }
    if (pathname === '/voice-api/templates' && (req.method === 'PUT' || req.method === 'POST')) {
      const obj = await readJsonBody(req, MAX_TEMPLATE_BYTES);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return send(res, 400, { error: 'expected {slot: template, ...}' });
      }
      // Validate: slot keys safe, values strings, length caps.
      for (const [k, v] of Object.entries(obj)) {
        if (!SLOT_RE.test(k)) return send(res, 400, { error: `bad slot: ${k}` });
        if (typeof v !== 'string') return send(res, 400, { error: `template for ${k} not a string` });
        if (v.length > 4000) return send(res, 400, { error: `template for ${k} > 4000 chars` });
      }
      const tmp = path.join(STAGE_DIR, `tpl-${randomBytes(4).toString('hex')}.json`);
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
      moveInto(tmp, TEMPLATES_PATH);
      return send(res, 200, { ok: true, slots: Object.keys(obj).length });
    }

    // ---- Voice sample ----
    if (pathname === '/voice-api/voice-sample' && req.method === 'GET') {
      const st = statSafe(VOICE_SAMPLE_PATH);
      if (!st) return send(res, 404, { error: 'no voice sample yet' });
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': st.size,
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(VOICE_SAMPLE_PATH).pipe(res);
      return;
    }
    if (pathname === '/voice-api/voice-sample' && req.method === 'POST') {
      const { tmpPath, bytes } = await receiveUpload(req, MAX_SAMPLE_BYTES);
      moveInto(tmpPath, VOICE_SAMPLE_PATH);
      return send(res, 200, { ok: true, bytes });
    }

    // ---- GET /voice-api/:slot/exists ----
    let m = pathname.match(/^\/voice-api\/([a-z0-9][a-z0-9-]{0,48})\/exists$/);
    if (m && req.method === 'GET') {
      const st = statSafe(processedPath(m[1]));
      return send(res, 200, {
        exists: Boolean(st),
        bytes: st?.size ?? 0,
        mtime: st?.mtimeMs ?? null,
        processed: Boolean(st),
      });
    }

    // ---- POST /voice-api/:slot[?raw=1] ----
    m = pathname.match(/^\/voice-api\/([a-z0-9][a-z0-9-]{0,48})$/);
    if (m && req.method === 'POST') {
      const slot = m[1];
      if (!SLOT_RE.test(slot)) return send(res, 400, { error: 'bad slot' });

      const { tmpPath, extHint, bytes } = await receiveUpload(req, MAX_UPLOAD_BYTES);
      const rawTarget = path.join(DATA_DIR, `${slot}.raw.${extHint}`);
      const mp3Target = processedPath(slot);

      for (const f of fs.readdirSync(DATA_DIR)) {
        if (f.startsWith(`${slot}.raw.`)) {
          try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch {}
        }
      }
      moveInto(tmpPath, rawTarget);

      const wantRaw = url.searchParams.get('raw') === '1';
      if (wantRaw && extHint === 'mp3') {
        // Fast path: the Mac generator already ran our retro chain,
        // uploaded as audio/mpeg -> extHint=mp3. Just copy to the
        // served path, no ffmpeg needed.
        fs.copyFileSync(rawTarget, mp3Target);
      } else {
        try {
          await runFfmpeg(rawTarget, mp3Target, wantRaw ? RAW_FILTER : RETRO_FILTER);
        } catch (e) {
          return send(res, 500, { error: 'ffmpeg failed', detail: e.message });
        }
      }
      const st = fs.statSync(mp3Target);
      return send(res, 200, { ok: true, slot, bytes: st.size, uploaded: bytes, rawExt: extHint });
    }

    // ---- DELETE /voice-api/:slot ----
    if (m && req.method === 'DELETE') {
      const slot = m[1];
      try { fs.unlinkSync(processedPath(slot)); } catch {}
      // Clean up both raw and portrait siblings so the slot is fully empty.
      for (const f of fs.readdirSync(DATA_DIR)) {
        if (f.startsWith(`${slot}.raw.`) || f.startsWith(`${slot}.portrait.`)) {
          try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch {}
        }
      }
      return send(res, 200, { ok: true });
    }

    // ---- POST /voice-api/:slot/reprocess ----
    m = pathname.match(/^\/voice-api\/([a-z0-9][a-z0-9-]{0,48})\/reprocess$/);
    if (m && req.method === 'POST') {
      const slot = m[1];
      const raw = findRawPath(slot);
      if (!raw) return send(res, 404, { error: 'no raw source to reprocess' });
      const wantRaw = url.searchParams.get('raw') === '1';
      try {
        await runFfmpeg(raw, processedPath(slot), wantRaw ? RAW_FILTER : RETRO_FILTER);
      } catch (e) {
        return send(res, 500, { error: 'ffmpeg failed', detail: e.message });
      }
      return send(res, 200, { ok: true, processed: !wantRaw });
    }

    // ---- GET /voice/:slot[.mp3] ----
    m = pathname.match(/^\/voice\/([a-z0-9][a-z0-9-]{0,48})(?:\.mp3)?$/);
    if (m && req.method === 'GET') {
      const p = processedPath(m[1]);
      const st = statSafe(p);
      if (!st) return send(res, 404, { error: 'not found' });
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'Content-Length': st.size,
      });
      fs.createReadStream(p).pipe(res);
      return;
    }

    // =============================================================
    // v77 — Per-take portrait-card endpoints. Each narration slot can
    // have a custom portrait that overrides the default MGS-codec
    // portrait grid. Stored at /data/voice/<slot>.portrait.<ext>.
    //   POST   /voice-api/:slot/portrait       multipart/raw image upload
    //   GET    /voice-api/:slot/portrait/exists
    //   DELETE /voice-api/:slot/portrait
    //   GET    /voice-portrait/:slot           serve the image
    // =============================================================

    m = pathname.match(/^\/voice-api\/([a-z0-9][a-z0-9-]{0,48})\/portrait\/exists$/);
    if (m && req.method === 'GET') {
      const p = findPortraitPath(m[1]);
      if (!p) return send(res, 200, { exists: false });
      const st = statSafe(p);
      const ext = p.split('.').pop().toLowerCase();
      return send(res, 200, {
        exists: true, ext,
        bytes: st?.size ?? 0, mtime: st?.mtimeMs ?? null,
      });
    }

    m = pathname.match(/^\/voice-api\/([a-z0-9][a-z0-9-]{0,48})\/portrait$/);
    if (m && req.method === 'POST') {
      const slot = m[1];
      if (!SLOT_RE.test(slot)) return send(res, 400, { error: 'bad slot' });
      let upload;
      try {
        upload = await receiveUpload(req, MAX_PORTRAIT_BYTES);
      } catch (e) {
        return send(res, 413, { error: 'upload failed', detail: e.message });
      }
      const ext = PORTRAIT_EXT_RE.test(upload.extHint || '')
        ? upload.extHint.toLowerCase()
        : 'png';
      // Drop any previous portrait for this slot (ext may differ).
      const prefix = `${slot}.portrait.`;
      for (const f of fs.readdirSync(DATA_DIR)) {
        if (f.startsWith(prefix)) {
          try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch {}
        }
      }
      const target = path.join(DATA_DIR, `${slot}.portrait.${ext}`);
      try { moveInto(upload.tmpPath, target); }
      catch (e) { return send(res, 500, { error: 'store failed', detail: e.message }); }
      const st = fs.statSync(target);
      return send(res, 200, { ok: true, slot, ext, bytes: st.size });
    }

    if (m && req.method === 'DELETE') {
      const slot = m[1];
      const prefix = `${slot}.portrait.`;
      let removed = 0;
      for (const f of fs.readdirSync(DATA_DIR)) {
        if (f.startsWith(prefix)) {
          try { fs.unlinkSync(path.join(DATA_DIR, f)); removed += 1; } catch {}
        }
      }
      return send(res, 200, { ok: true, removed });
    }

    m = pathname.match(/^\/voice-portrait\/([a-z0-9][a-z0-9-]{0,48})$/);
    if (m && req.method === 'GET') {
      const p = findPortraitPath(m[1]);
      if (!p) return send(res, 404, { error: 'not found' });
      const st = statSafe(p);
      if (!st) return send(res, 404, { error: 'not found' });
      const ext = p.split('.').pop().toLowerCase();
      const ctype = PORTRAIT_CONTENT_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': ctype,
        'Content-Length': st.size,
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(p).pipe(res);
      return;
    }

    // =============================================================
    // Skit video endpoints (v71)
    //   POST   /skit-api/:slot            multipart/raw upload
    //   GET    /skit-api/:slot/exists
    //   GET    /skit-api/list
    //   DELETE /skit-api/:slot
    //   GET    /skit/:slot                serve video (Range-aware)
    // Videos are stored unmodified; extension determines Content-Type.
    // =============================================================

    if (pathname === '/skit-api/list' && req.method === 'GET') {
      const meta = readSkitsMeta();
      const entries = [];
      for (const f of fs.readdirSync(SKIT_DIR)) {
        const mm = f.match(/^([a-z0-9][a-z0-9-]{0,48})\.([a-z0-9]{2,5})$/i);
        if (!mm || !SKIT_EXT_RE.test(mm[2])) continue;
        const st = statSafe(path.join(SKIT_DIR, f));
        const slot = mm[1];
        entries.push({
          slot, ext: mm[2].toLowerCase(),
          bytes: st?.size ?? 0, mtime: st?.mtimeMs ?? null,
          gain: clampGain(meta[slot]?.gain ?? 1),
        });
      }
      return send(res, 200, { skits: entries });
    }

    // Meta bulk: GET returns {[slot]: {gain}}; PUT merges a partial.
    if (pathname === '/skit-api/meta' && req.method === 'GET') {
      return send(res, 200, readSkitsMeta());
    }
    if (pathname === '/skit-api/meta' && (req.method === 'PUT' || req.method === 'POST')) {
      let body;
      try { body = await readJsonBody(req, MAX_SKITS_META_BYTES); }
      catch (e) { return send(res, 400, { error: 'bad body', detail: e.message }); }
      if (!body || typeof body !== 'object') {
        return send(res, 400, { error: 'expected object' });
      }
      const merged = readSkitsMeta();
      for (const [slot, v] of Object.entries(body)) {
        if (!SLOT_RE.test(slot)) continue;
        if (!v || typeof v !== 'object') continue;
        const prev = merged[slot] || {};
        const next = { ...prev };
        if (v.gain !== undefined) next.gain = clampGain(v.gain);
        merged[slot] = next;
      }
      try { writeSkitsMeta(merged); }
      catch (e) { return send(res, 500, { error: 'write failed', detail: e.message }); }
      return send(res, 200, merged);
    }

    m = pathname.match(/^\/skit-api\/([a-z0-9][a-z0-9-]{0,48})\/exists$/);
    if (m && req.method === 'GET') {
      const slot = m[1];
      const found = fs.readdirSync(SKIT_DIR)
        .find((f) => f.startsWith(`${slot}.`) && SKIT_EXT_RE.test(f.split('.').pop() || ''));
      if (!found) return send(res, 200, { exists: false });
      const st = statSafe(path.join(SKIT_DIR, found));
      return send(res, 200, {
        exists: true,
        ext: found.split('.').pop().toLowerCase(),
        bytes: st?.size ?? 0, mtime: st?.mtimeMs ?? null,
      });
    }

    m = pathname.match(/^\/skit-api\/([a-z0-9][a-z0-9-]{0,48})$/);
    if (m && req.method === 'POST') {
      const slot = m[1];
      if (!SLOT_RE.test(slot)) return send(res, 400, { error: 'bad slot' });
      let upload;
      try {
        upload = await receiveUpload(req, MAX_SKIT_BYTES);
      } catch (e) {
        return send(res, 413, { error: 'upload failed', detail: e.message });
      }
      const ext = SKIT_EXT_RE.test(upload.extHint || '') ? upload.extHint.toLowerCase() : 'mp4';
      // Remove any previous version of this slot (could be a different ext).
      for (const f of fs.readdirSync(SKIT_DIR)) {
        if (f.startsWith(`${slot}.`)) {
          try { fs.unlinkSync(path.join(SKIT_DIR, f)); } catch {}
        }
      }
      const target = path.join(SKIT_DIR, `${slot}.${ext}`);
      try { moveInto(upload.tmpPath, target); }
      catch (e) { return send(res, 500, { error: 'store failed', detail: e.message }); }
      const st = fs.statSync(target);
      return send(res, 200, { ok: true, slot, ext, bytes: st.size });
    }

    if (m && req.method === 'DELETE') {
      const slot = m[1];
      for (const f of fs.readdirSync(SKIT_DIR)) {
        if (f.startsWith(`${slot}.`) && f !== '_meta.json') {
          try { fs.unlinkSync(path.join(SKIT_DIR, f)); } catch {}
        }
      }
      // Drop any meta for this slot so stale gain doesn't stick around.
      try {
        const meta = readSkitsMeta();
        if (slot in meta) { delete meta[slot]; writeSkitsMeta(meta); }
      } catch {}
      return send(res, 200, { ok: true });
    }

    m = pathname.match(/^\/skit\/([a-z0-9][a-z0-9-]{0,48})$/);
    if (m && req.method === 'GET') {
      const slot = m[1];
      const found = fs.readdirSync(SKIT_DIR)
        .find((f) => f.startsWith(`${slot}.`) && SKIT_EXT_RE.test(f.split('.').pop() || ''));
      if (!found) return send(res, 404, { error: 'not found' });
      const filePath = path.join(SKIT_DIR, found);
      const st = statSafe(filePath);
      if (!st) return send(res, 404, { error: 'not found' });
      const ext = found.split('.').pop().toLowerCase();
      const ctype = SKIT_CONTENT_TYPES[ext] || 'application/octet-stream';
      const range = req.headers.range;
      if (range) {
        const rm = range.match(/bytes=(\d*)-(\d*)/);
        if (rm) {
          const start = rm[1] ? Number(rm[1]) : 0;
          const end = rm[2] ? Math.min(Number(rm[2]), st.size - 1) : st.size - 1;
          if (start <= end && start < st.size) {
            res.writeHead(206, {
              'Content-Type': ctype,
              'Content-Length': end - start + 1,
              'Content-Range': `bytes ${start}-${end}/${st.size}`,
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'no-store',
            });
            fs.createReadStream(filePath, { start, end }).pipe(res);
            return;
          }
        }
      }
      res.writeHead(200, {
        'Content-Type': ctype,
        'Content-Length': st.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // ---- container healthcheck ping ----
    if (pathname === '/voice-api/healthcheck/exists' && req.method === 'GET') {
      return send(res, 200, { exists: false });
    }

    send(res, 404, { error: 'not found', path: pathname });
  } catch (e) {
    console.error('[voice-server] error:', e);
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`[voice-server v0.3.0] listening on ${PORT}, DATA_DIR=${DATA_DIR}`);
});
