import { grpcToHttpStatus } from '../grpc/status.js';

// proto3 `optional` fields decode to undefined when unset (they are synthetic
// oneof members, so proto-loader's `defaults` never fills them). Empty string
// is treated as absent too, matching the backend's `pickPrimaryIdentifier`.
export function isAbsent(value) {
    return value === undefined || value === null || value === '';
}

// Parse a documented `*_json` opaque string back into the ORIGINAL nested JSON
// the frontend expects. Empty/absent -> null (never throws on '').
export function parseJsonField(str) {
    if (str === undefined || str === null || str === '') return null;
    return JSON.parse(str);
}

/**
 * Assign `key: value` only when present; otherwise omit the key entirely.
 * Used for fields the REST DTO omits (orcId/scopusId/googleScholarId).
 */
export function assignIfPresent(target, key, value) {
    if (!isAbsent(value)) target[key] = value;
    return target;
}

/**
 * Assign `key: value`, falling back to null when the source is absent.
 * Used for fields the REST DTO emits as `null` (profileImageUrl/designation/...).
 */
export function assignOrNull(target, key, value) {
    target[key] = isAbsent(value) ? null : value;
    return target;
}

// The research-ambit backend wraps every /api response as
// { success, message, data, timestamp }; the gateway rebuilds that envelope
// around the typed/opaque `data` carried over gRPC.
export function successEnvelope(data, message) {
    return {
        success: true,
        message,
        data,
        timestamp: new Date().toISOString()
    };
}

export function sendSuccess(res, data, message, statusCode = 200) {
    return res.status(statusCode).json(successEnvelope(data, message));
}

// gRPC status -> HTTP status, preserving the error-body shape each surface
// already returns.

// Optional structured validation details: the backend may attach the original
// `errors` array as a JSON string in trailing metadata so the gateway can
// reproduce the { success:false, message, errors } validation body verbatim.
function extractErrors(grpcError) {
    try {
        const raw = grpcError.metadata?.get('errors-json')?.[0];
        return raw ? JSON.parse(String(raw)) : null;
    } catch {
        return null;
    }
}

/**
 * directory.v1 error body: { success:false, message, errors, timestamp }
 * (matches research-ambit-main errorResponse).
 */
export function sendDirectoryError(res, grpcError) {
    const status = grpcToHttpStatus(grpcError.code);
    return res.status(status).json({
        success: false,
        message: grpcError.details || 'Upstream request failed',
        errors: extractErrors(grpcError),
        timestamp: new Date().toISOString()
    });
}

const HTTP_ERROR_LABELS = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout'
};

/**
 * search.v1 error body: { error, message, statusCode } (matches the Fastify
 * search-api error shape the frontend already handles).
 */
export function sendSearchError(res, grpcError) {
    const status = grpcToHttpStatus(grpcError.code);
    return res.status(status).json({
        error: HTTP_ERROR_LABELS[status] || 'Bad Gateway',
        message: grpcError.details || 'Search request failed',
        statusCode: status
    });
}
