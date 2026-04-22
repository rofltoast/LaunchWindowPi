# LaunchWindowPi (VSFB-TV Retro)

Raspberry Pi kiosk showing an 80s-TV-style broadcast for Vandenberg
Space Force Base. Live launches, Central Coast weather, rotating
trivia, and periodic skits.

- `/` — main kiosk view
- `/retro` — retro broadcast slideshow
- `/admin/retro` — narrator + skit admin

## Layout

- `src/` — React + Vite SPA
- `voice-server/` — zero-dep Node HTTP server (clips, portraits, skits)
- `public/` — static assets (portraits, audio loop)
- `deploy/docker/nginx.conf` — nginx (NWS + LL2 proxies, SPA fallback)

## Local dev

    npm install
    npm run dev

## Build

    npm run build
