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

    return router;
}
