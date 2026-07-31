/**
 * Promisify a unary gRPC client method with a deadline and metadata.
 *
 * Rejects with the raw grpc-js error (which carries `.code`, `.details`,
 * `.metadata`) so the caller can map it to an HTTP status + error envelope.
 *
 * @param {object} client   grpc-js client instance
 * @param {string} method   RPC method name (e.g. 'ListFaculty')
 * @param {object} request  request message
 * @param {import('@grpc/grpc-js').Metadata} metadata
 * @param {number} deadlineMs  per-call deadline in milliseconds
 * @returns {Promise<object>} the response message
 */
export function unaryCall(client, method, request, metadata, deadlineMs) {
    return new Promise((resolve, reject) => {
        const deadline = new Date(Date.now() + deadlineMs);
        client[method](request, metadata, { deadline }, (err, response) => {
            if (err) return reject(err);
            resolve(response);
        });
    });
}
