import grpc from '@grpc/grpc-js';

/**
 * Build the outbound gRPC metadata for an HTTP request.
 *
 * Trust model: we always start from an EMPTY Metadata object, so any client
 * supplied `x-user-*` header is dropped by construction. Identity is only ever
 * set from a gateway-verified `req.identity`. The CMS `Authorization: Bearer`
 * header is forwarded verbatim as the `authorization` key because the backend
 * re-runs its own JWT/role check (directory.v1 content/user writes).
 *
 * @param {import('express').Request} req
 * @returns {import('@grpc/grpc-js').Metadata}
 */
export function buildMetadata(req) {
    const metadata = new grpc.Metadata();

    // Request correlation id (pino-http sets req.id; fall back to inbound header).
    const requestId = req.id || req.headers['x-request-id'];
    if (requestId) metadata.set('x-request-id', String(requestId));

    // CMS JWT passthrough for authenticated directory.v1 writes.
    const authorization = req.headers['authorization'];
    if (authorization) metadata.set('authorization', authorization);

    // Trusted identity (present only after session validation on protected
    // routes). Public directory/search routes leave this unset.
    const identity = req.identity;
    if (identity) {
        if (identity.userId) metadata.set('x-user-id', identity.userId);
        if (identity.email) metadata.set('x-user-email', identity.email);
        if (identity.kerberos) metadata.set('x-user-kerberos', identity.kerberos);
    }

    return metadata;
}
