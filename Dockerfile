# api-gateway — single public API entry (Express)
#   docker compose builds with context: . , dockerfile: api-gateway/Dockerfile
FROM node:20-alpine

# Build-only: ARGs are visible to RUN (so npm can reach the registry via the
# campus proxy, and authenticate to the private @iitd-tech-ambit GitHub
# Packages registry for @iitd-tech-ambit/protos) but are NOT baked into the
# image. Never ENV these — grpc-js would honour a proxy at runtime and route
# internal calls (envoy:10000) through it, which cannot reach Docker DNS names.
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NODE_AUTH_TOKEN

WORKDIR /app

COPY api-gateway/package*.json api-gateway/.npmrc ./
RUN npm install --omit=dev

COPY api-gateway/src ./src

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
