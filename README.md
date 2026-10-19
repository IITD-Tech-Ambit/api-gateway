# Research Ambit API gateway

The browser talks only to this process. It is the north-south edge for Research Ambit: it checks the session cookie with auth-service over gRPC, then either proxies the HTTP call or transcodes it to a unary gRPC call for a backend service. East-west calls go through Envoy. The public server listens on `PORT` (default `8080`) and `HOST` (default `0.0.0.0`).

## System design

```
browser
  |  HTTP :8080
  v
api-gateway
  |-- cookie ra_session -- gRPC auth.v1 VerifyToken --> Envoy --> auth-service
  |     (only /chat-api and the faculty self-edit paths below)
  |
  |-- HTTP proxy
  |     /api/auth/*                                      --> AUTH_SERVICE_URL
  |     /chat-api/*          (session, prefix stripped)  --> CHATBOT_URL
  |     faculty image / visibility / profile-extras      --> BACKEND_URL
  |     directory GETs that carry metric visibility      --> BACKEND_URL
  |
  |-- HTTP transcoded to unary gRPC --> ENVOY_GRPC_TARGET
        /api/directory (remaining)   directory.v1 DirectoryService
        /api/kg                      directory.v1 KnowledgeGraphService
        /api/content                 directory.v1 ContentService
        /api/user                    directory.v1 UserService
        /api/suggestions             directory.v1 SuggestionService
        /search/api/v1/*             search.v1 SearchService + TaxonomyService

metrics listener :9100  GET /metrics
```

Routers are mounted in this order: `/health*`, the HTTP proxies, then `/api/*` gRPC, then `/search/api/v1`. A proxy whose filter matches consumes the request, so the overlapping directory handlers in the gRPC router are not reached for those GETs.

`x-powered-by` is disabled. CORS is installed only when `CORS_ORIGIN` is non-empty (`credentials: true`, one origin). Routes that read a JSON body install `express.json()` on that route; multipart routes use the multer middleware below. The proxies stream the original body.

### Path matching

Express `case sensitive routing` and `strict routing` are left disabled, so the gRPC routers treat `/api/KG` and `/api/kg/` as the same route.

The HTTP proxy filters do not use those Express settings. Each `pathFilter` sees the pathname of `req.url` (query string removed) and applies its own rules, which is what keeps a differently cased or slash-terminated URL on the proxy instead of falling through to gRPC:

- Prefix filters (`/api/auth`, `/chat-api`) match when the lowercased pathname equals the prefix or starts with `prefix + '/'`. `/api/authentication` does not match `/api/auth`.
- Faculty self-edit and directory-read filters are case-insensitive regular expressions with an optional trailing slash (`/?`). The id or department segment is a single path segment (`[^/]+`).

The chat and faculty session gates call those same prefix and faculty predicates on `req.path`. `/chat-api` is rewritten before it is forwarded: the gateway slices off the nine-character prefix and ensures the remainder starts with `/`, so `/chat-api` becomes `/` and `/chat-api/v1/stream` becomes `/v1/stream`. Other proxies forward the path unchanged. `changeOrigin` is set on every proxy.

### HTTP proxy

| Path | Methods | Upstream | Session |
| --- | --- | --- | --- |
| `/api/auth`, `/api/auth/...` | any | `AUTH_SERVICE_URL` (default `http://auth-service:4000`) | no |
| `/chat-api`, `/chat-api/...` | any | `CHATBOT_URL` (default `http://chatbot:3003`) | yes |
| `/api/directory/faculty/:id/image` | POST | `BACKEND_URL` (default `http://backend:3002`) | yes |
| `/api/directory/faculty/:id/visibility` | PATCH | `BACKEND_URL` | yes |
| `/api/directory/faculty/:id/profile-extras` | GET, PATCH | `BACKEND_URL` | yes |
| `/api/directory` | GET | `BACKEND_URL` | no |
| `/api/directory/search` | GET | `BACKEND_URL` | no |
| `/api/directory/grouped` | GET | `BACKEND_URL` | no |
| `/api/directory/grouped/:departmentId/faculties` | GET | `BACKEND_URL` | no |
| `/api/directory/faculty/:id/profile` | GET | `BACKEND_URL` | no |
| `/api/directory/faculty/:id/research-summary` | GET | `BACKEND_URL` | no |

