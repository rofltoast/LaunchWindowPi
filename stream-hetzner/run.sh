#!/usr/bin/env bash
# vsfb-stream — 720p 24/7 YouTube Live of /retro kiosk
#
# Runs on the Hetzner CX22 (x86_64, 2 vCPU, 2 GiB RAM). The pi4 was not
# powerful enough to run kiosk+chromium+encoder; this box just runs the
# encoder half. Kiosk still lives on pi-worker-200 and is reached via
# the cloudflared quick-tunnel (KIOSK_URL below).
#
# Approach: dedicated Xvfb display runs headless Chrome pointed at the
# public kiosk URL. A private PulseAudio instance lives in this
# service's runtime dir with a null sink; Chrome's audio is routed into
# it and ffmpeg grabs the .monitor source. Video comes from x11grab.
# libx264 (software, ultrafast) handles H.264 — CX22 vCPUs are plenty.
#
# Env:
#   YOUTUBE_STREAM_KEY   (required) — the YouTube Live stream key
#   KIOSK_URL            (default https://den-platinum-colleague-glory.trycloudflare.com/retro?autostart=1)
#   DISPLAY_NUM          (default 99)
#   VBITRATE             (default 3500k)  — YouTube-recommended 720p30
#   ABITRATE             (default 128k)

set -euo pipefail

KIOSK_URL="${KIOSK_URL:-https://den-platinum-colleague-glory.trycloudflare.com/retro?autostart=1}"
DISPLAY_NUM="${DISPLAY_NUM:-99}"
W=1280
H=720
FPS=30
VBITRATE="${VBITRATE:-3500k}"
ABITRATE="${ABITRATE:-128k}"
YT_URL="rtmp://a.rtmp.youtube.com/live2"
STREAM_KEY="${YOUTUBE_STREAM_KEY:?YOUTUBE_STREAM_KEY env not set}"

export DISPLAY=":${DISPLAY_NUM}"
export XDG_RUNTIME_DIR="/run/vsfb-stream"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

PIDS=()
cleanup() {
  echo "[vsfb-stream] shutting down..."
  for p in "${PIDS[@]:-}"; do kill -TERM "$p" 2>/dev/null || true; done
  sleep 1
  for p in "${PIDS[@]:-}"; do kill -KILL "$p" 2>/dev/null || true; done
  pulseaudio -k 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- 1. Xvfb virtual framebuffer ---------------------------------
Xvfb ":${DISPLAY_NUM}" -screen 0 "${W}x${H}x24" -nolisten tcp -ac &
PIDS+=($!)
for i in $(seq 1 40); do
  xdpyinfo -display ":${DISPLAY_NUM}" >/dev/null 2>&1 && break
  sleep 0.25
done

# --- 2. private PulseAudio + null sink ---------------------------
PULSE_RUNTIME_PATH="${XDG_RUNTIME_DIR}/pulse"
export PULSE_RUNTIME_PATH
mkdir -p "$PULSE_RUNTIME_PATH"
pulseaudio \
  --start \
  --exit-idle-time=-1 \
  --log-target=stderr \
  -n \
  --load="module-native-protocol-unix" \
  --load="module-null-sink sink_name=vsfb_out sink_properties=device.description=VSFB_Out"
for i in $(seq 1 40); do
  pactl info >/dev/null 2>&1 && break
  sleep 0.25
done
pactl set-default-sink vsfb_out || true
# Must be set BEFORE chrome starts — chrome picks its sink at connection
# time and ignores later default-sink changes.
export PULSE_SINK=vsfb_out

# --- 3. headless google chrome -----------------------------------
# Google Chrome stable deb (not snap chromium — snap confinement
# misbehaves in xvfb+pulseaudio headless setups).
# --no-sandbox: required when running as root on a cloud VM. This is a
#  locked-down unit that only loads one URL we control; sandbox off is
#  acceptable here.
CHROME_PROFILE="${XDG_RUNTIME_DIR}/chrome-profile"
rm -rf "$CHROME_PROFILE"
mkdir -p "$CHROME_PROFILE"
/usr/bin/google-chrome-stable \
  --user-data-dir="$CHROME_PROFILE" \
  --no-sandbox \
  --no-first-run \
  --no-default-browser-check \
  --disable-sync \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=Translate \
  --autoplay-policy=no-user-gesture-required \
  --kiosk \
  --window-size="${W},${H}" \
  --window-position=0,0 \
  --start-fullscreen \
  --force-device-scale-factor=1 \
  --disable-dev-shm-usage \
  --app="$KIOSK_URL" \
  >/dev/null 2>&1 &
PIDS+=($!)

# Give the React app a beat to actually render first frame. The
# cloudflared tunnel + initial JS/audio fetch needs a moment longer
# than localhost did.
sleep 12

# --- 4. ffmpeg: x11grab + pulse monitor -> rtmp ------------------
# Strict 2s GOP for YouTube Live. keyint_min==keyint + scenecut=0 +
# nal-hrd=cbr keep ingest happy — without these YouTube Studio gets
# stuck on "Preparing stream" indefinitely.
exec ffmpeg -hide_banner -loglevel warning -nostats \
  -thread_queue_size 512 \
  -f x11grab -framerate "$FPS" -video_size "${W}x${H}" -i ":${DISPLAY_NUM}.0+0,0" \
  -thread_queue_size 512 \
  -f pulse -i vsfb_out.monitor \
  -c:v libx264 -preset veryfast -profile:v main -b:v "$VBITRATE" -maxrate "$VBITRATE" -bufsize 7000k \
  -pix_fmt yuv420p -r "$FPS" -g $((FPS*2)) -keyint_min $((FPS*2)) -sc_threshold 0 \
  -x264-params "keyint=$((FPS*2)):min-keyint=$((FPS*2)):scenecut=0:nal-hrd=cbr" \
  -c:a aac -b:a "$ABITRATE" -ar 44100 -ac 2 \
  -f flv "${YT_URL}/${STREAM_KEY}"
