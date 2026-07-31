import grpc from '@grpc/grpc-js';

// gRPC status code -> HTTP status code. Kept explicit (not a formula) so the
// mapping is auditable against the shapes the frontend already handles.
const GRPC_TO_HTTP = {
    [grpc.status.OK]: 200,
    [grpc.status.CANCELLED]: 499,
    [grpc.status.UNKNOWN]: 500,
    [grpc.status.INVALID_ARGUMENT]: 400,
    [grpc.status.DEADLINE_EXCEEDED]: 504,
    [grpc.status.NOT_FOUND]: 404,
    [grpc.status.ALREADY_EXISTS]: 409,
    [grpc.status.PERMISSION_DENIED]: 403,
    [grpc.status.RESOURCE_EXHAUSTED]: 429,
    [grpc.status.FAILED_PRECONDITION]: 400,
    [grpc.status.ABORTED]: 409,
    [grpc.status.OUT_OF_RANGE]: 400,
    [grpc.status.UNIMPLEMENTED]: 501,
    [grpc.status.INTERNAL]: 500,
    [grpc.status.UNAVAILABLE]: 503,
    [grpc.status.DATA_LOSS]: 500,
    [grpc.status.UNAUTHENTICATED]: 401
};

/** @param {number} code gRPC status code @returns {number} HTTP status code */
export function grpcToHttpStatus(code) {
    return GRPC_TO_HTTP[code] ?? 502;
}
