import path from 'path';
import { fileURLToPath } from 'url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// protos/ is this repo's own committed copy of its needed proto files; the
// Docker image copies it to /app/protos (see Dockerfile). PROTO_DIR
// overrides for other layouts (e.g. local dev against the repo root).
const PROTO_DIR = process.env.PROTO_DIR || path.resolve(__dirname, '../../protos');

const LOADER_OPTIONS = {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_DIR]
};

/**
 * Load a proto file (path relative to the protos/ root) and return the
 * grpc-js package object, e.g. loadPackage('auth/v1/auth.proto').auth.v1.
 */
export function loadPackage(relativeProtoPath) {
    const definition = protoLoader.loadSync(
        path.join(PROTO_DIR, relativeProtoPath),
        LOADER_OPTIONS
    );
    return grpc.loadPackageDefinition(definition);
}
