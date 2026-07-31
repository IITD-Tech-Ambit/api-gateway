import grpc from '@grpc/grpc-js';
import { loadPackage } from './loadProto.js';

// Channel options shared by every client. Because all clients target the same
// Envoy address with identical options, grpc-js pools the underlying TCP
// subchannels — effectively one connection to Envoy, which demuxes by the
// gRPC service name (directory.v1.* -> backend, search.v1.* -> search-api).
//
// Retries/circuit-breaking are owned by Envoy (see envoy/envoy.yaml), so the
// client stays thin: we only widen message limits (the KG atlas payload is
// large) and enable keepalive so idle channels survive.
const CHANNEL_OPTIONS = {
    'grpc.max_receive_message_length': 256 * 1024 * 1024,
    'grpc.max_send_message_length': 64 * 1024 * 1024,
    'grpc.keepalive_time_ms': 60_000,
    'grpc.keepalive_timeout_ms': 20_000,
    'grpc.keepalive_permit_without_calls': 1
};

/**
 * Composition root for the east-west gRPC clients. Clients are constructed
 * eagerly, but grpc-js connects LAZILY on first RPC — so the gateway boots
 * fine while Envoy (and the backend/search services behind it) are still down.
 *
 * @param {{ envoyTarget: string, directoryDeadlineMs: number, searchDeadlineMs: number, atlasDeadlineMs: number }} grpcConfig
 * @returns {{
 *   directory: object, knowledgeGraph: object, content: object, user: object, suggestion: object,
 *   search: object, taxonomy: object,
 *   deadlines: { directory: number, search: number, atlas: number },
 *   close: () => void
 * }}
 */
export function createGrpcClients(grpcConfig) {
    const { envoyTarget } = grpcConfig;
    const credentials = grpc.credentials.createInsecure();

    const directoryPkg = loadPackage('directory/v1/directory.proto').directory.v1;
    const searchPkg = loadPackage('search/v1/search.proto').search.v1;

    const mk = (Ctor) => new Ctor(envoyTarget, credentials, CHANNEL_OPTIONS);

    const clients = {
        // directory.v1 — one Envoy cluster (backend:50055).
        directory: mk(directoryPkg.DirectoryService),
        knowledgeGraph: mk(directoryPkg.KnowledgeGraphService),
        content: mk(directoryPkg.ContentService),
        user: mk(directoryPkg.UserService),
        suggestion: mk(directoryPkg.SuggestionService),
        // search.v1 — one Envoy cluster (search-api:50053).
        search: mk(searchPkg.SearchService),
        taxonomy: mk(searchPkg.TaxonomyService),

        deadlines: {
            directory: grpcConfig.directoryDeadlineMs,
            search: grpcConfig.searchDeadlineMs,
            atlas: grpcConfig.atlasDeadlineMs
        },

        close() {
            for (const c of [
                clients.directory, clients.knowledgeGraph, clients.content,
                clients.user, clients.suggestion, clients.search, clients.taxonomy
            ]) {
                c.close?.();
            }
        }
    };

    return clients;
}
