export default {
    port: parseInt(process.env.PORT || '8080', 10),
    host: process.env.HOST || '0.0.0.0',
    logLevel: process.env.LOG_LEVEL || 'info',

    // Secure-by-default auth toggle. MUST stay true (or unset) in production.
    // Only an explicit ENABLE_AUTH=false bypasses session enforcement, injecting
    // a mock dev identity so protected routes are testable without IITD OAuth.
    enableAuth: (process.env.ENABLE_AUTH || 'true') !== 'false',

    // Upstream HTTP services (north-south edge hops; east-west stays gRPC).
    upstreams: {
        authService: process.env.AUTH_SERVICE_URL || 'http://auth-service:4000',
        backend: process.env.BACKEND_URL || 'http://backend:3002',
        searchApi: process.env.SEARCH_API_URL || 'http://search-api:3001',
        chatbot: process.env.CHATBOT_URL || 'http://chatbot:3003'
    },

    // Envoy is the only east-west gRPC front door. Per-call deadlines sit just
    // above Envoy's route timeouts (envoy.yaml: 30s for directory/search) so the
    // client surfaces DEADLINE_EXCEEDED rather than hanging; atlas is larger.
    grpc: {
        envoyTarget: process.env.ENVOY_GRPC_TARGET || 'envoy:10000',
        verifyTimeoutMs: parseInt(process.env.AUTH_VERIFY_TIMEOUT_MS || '3000', 10),
        directoryDeadlineMs: parseInt(process.env.GRPC_DIRECTORY_DEADLINE_MS || '30000', 10),
        searchDeadlineMs: parseInt(process.env.GRPC_SEARCH_DEADLINE_MS || '30000', 10),
        atlasDeadlineMs: parseInt(process.env.GRPC_ATLAS_DEADLINE_MS || '120000', 10)
    },

    session: {
        cookieName: process.env.SESSION_COOKIE_NAME || 'ra_session'
    },

    // Empty = CORS off (production default). Set e.g. http://localhost:5173 for local Vite.
    corsOrigin: process.env.CORS_ORIGIN || '',

    health: {
        probeTimeoutMs: parseInt(process.env.HEALTH_PROBE_TIMEOUT_MS || '2500', 10)
    }
};
