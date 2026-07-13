// Trusted identity headers injected by the gateway after VerifyToken.
// Client-supplied copies are ALWAYS stripped before proxying (see proxy.js),
// so downstream services can trust these values unconditionally.
export const IDENTITY_HEADERS = ['x-user-id', 'x-user-email', 'x-user-kerberos', 'x-user-category'];

/**
 * @param {import('../ports/tokenVerifier.js').TokenVerifier} tokenVerifier
 * @param {{ cookieName: string }} sessionConfig
 * @param {import('pino').Logger} logger
 */
export function makeRequireSession(tokenVerifier, { cookieName }, logger) {
    return async function requireSession(req, res, next) {
        const token = req.cookies?.[cookieName];
        if (!token) {
            logger.warn({ path: req.path, reason: 'no_token' }, 'chat auth denied');
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Login with your IITD account to use the chat assistant.',
                statusCode: 401
            });
        }

        const result = await tokenVerifier.verify(token);
        if (!result.valid) {
            logger.warn({
                path: req.path,
                reason: result.error || 'invalid_token'
            }, 'chat auth denied');
            return res.status(401).json({
                error: 'Unauthorized',
                message: result.error === 'auth_unavailable'
                    ? 'Authentication service is temporarily unavailable. Please try again.'
                    : 'Your session has expired. Please log in again.',
                statusCode: 401
            });
        }

        req.identity = result.identity;
        logger.debug({ path: req.path, userId: result.identity.userId }, 'chat auth ok');
        next();
    };
}

/**
 * Strip any client-supplied identity headers from the outbound proxy request
 * and, when a verified identity is present, replace them with trusted values.
 * Operates on the http.ClientRequest that http-proxy-middleware is about to send.
 *
 * @param {import('http').ClientRequest} proxyReq
 * @param {import('../ports/tokenVerifier.js').VerifiedIdentity|null} identity
 */
export function applyIdentityHeaders(proxyReq, identity) {
    for (const h of IDENTITY_HEADERS) proxyReq.removeHeader(h);
    if (identity) {
        proxyReq.setHeader('x-user-id', identity.userId);
        proxyReq.setHeader('x-user-email', identity.email);
        proxyReq.setHeader('x-user-kerberos', identity.kerberos);
        proxyReq.setHeader('x-user-category', identity.category);
    }
}
