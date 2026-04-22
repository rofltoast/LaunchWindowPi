#!/usr/bin/env bash
# vsfb-stream — 720p 24/7 YouTube Live of /retro kiosk
#
# Approach: dedicated Xvfb display runs headless Chromium against the
# local kiosk URL. A private PulseAudio instance lives in this service's
# runtime dir with a null sink; Chromium's audio is routed into it and
# ffmpeg grabs the .monitor source. Video comes from x11grab.
# h264_v4l2m2m uses the Pi 4 hardware encoder so the CPU stays cool.
#
# Env:
#   YOUTUBE_STREAM_KEY   (required) — the YouTube Live stream key
#   KIOSK_URL            (default http://localhost:8080/retro)
#   DISPLAY_NUM          (default 99)
#   VBITRATE             (default 3500k)  — YouTube-recommended 720p30
#   ABITRATE             (default 128k)

set -euo pipefail

KIOSK_URL="${KIOSK_URL:-http://localhost:8080/retro?autostart=1}"
DISPLAY_NUM="${DISPLAY_NUM:-99}"
W=960
H=540
FPS=20
VBITRATE="${VBITRATE:-2500k}"
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
  # tear down our private pulse daemon (by runtime path)
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
# wait for socket
for i in $(seq 1 40); do
  pactl info >/dev/null 2>&1 && break
  sleep 0.25
done
pactl set-default-sink vsfb_out || true
export PULSE_SINK=vsfb_out

# --- 3. headless chromium ----------------------------------------
CHROME_PROFILE="${XDG_RUNTIME_DIR}/chrome-profile"
rm -rf "$CHROME_PROFILE"
mkdir -p "$CHROME_PROFILE"
/usr/bin/chromium \
  --user-data-dir="$CHROME_PROFILE" \
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

# Give the React app a beat to actually render first frame
sleep 8

# --- 4. ffmpeg: x11grab + pulse monitor -> rtmp ------------------
# h264_v4l2m2m = Pi 4 hardware encoder. keyint 60 = 2s GOP (YouTube
# wants <=4s). -g matches fps*2. -thread_queue_size keeps the two
# async input threads from under-running on slow frames.
exec ffmpeg -hide_banner -loglevel warning -nostats \
  -thread_queue_size 512 \
  -f x11grab -framerate "$FPS" -video_size "${W}x${H}" -i ":${DISPLAY_NUM}.0+0,0" \
  -thread_queue_size 512 \
  -f pulse -i vsfb_out.monitor \
  -c:v libx264 -preset ultrafast -tune zerolatency -b:v "$VBITRATE" -maxrate "$VBITRATE" -bufsize 7000k \
  -pix_fmt yuv420p -g $((FPS*2)) -r "$FPS" \
  -c:a aac -b:a "$ABITRATE" -ar 44100 -ac 2 \
  -f flv "${YT_URL}/${STREAM_KEY}"
