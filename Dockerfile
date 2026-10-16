# syntax=docker/dockerfile:1
# PocKeep: one lean image with the built web app and the Node API.

# ---- 1. build the React frontend ----
FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json ./
COPY shared ./shared
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --no-audit --no-fund
COPY web ./web
RUN cd web && npm run build

# ---- 2. install production server dependencies (better-sqlite3 is native) ----
FROM node:22-bookworm-slim AS server-deps
WORKDIR /app/server
# build tools are only used if no prebuilt better-sqlite3 binary matches the platform
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- 3. runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app
COPY package.json ./
COPY shared ./shared
COPY server/package.json ./server/
COPY server/src ./server/src
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY --from=web /app/web/dist ./web/dist
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.js"]
