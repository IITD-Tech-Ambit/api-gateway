import http from 'http';
import client from 'prom-client';

/**
 * Prometheus metrics for api-gateway.
 *
 * /metrics is on METRICS_PORT, not the public port: the edge proxy forwards every path.
 *
 * Uses the SAME metric name/label scheme as every other service
 * (http_request_duration_seconds{method,route,status_code}) so dashboards
 * and alert rules stay uniform across the platform.
 */

const register = new client.Registry();
register.setDefaultLabels({ service: 'api-gateway' });
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [register]
});

function resolveRoute(req) {
    if (req.route?.path) {
        const base = req.baseUrl || '';
        return `${base}${req.route.path}` || '/';
    }
    return 'unmatched';
}

export function metricsMiddleware(req, res, next) {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const seconds = Number(process.hrtime.bigint() - start) / 1e9;
        httpRequestDuration
            .labels(req.method, resolveRoute(req), String(res.statusCode))
            .observe(seconds);
    });
    next();
}

export function startMetricsServer(port, host) {
    return http.createServer(async (req, res) => {
        if (req.url !== '/metrics') {
            res.writeHead(404);
            return res.end();
        }
        try {
            const body = await register.metrics();
            res.writeHead(200, { 'Content-Type': register.contentType });
            res.end(body);
        } catch (err) {
            res.writeHead(500);
            res.end(String(err));
        }
    }).listen(port, host);
}

export { register };
