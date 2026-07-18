# api-gateway — single public API entry (Express)
# Self-contained build: context is this repo's own root, so it can be built
# standalone (e.g. by Coolify, which only clones this repo) as well as from
# the vm-infra workspace root via docker-compose (context: ./api-gateway,
# dockerfile: Dockerfile).
FROM node:20-alpine

# Build-only: ARG is visible to RUN (so npm can reach the registry via the
# campus proxy) but is NOT baked into the image. Never ENV these — grpc-js
# would honour them at runtime and route internal calls (envoy:10000) through
# the proxy, which cannot reach Docker DNS names.
ARG HTTP_PROXY
ARG HTTPS_PROXY

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
# protos/ is this repo's own committed copy of the proto files it needs
# (auth/v1, directory/v1, search/v1), synced from proto-registry — not a
# submodule and not a sibling workspace directory, so it exists in a
# standalone clone of this repo alone. Matches the pattern used by
# auth-service, research-ambit-main, SEO-Backend-iitd.
COPY protos /app/protos

ENV PROTO_DIR=/app/protos
ENV NODE_ENV=production
ENV LOG_LEVEL=info

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1

CMD ["node", "src/server.js"]