`/api/auth` stays HTTP because the IITD OAuth exchange is owned by auth-service. `/chat-api` stays HTTP because the chatbot response is a browser-facing stream; that proxy sets `proxyTimeout` to 130000 ms. The other proxies do not set a proxy timeout. The public Node server sets `requestTimeout` to `0`.

The directory GETs in the last six rows stay HTTP so metric visibility survives the hop. `directory.v1` has no `metricVisibility` field, and a redacted null metric would transcode as `0`. The backend's HTTP handlers return the same `{ success, message, data, timestamp }` envelope, including the visibility flags. Those calls are public: no identity is attached.

`SEARCH_API_URL` (default `http://search-api:3001`) is not a business proxy. It is used only by the `/health` aggregate probe.

### gRPC transcode

All stubs dial `ENVOY_GRPC_TARGET` (default `envoy:10000`) with insecure credentials and lazy connect, so process startup does not require Envoy to be up. Clients share channel options (256 MiB max receive, 64 MiB max send, keepalive 60 s / 20 s). `src/grpc/clients.js` records the Envoy split: `directory.v1` to `backend:50055`, `search.v1` to `search-api:50053`.

Per-call deadlines come from the gateway, not from the HTTP client: directory `GRPC_DIRECTORY_DEADLINE_MS` (30000), search `GRPC_SEARCH_DEADLINE_MS` (30000), atlas `GRPC_ATLAS_DEADLINE_MS` (120000). A deadline fires as `DEADLINE_EXCEEDED`.

Directory, knowledge-graph, content, user, and suggestion successes are wrapped as `{ success, message, data, timestamp }`. Search and taxonomy responses are the mapped JSON body with no envelope. Two knowledge-graph responses are also raw: `GET /api/kg/atlas` (JSON body, `ETag`, `Cache-Control: no-cache, must-revalidate`, `304` when the backend reports not-modified) and `GET /api/kg/atlas/tile/:nodeKey` (`application/octet-stream`, one-year immutable cache, `304` when the request `If-None-Match` equals the response etag).

`/api/directory` over gRPC (the HTTP GETs above never reach these):

| Path | RPC |
| --- | --- |
| `GET /by-scopus/:scopusId` | `GetFacultyByScopus` |
| `POST /by-scopus/batch` | `BatchFacultyByScopus` |
| `POST /by-kerberos/batch` | `BatchFacultyByKerberos` |
| `GET /faculty/:kerberos/publications` | `GetFacultyPublications` |
| `GET /:id` | `GetFacultyById` |

`GET /:id` is registered last so it does not shadow the more specific directory routes.

`/api/kg` uses `KnowledgeGraphService` and the directory deadline, except the six atlas calls marked below, which use the atlas deadline:

| Path | RPC | Deadline |
| --- | --- | --- |
| `GET /health` | `GetHealth` | directory |
| `GET /faculty` | `GetFacultyIndex` | directory |
| `GET /faculty/:id/knowledge-graph` | `GetFacultyKnowledgeGraph` | directory |
| `GET /explore/terms` | `ExploreTerms` | directory |
| `GET /explore/detail` | `ExploreDetail` | directory |
| `GET /paper/:id/meta` | `GetPaperMeta` | directory |
| `GET /atlas` | `GetAtlas` | atlas |
| `GET /atlas/search` | `SearchAtlas` | directory |
| `GET /atlas/refine` | `SearchAtlasRefine` | atlas |
| `GET /atlas/suggest` | `SearchAtlasSuggest` | directory |
| `GET /atlas/faculty-indices` | `GetAtlasFacultyIndices` | directory |
| `GET /atlas/faculty-search` | `SearchAtlasFaculty` | directory |
| `GET /atlas/department-indices` | `GetAtlasDepartmentIndices` | directory |
| `GET /atlas/year-indices` | `GetAtlasYearIndices` | directory |
| `GET /atlas/department-search` | `SearchAtlasDepartment` | directory |
| `GET /atlas/cluster-breakdown` | `GetAtlasClusterBreakdown` | atlas |
| `GET /atlas/tree` | `GetAtlasTree` | atlas |
| `GET /atlas/dict` | `GetAtlasDict` | atlas |
| `GET /atlas/points` | `GetAtlasPoints` | directory |
| `GET /atlas/tile/:nodeKey` | `GetAtlasTile` | atlas |

