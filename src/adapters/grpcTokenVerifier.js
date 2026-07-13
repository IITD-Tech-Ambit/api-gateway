import grpc from '@grpc/grpc-js';
import { loadPackage } from '../grpc/loadProto.js';

/**
 * TokenVerifier implementation backed by auth.v1.AuthService/VerifyToken,
 * reached through Envoy (the east-west gRPC front door).
 *
 * @implements {import('../ports/tokenVerifier.js').TokenVerifier}
 */
export default class GrpcTokenVerifier {
    /**
     * @param {{ envoyTarget: string, verifyTimeoutMs: number }} options
     * @param {import('pino').Logger} logger
     */
    constructor({ envoyTarget, verifyTimeoutMs }, logger) {
        const authPackage = loadPackage('auth/v1/auth.proto');
        this._client = new authPackage.auth.v1.AuthService(
            envoyTarget,
            grpc.credentials.createInsecure()
        );
        this._timeoutMs = verifyTimeoutMs;
        this._logger = logger;
    }

    /** @param {string} token @returns {Promise<import('../ports/tokenVerifier.js').VerifyResult>} */
    verify(token) {
        return new Promise((resolve) => {
            const deadline = new Date(Date.now() + this._timeoutMs);
            this._client.VerifyToken({ token }, { deadline }, (err, response) => {
                if (err) {
                    // Fail closed: chat is a protected surface, so an unreachable
                    // auth-service means "not authenticated", never a bypass.
                    this._logger.warn({ err: err.message }, 'VerifyToken RPC failed');
                    return resolve({ valid: false, error: 'auth_unavailable' });
                }
                if (!response.valid) {
                    return resolve({ valid: false, error: response.error || 'invalid_token' });
                }
                const u = response.user || {};
                resolve({
                    valid: true,
                    identity: {
                        userId: u.user_id || '',
                        email: u.email || '',
                        name: u.name || '',
                        kerberos: u.kerberos || '',
                        department: u.department || '',
                        category: u.category || ''
                    }
                });
            });
        });
    }

    close() {
        this._client.close();
    }
}
