import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';

/**
 * HTTP access logging. Dev: pretty via pino-pretty; prod: newline JSON.
 * Skips /health/live (Docker probe spam).
 *
 * @param {import('pino').Logger} logger
 */
export function requestLogger(logger) {
    return pinoHttp({
        logger,
        genReqId: (req) => req.headers['x-request-id'] || randomUUID(),
        customLogLevel(req, res, err) {
            if (err || res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
        },
        customSuccessMessage(req, res) {
            return `${req.method} ${req.url} ${res.statusCode}`;
        },
        customErrorMessage(req, res, err) {
            return `${req.method} ${req.url} ${res.statusCode} ${err.message}`;
        },
        autoLogging: {
            ignore: (req) => req.url === '/health/live'
        },
        serializers: {
            req(req) {
                return {
                    id: req.id,
                    method: req.method,
                    url: req.url,
                    remoteAddress: req.remoteAddress
                };
            },
            res(res) {
                return { statusCode: res.statusCode };
            }
        }
    });
}
