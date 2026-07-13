import grpc from '@grpc/grpc-js';

import { buildMetadata } from '../grpc/metadata.js';
import { unaryCall } from '../grpc/call.js';
import { sendSuccess } from '../transcode/envelopes.js';

/** @param {string} details */
export function notFoundError(details) {
    return { code: grpc.status.NOT_FOUND, details };
}

/**
 * Shared unary HTTP↔gRPC bridge: metadata + deadline + error strategy.
 *
 * @param {{
 *   clients: Record<string, object>,
 *   onError: (res: import('express').Response, err: object) => unknown,
 *   defaultDeadline: number
 * }} options
 */
export function createUnaryBridge({ clients, onError, defaultDeadline }) {
    async function call(req, res, { client, method, request, deadline = defaultDeadline, finish }) {
        try {
            const response = await unaryCall(
                clients[client],
                method,
                request,
                buildMetadata(req),
                deadline
            );
            return finish(response, res);
        } catch (err) {
            return onError(res, err);
        }
    }

    const ok = (map, message, status = 200) => (response, res) =>
        sendSuccess(res, map(response), message, status);

    return { call, ok };
}
