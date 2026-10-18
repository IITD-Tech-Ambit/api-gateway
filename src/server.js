import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import 'dotenv/config';

import config from './config.js';
import { createLogger } from './logger.js';
import { requestLogger } from './middleware/requestLogger.js';
import { metricsMiddleware, startMetricsServer } from './metrics.js';
import GrpcTokenVerifier from './adapters/grpcTokenVerifier.js';
import { createGrpcClients } from './grpc/clients.js';
import proxyRoutes from './routes/proxy.js';
import apiRoutes from './routes/api.js';
import searchRoutes from './routes/searchApi.js';
import healthRoutes from './routes/health.js';

function start() {
    const logger = createLogger(config.logLevel);
    if (!config.enableAuth && config.production) {
        logger.fatal('ENABLE_AUTH=false is not allowed when NODE_ENV=production — refusing to bypass IITD OAuth');
        process.exit(1);
    }
    if (!config.gatewaySecret && config.production) {
        logger.warn('GATEWAY_SHARED_SECRET is not set — downstream services cannot verify that identity headers came from the gateway');
    }
    const app = express();
    app.disable('x-powered-by');

    const tokenVerifier = new GrpcTokenVerifier(config.grpc, logger);
    // East-west gRPC clients (directory.v1 + search.v1 via Envoy). Constructed
    // now, but connect lazily — startup must not fail if Envoy is down.
    const grpcClients = createGrpcClients(config.grpc);

    app.use(requestLogger(logger));
    app.use(metricsMiddleware);

    if (config.corsOrigin) {
        app.use(cors({ origin: config.corsOrigin, credentials: true }));
    }

    app.use(cookieParser());
    app.use(healthRoutes({ config, logger }));
    // /api/auth (+ /chat-api) stay HTTP proxies; register BEFORE the gRPC /api
    // router so the auth path is never captured by directory routing.
    app.use(proxyRoutes({ config, tokenVerifier, logger }));
    app.use(apiRoutes({ clients: grpcClients }));
    app.use(searchRoutes({
        search: grpcClients.search,
        taxonomy: grpcClients.taxonomy,
        deadline: grpcClients.deadlines.search
    }));

    app.use((error, req, res, next) => {
        if (error instanceof multer.MulterError) {
            const tooLarge = error.code === 'LIMIT_FILE_SIZE';
            return res.status(tooLarge ? 413 : 400).json({
                error: tooLarge ? 'Payload Too Large' : 'Bad Request',
                message: tooLarge ? 'Image must be under 5 MB.' : 'Invalid file upload.',
                statusCode: tooLarge ? 413 : 400
            });
        }
        req.log?.error({ err: error }, 'unhandled error');
        res.status(error.statusCode || 502).json({
            error: 'Bad Gateway',
            message: 'Upstream request failed',
            statusCode: error.statusCode || 502
        });
    });

    const server = app.listen(config.port, config.host, () => {
        logger.info({
            port: config.port,
            host: config.host,
            env: process.env.NODE_ENV || 'development',
            cors: config.corsOrigin || 'off'
        }, 'api-gateway listening');
    });
    server.requestTimeout = 0;
    const metricsServer = startMetricsServer(config.metricsPort, config.host);

    const signals = ['SIGINT', 'SIGTERM'];
    for (const signal of signals) {
        process.on(signal, () => {
            logger.info({ signal }, 'shutting down');
            tokenVerifier.close();
            grpcClients.close();
            metricsServer.close();
            server.close(() => process.exit(0));
        });
    }

    server.on('error', (error) => {
        logger.fatal({ err: error }, 'server error');
        process.exit(1);
    });
}

start();