`/api/content` (`ContentService`, directory deadline): `GET /`, `GET /paginated`, `POST /` (`hero_img`), `PUT /` (`hero_img`), `DELETE /`, `POST /like`, `POST /dislike`, `POST /comment`, `POST /uncomment`, `POST /status`.

`/api/user` (`UserService`, directory deadline): `POST /register` (`profile_img`), `POST /login`, `PUT /edit` (`profile_img`), `DELETE /delete`. These are the CMS user RPCs. They are separate from `/api/auth`.

`/api/suggestions` (`SuggestionService`, directory deadline): `POST /` (`screenshot`).

`/search/api/v1` (`SearchService` unless noted, search deadline):

| Path | RPC |
| --- | --- |
| `POST /search` | `Search` |
| `POST /search/author-scope` | `SearchAuthorScope` |
| `GET /suggest` | `Suggest` |
| `GET /search/faculty-for-query` | `FacultyForQuery` |
| `GET /document/:id` | `GetDocument` |
| `GET /document/:id/similar` | `GetSimilarDocuments` |
| `GET /documents/by-author/:authorId` | `GetDocumentsByAuthor` |
| `GET /author/:id/collaborators` | `GetAuthorCollaborators` |
| `GET /ip/suggest` | `IpSuggest` |
| `POST /ip/search` | `IpSearch` |
| `GET /ip/document/:id` | `GetIpDocument` |
| `GET /taxonomy/departments` | `TaxonomyService.GetDepartments` |
| `GET /taxonomy/themes` | `GetThemes` |
| `GET /taxonomy/domains` | `GetDomains` |
| `GET /taxonomy/domains/:domainSlug/subdomains` | `GetSubdomains` |
| `GET /taxonomy/counts` | `GetCounts` |
| `GET /taxonomy/faculty` | `GetFaculty` |
| `GET /taxonomy/faculty/:kerberos/papers` | `GetFacultyPapers` |

`GetDocument`, `GetSimilarDocuments`, and `GetIpDocument` return 404 when the response has `found: false`. `ExploreDetail` and `GetPaperMeta` do the same on the directory error envelope. `GetPaperMeta` strips non-hex characters from the id before the RPC.

### Session and identity

Session enforcement runs only for `/chat-api` and the three faculty self-edit paths. `/api/auth`, the directory metric GETs, and every gRPC route are not session-gated.

The cookie name is `SESSION_COOKIE_NAME` (default `ra_session`). When `ENABLE_AUTH` is anything other than the exact string `false` (the default), a missing cookie or a failed verify returns 401:

- no cookie: `Login with your IITD account to use the chat assistant.`
- `VerifyToken` RPC error, including timeout: `Authentication service is temporarily unavailable. Please try again.` (`auth_unavailable`; fail closed)
- any other invalid result: `Your session has expired. Please log in again.`

The same three bodies are used for faculty self-edit. `VerifyToken` is `auth.v1.AuthService` through Envoy, with deadline `AUTH_VERIFY_TIMEOUT_MS` (default 3000). A valid user supplies `user_id`, `email`, `name`, `kerberos`, `department`, `category`, and `role`.

`ENABLE_AUTH=false` skips the RPC and sets a fixed dev identity (`userId` `devuser`, `category` `student`, no role). That setting is refused in production; see below.

On every HTTP proxy the gateway removes inbound `x-user-id`, `x-user-email`, `x-user-kerberos`, `x-user-category`, `x-user-role`, and `x-gateway-secret`. When the request has a verified identity (chat and faculty self-edit only), it writes those `x-user-*` values back. `x-user-role` is set only when `role` is non-empty. `x-gateway-secret` is set only when `GATEWAY_SHARED_SECRET` is non-empty. Auth and directory-read proxies strip the headers and attach no identity.

