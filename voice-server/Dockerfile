# syntax=docker/dockerfile:1.6
FROM node:20-alpine

# ffmpeg for the retro-filter chain; wget for the healthcheck.
RUN apk add --no-cache ffmpeg wget

WORKDIR /app
COPY package.json ./
COPY server.js    ./
EXPOSE 8090

# The healthcheck hits a fake slot's /exists endpoint; it always returns
# 200 with {exists:false}, which is what we want — the endpoint being
# reachable at all means the process is alive.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8090/voice-api/healthcheck/exists > /dev/null || exit 1

CMD ["node", "server.js"]
