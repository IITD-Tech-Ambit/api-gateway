import { Router } from 'express';

/**
 * /health — gateway liveness plus aggregated upstream health.
 * Never fails the gateway's own healthcheck because an upstream is down;
 * the aggregate status is informational ("ok" | "degraded").
 */
export default function healthRoutes({ config, logger }) {
    const router = Router();

    const targets = {
        'auth-service': `${config.upstreams.authService}/health`,
        backend: `${config.upstreams.backend}/health`,
        'search-api': `${config.upstreams.searchApi}/health`,
        chatbot: `${config.upstreams.chatbot}/health`
    };

    async function probe(url) {
        try {
            const res = await fetch(url, {
                signal: AbortSignal.timeout(config.health.probeTimeoutMs)
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    router.get('/health', async (req, res) => {
        const entries = await Promise.all(
            Object.entries(targets).map(async ([name, url]) => [name, await probe(url)])
        );
        const services = Object.fromEntries(entries);
        const status = entries.every(([, ok]) => ok) ? 'ok' : 'degraded';
        logger.info({ status, services }, 'health aggregate');
        res.json({
            status,
            services,
            timestamp: new Date().toISOString()
        });
    });

    // Liveness: the process is up. Readiness: the gateway can accept traffic —
    // it is ready as soon as it is listening (the gRPC channel to Envoy connects
    // lazily, so readiness never depends on Envoy/upstreams being live).
    router.get('/health/live', (req, res) => res.json({ status: 'ok' }));
    router.get('/health/ready', (req, res) => res.json({ status: 'ready' }));

    return router;
}
