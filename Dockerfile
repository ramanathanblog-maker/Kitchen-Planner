FROM node:20-slim

# Deploy/build stamp for GET /health (Audit 2026-07-18, threat: stale-process
# masking — a JS-only deploy with no new migration/reseed was previously
# indistinguishable from the old process at /health). Computed on the HOST at
# build time (git rev-parse / date, see OPERATIONS.md) and passed in via
# --build-arg / compose's build.args — deliberately not `git rev-parse` run
# inside this Dockerfile, since the container has no git installed and the
# build context may not even include .git. Both default to "unknown" so a
# plain `docker build .` with no args still succeeds.
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown
ENV GIT_COMMIT=${GIT_COMMIT}
ENV BUILD_TIME=${BUILD_TIME}

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

RUN groupadd -r kitchen && useradd -r -g kitchen kitchen \
    && mkdir -p /app/data \
    && chown -R kitchen:kitchen /app

USER kitchen

EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3010/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
