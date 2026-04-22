# VSFB-TV YouTube Live Streamer — Hetzner edition

This is the **production** streamer. It runs on a Hetzner CX22
(x86_64, 2 vCPU, 2 GiB RAM). The pi4 variant under `../stream/` was
the first attempt — it worked but couldn't sustain 720p alongside the
kiosk render on the same box.

## How it works

The pi keeps hosting the kiosk and exposes it publicly over the
existing cloudflared quick-tunnel. The Hetzner box runs a headless
Xvfb + Google Chrome + PulseAudio + ffmpeg stack that points at that
tunnel URL, grabs the rendered frames and routed audio, encodes with
libx264, and pushes RTMP to YouTube Live.

## Why move off the pi

Pi 4 was encoding AND rendering the browser AND serving nginx on 4
cores. Even at 540p20 with libx264 ultrafast the stream was visibly
laggy. Hetzner CX22 dedicates 2 full vCPUs to just the encode path,
steady-state load ~1.4 at 720p30 3500 kbps.

## Files

- `run.sh` — launcher. Differences from the pi version:
  - `google-chrome-stable` instead of `chromium` (snap chromium
    misbehaves in headless Xvfb+pulse on Ubuntu 24.04).
  - `--no-sandbox` (running as root on a cloud VM; acceptable given
    the unit only loads one URL we control).
  - Kiosk URL defaults to the public cloudflared tunnel.
  - 720p30 3500k instead of 540p20 2500k.
  - `-preset veryfast` (we have CPU headroom).
- `vsfb-stream.service` — systemd unit. Runs as root,
  MemoryMax=1500M, CPUQuota=190%.

## Secrets

`YOUTUBE_STREAM_KEY` is in `/etc/vsfb-stream.env` on Hetzner
(mode 600, root:root). Not in this repo.

## Operation

```bash
# From the pi:
ssh -i ~/.ssh/id_ed25519_hetzner root@5.78.206.147

# On Hetzner:
systemctl {start,stop,restart} vsfb-stream
journalctl -u vsfb-stream -f
```