gRPC metadata starts empty, so client `x-user-*` headers are not forwarded. If `req.identity` were set, the metadata would carry `x-user-id`, `x-user-email`, and `x-user-kerberos` only. No current gRPC route runs the session middleware, so those keys are unset. Metadata does forward `authorization` (the CMS bearer token, which the backend checks itself) and `x-request-id` (the access-log id, or the inbound header). It does not send `x-user-category`, `x-user-role`, or `x-gateway-secret`.

### Upload policy

`imageUpload` in `src/middleware/upload.js` is in-memory multer:

- `fileSize`: `MAX_IMAGE_BYTES` = `5 * 1024 * 1024` (5242880 bytes)
- `files`: 1
- the part is accepted when its MIME type matches `^image/`

It is applied as a single file on:

| Route | Field |
| --- | --- |
| `POST /api/content`, `PUT /api/content` | `hero_img` |
| `POST /api/user/register`, `PUT /api/user/edit` | `profile_img` |
| `POST /api/suggestions` | `screenshot` |

The accepted file is sent on the gRPC request as `filename`, `content_type`, and `data`. A `MulterError` is handled in the process error middleware: `LIMIT_FILE_SIZE` returns 413 with `Image must be under 5 MB.`; any other `MulterError` returns 400 with `Invalid file upload.`

`POST /api/directory/faculty/:id/image` does not use this multer. It is proxied as the original HTTP body. Any size limit on that upload is enforced by the backend.

### Metrics

`startMetricsServer` listens on `METRICS_PORT` (default `9100`) and the same `HOST` as the public server. The only successful path is `GET /metrics` (Prometheus text). Every other URL on that port returns 404. The scrape surface is a separate server because an edge proxy in front of port 8080 forwards every path.

The public server records `http_request_duration_seconds{method,route,status_code}` with default label `service=api-gateway`, plus the client default process metrics. `route` is `baseUrl + req.route.path` when Express set `req.route`, and `unmatched` otherwise. The proxy middleware is mounted with `router.use` and does not set `req.route`, so proxied calls are labeled `unmatched`. The access logger ignores requests whose URL is exactly `/health/live`.

### Production guard

If `NODE_ENV` is `production` and `ENABLE_AUTH=false`, the process logs a fatal error and exits 1 before it binds a port. An empty `GATEWAY_SHARED_SECRET` in production logs a warning and the process still starts. Downstream services then cannot check that `x-user-*` came from the gateway.

### Health and failure behavior

| Path | Behavior |
| --- | --- |
| `GET /health/live` | `{ status: "ok" }`. Docker healthcheck calls this. |
| `GET /health/ready` | `{ status: "ready" }` as soon as the process is listening. Readiness does not dial Envoy. |
| `GET /health` | Parallel `GET {upstream}/health` for auth-service, backend, search-api, and chatbot. Each probe aborts after `HEALTH_PROBE_TIMEOUT_MS` (default 2500). The gateway still returns 200. `status` is `ok` only when every probe succeeded, otherwise `degraded`. |

HTTP proxy errors return 502 `{ error, message: "Upstream request failed", statusCode: 502 }` when the response has not started. If headers were already sent, the socket is destroyed and no JSON body is written.

gRPC errors use this map (any other code becomes 502):

| gRPC | HTTP |
| --- | --- |
| OK | 200 |
| CANCELLED | 499 |
| INVALID_ARGUMENT, FAILED_PRECONDITION, OUT_OF_RANGE | 400 |
| DEADLINE_EXCEEDED | 504 |
| NOT_FOUND | 404 |
| ALREADY_EXISTS, ABORTED | 409 |
| PERMISSION_DENIED | 403 |
| RESOURCE_EXHAUSTED | 429 |
| UNIMPLEMENTED | 501 |
| UNAVAILABLE | 503 |
| UNAUTHENTICATED | 401 |
| UNKNOWN, INTERNAL, DATA_LOSS | 500 |

Directory-family errors (`sendDirectoryError`, also used for knowledge-graph, content, user, and suggestions) return `{ success: false, message, errors, timestamp }`. `errors` is parsed from trailing metadata key `errors-json` when that value is JSON. Search errors return `{ error, message, statusCode }` with the labels the search UI already handles. An unhandled non-multer exception uses `error.statusCode` or 502 and the proxy-style Bad Gateway body.

