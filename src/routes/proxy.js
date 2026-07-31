import { Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { makeRequireSession, applyIdentityHeaders } from '../auth/sessionAuth.js';

/**
 * HTTP proxy routes that intentionally stay HTTP (NOT gRPC-ified):
 *   /api/auth/*  -> auth-service (IITD OAuth protocol is HTTP; owned by auth-service)
 *   /chat-api/*  -> chatbot      (browser-facing SSE token stream; session-gated)
 * All other /api/* and /search/* traffic is served over gRPC (see api.js / searchApi.js).
 *
 * @param {{ config: object, tokenVerifier: import('../ports/tokenVerifier.js').TokenVerifier, logger: import('pino').Logger }} deps
 */
export default function proxyRoutes({ config, tokenVerifier, logger }) {
    const router = Router();
    const requireSession = makeRequireSession(
        tokenVerifier,
        { ...config.session, enableAuth: config.enableAuth },
        logger
    );

    function onError(err, req, res) {
        req.log?.error({
            err: err.message,
            upstream: req._upstream,
            method: req.method,
            path: req.originalUrl
        }, 'upstream failed');
        if (res.headersSent || res.writableEnded) {
            res.destroy?.();
            return;
        }
        res.status(502).json({
            error: 'Bad Gateway',
            message: 'Upstream request failed',
            statusCode: 502
        });
    }

    function proxyHooks(upstream, getIdentity = () => null) {
        return {
            proxyReq(proxyReq, req) {
                req._upstream = upstream;
                applyIdentityHeaders(proxyReq, getIdentity(req));
            },
            proxyRes(proxyRes, req) {
                req.log?.info({
                    upstream,
                    method: req.method,
                    path: req.originalUrl,
                    status: proxyRes.statusCode,
                    userId: req.identity?.userId
                }, 'proxied');
            },
            error: onError
        };
    }

    const prefix = (p) => (pathname) => pathname === p || pathname.startsWith(`${p}/`);
    const strip = (p) => (pathname) => {
        const rewritten = pathname.slice(p.length);
        return rewritten.startsWith('/') ? rewritten : `/${rewritten}`;
    };

    router.use(createProxyMiddleware({
        pathFilter: prefix('/api/auth'),
        target: config.upstreams.authService,
        changeOrigin: true,
        on: proxyHooks('auth-service')
    }));

    router.use((req, res, next) =>
        prefix('/chat-api')(req.path) ? requireSession(req, res, next) : next());

    router.use(createProxyMiddleware({
        pathFilter: prefix('/chat-api'),
        target: config.upstreams.chatbot,
        changeOrigin: true,
        pathRewrite: strip('/chat-api'),
        proxyTimeout: 130_000,
        on: proxyHooks('chatbot', (req) => req.identity ?? null)
    }));

    // Faculty self-edit of their OWN profile — an image upload (multipart) or a
    // metric-visibility toggle (JSON). Kept as HTTP proxies (not gRPC); scoped to
    // exactly these two paths so the rest of /api/directory still flows over gRPC.
    // Session-gated — the backend enforces owner-only from the injected
    // x-user-kerberos.
    const isFacultySelfEdit = (pathname, req) =>
        (req?.method === 'POST' && /^\/api\/directory\/faculty\/[^/]+\/image$/.test(pathname)) ||
        (req?.method === 'PATCH' && /^\/api\/directory\/faculty\/[^/]+\/visibility$/.test(pathname)) ||
        // Background / Qualifications: owner-only GET (full content incl. hidden,
        // for the edit view) + PATCH (save). Session-gated so x-user-kerberos is
        // injected; must be matched here, before the anonymous directory reads.
        ((req?.method === 'GET' || req?.method === 'PATCH') &&
            /^\/api\/directory\/faculty\/[^/]+\/profile-extras$/.test(pathname));

    router.use((req, res, next) =>
        isFacultySelfEdit(req.path, req) ? requireSession(req, res, next) : next());

    router.use(createProxyMiddleware({
        pathFilter: isFacultySelfEdit,
        target: config.upstreams.backend,
        changeOrigin: true,
        on: proxyHooks('backend', (req) => req.identity ?? null)
    }));

    // Directory READS that carry per-faculty metrics (or profile-only fields) must
    // bypass gRPC: the directory.v1 proto has no `metricVisibility` field, and a
    // redacted (null) metric transcodes to 0 — so hidden metrics would leak/render
    // as "0" in the browser. These GET reads go over HTTP instead (the backend
    // returns the SAME `{success,message,data,timestamp}` envelope), so the
    // visibility flags + null redaction reach the frontend. Everything else in
    // /api/directory (unit summaries, /:id, batch resolves, publications) stays
    // gRPC. Public reads → no identity attached (client x-user-* headers stripped).
    const isDirectoryHttpRead = (pathname, req) => {
        if (req?.method !== 'GET') return false;
        return (
            pathname === '/api/directory' || pathname === '/api/directory/' ||
            /^\/api\/directory\/search$/.test(pathname) ||
            /^\/api\/directory\/grouped$/.test(pathname) ||
            /^\/api\/directory\/grouped\/[^/]+\/faculties$/.test(pathname) ||
            /^\/api\/directory\/faculty\/[^/]+\/(profile|research-summary)$/.test(pathname)
        );
    };

    router.use(createProxyMiddleware({
        pathFilter: isDirectoryHttpRead,
        target: config.upstreams.backend,
        changeOrigin: true,
        on: proxyHooks('backend')
    }));

    return router;
}
