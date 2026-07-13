import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import 'dotenv/config';

import config from './config.js';
import { createLogger } from './logger.js';
import { requestLogger } from './middleware/requestLogger.js';
import GrpcTokenVerifier from './adapters/grpcTokenVerifier.js';
import { createGrpcClients } from './grpc/clients.js';
import proxyRoutes from './routes/proxy.js';
import apiRoutes from './routes/api.js';
import searchRoutes from './routes/searchApi.js';
import healthRoutes from './routes/health.js';

function start() {
    const logger = createLogger(config.logLevel);
    const app = express();
    app.disable('x-powered-by');

    const tokenVerifier = new GrpcTokenVerifier(config.grpc, logger);
    // East-west gRPC clients (directory.v1 + search.v1 via Envoy). Constructed
    // now, but connect lazily — startup must not fail if Envoy is down.
    const grpcClients = createGrpcClients(config.grpc);

    app.use(requestLogger(logger));

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

    const signals = ['SIGINT', 'SIGTERM'];
    for (const signal of signals) {
        process.on(signal, () => {
            logger.info({ signal }, 'shutting down');
            tokenVerifier.close();
            grpcClients.close();
            server.close(() => process.exit(0));
        });
    }

    server.on('error', (error) => {
        logger.fatal({ err: error }, 'server error');
        process.exit(1);
    });
}

start();