`SIGINT` and `SIGTERM` close the token-verifier channel, the Envoy clients, the metrics server, and the public server.

## Setup

Node.js 20 or newer (`package.json` `engines`). From this directory:

```bash
npm install
cp .env.example .env
```

Set `GATEWAY_SHARED_SECRET` to the same value as backend and chatbot when those services check the header. `openssl rand -hex 32` is a suitable generator. Leave `ENABLE_AUTH` unset or `true` except for local calls that must run without IITD OAuth.

An empty `GATEWAY_SHARED_SECRET` makes the backend and the chatbot trust whatever `x-user-*` headers the caller sends. Use that only when every upstream is local. Do not aim this process at the production backend: a profile save there is a live edit, and when the faculty member saves their own profile the production worker emails them. A superadmin edit does not. `ENABLE_AUTH=false` is refused when `NODE_ENV` is `production`.

Protos are the committed `protos/` tree (`auth/v1`, `directory/v1`, `search/v1`). `PROTO_DIR` defaults to that directory (resolved from `src/grpc`). The image sets `PROTO_DIR=/app/protos`.

The image is `node:20-alpine`, installs production dependencies, runs as uid 1001, and sets `NODE_ENV=production` and `LOG_LEVEL=info`. It exposes 8080. The metrics port is not in the `EXPOSE` list; publish `9100` separately if a scraper must reach it. Build context is this directory:

```bash
docker build -t api-gateway .
```

## Environment

`src/server.js` loads `.env` via `dotenv`. Existing process environment variables win. `npm run dev` sets `NODE_ENV=development` before the process starts.

| Variable | Default | Role |
| --- | --- | --- |
| `PORT` | `8080` | Public HTTP listen port |
| `HOST` | `0.0.0.0` | Bind address for the public and metrics servers |
| `METRICS_PORT` | `9100` | Prometheus listen port |
| `LOG_LEVEL` | `info` | Pino level. Production logs newline JSON; otherwise pino-pretty |
| `NODE_ENV` | unset | `production` enables the auth guard and the missing-secret warning |
| `ENABLE_AUTH` | on, unless the value is `false` | Session gate for chat and faculty self-edit |
| `GATEWAY_SHARED_SECRET` | empty | Sent as `x-gateway-secret` on identity-bearing HTTP proxies |
| `SESSION_COOKIE_NAME` | `ra_session` | Cookie passed to `VerifyToken` |
| `CORS_ORIGIN` | empty | One allowed browser origin; empty leaves CORS off |
| `AUTH_SERVICE_URL` | `http://auth-service:4000` | HTTP proxy for `/api/auth` and a `/health` probe |
| `BACKEND_URL` | `http://backend:3002` | HTTP proxy for faculty self-edit and directory metric GETs |
| `CHATBOT_URL` | `http://chatbot:3003` | HTTP proxy for `/chat-api` |
| `SEARCH_API_URL` | `http://search-api:3001` | `/health` probe only |
| `ENVOY_GRPC_TARGET` | `envoy:10000` | VerifyToken and every transcoded RPC |
| `AUTH_VERIFY_TIMEOUT_MS` | `3000` | `VerifyToken` deadline |
| `GRPC_DIRECTORY_DEADLINE_MS` | `30000` | directory, content, user, suggestion, and most KG calls |
| `GRPC_SEARCH_DEADLINE_MS` | `30000` | `/search/api/v1` |
| `GRPC_ATLAS_DEADLINE_MS` | `120000` | Atlas, refine, cluster breakdown, tree, dict, tile |
| `HEALTH_PROBE_TIMEOUT_MS` | `2500` | Per-upstream `/health` probe |
| `PROTO_DIR` | repo `protos/` | Proto root; `/app/protos` in the image |

## Run

```bash
npm run dev    # NODE_ENV=development, node --watch src/server.js
npm start      # node src/server.js
npm test       # node --test
```

The Docker image command is `node src/server.js`. Its healthcheck is `GET http://localhost:8080/health/live` every 30 seconds.

Local browser calls from another origin need `CORS_ORIGIN` (for Vite, `http://localhost:5173`). The dev auth bypass is `ENABLE_AUTH=false`, and it will not boot when `NODE_ENV=production`.
