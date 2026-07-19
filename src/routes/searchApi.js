import express, { Router } from 'express';

import { sendSearchError } from '../transcode/envelopes.js';
import * as s from '../transcode/search.js';
import { createUnaryBridge, notFoundError } from './grpcBridge.js';

const json = express.json();
const toInt = (v) => Number.parseInt(v, 10) || 0;

// Add an optional string filter to a request only when the client sent it, so
// unset browse params stay absent (proto3 presence) instead of empty strings.
const addOpt = (target, key, value) => {
    if (value !== undefined && value !== null && value !== '') target[key] = String(value);
    return target;
};

/**
 * Search + taxonomy surface (public path /search/api/v1/*), served over
 * search.v1 gRPC through Envoy. Responses are NOT enveloped — the frontend
 * consumes the body directly, matching the Fastify search-api.
 *
 * @param {{ search: object, taxonomy: object, deadline: number }} deps
 */
export default function searchRoutes({ search, taxonomy, deadline }) {
    const router = Router();
    const { call } = createUnaryBridge({
        clients: { search, taxonomy },
        onError: sendSearchError,
        defaultDeadline: deadline
    });

    // Raw pass-through of the mapped body (no envelope).
    const raw = (map) => (response, res) => res.status(200).json(map(response));

    const v1 = Router({ mergeParams: true });

    v1.post('/search', json, (req, res) => {
        const b = req.body || {};
        return call(req, res, {
            client: 'search', method: 'Search',
            request: {
                query: b.query || '',
                filters: b.filters,
                sort: b.sort || '',
                page: toInt(b.page),
                per_page: toInt(b.per_page),
                search_in: b.search_in || [],
                mode: b.mode || '',
                refine_within: b.refine_within,
                refine_chain: b.refine_chain || [],
                rerank: b.rerank
            },
            finish: raw(s.mapSearchBody)
        });
    });

    v1.post('/search/author-scope', json, (req, res) => {
        const b = req.body || {};
        return call(req, res, {
            client: 'search', method: 'SearchAuthorScope',
            request: {
                query: b.query || '',
                author_id: b.author_id || '',
                page: toInt(b.page),
                per_page: toInt(b.per_page),
                mode: b.mode || '',
                refine_within: b.refine_within,
                refine_chain: b.refine_chain || [],
                search_in: b.search_in || [],
                filters: b.filters
            },
            finish: raw(s.mapSearchBody)
        });
    });

    v1.get('/suggest', (req, res) => call(req, res, {
        client: 'search', method: 'Suggest',
        request: { q: req.query.q || '', limit: toInt(req.query.limit) },
        finish: raw(s.mapSuggest)
    }));

    // NOTE: the frozen proto FacultyForQueryRequest carries only query/mode/
    // search_in; refine_within/refine_chain/filters query params are NOT part
    // of the contract and are dropped here (flagged for review).
    v1.get('/search/faculty-for-query', (req, res) => call(req, res, {
        client: 'search', method: 'FacultyForQuery',
        request: {
            query: req.query.query || '',
            mode: req.query.mode || '',
            search_in: String(req.query.search_in || '').split(',').map((x) => x.trim()).filter(Boolean)
        },
        finish: raw(s.mapFacultyForQuery)
    }));

    v1.get('/document/:id/similar', (req, res) => call(req, res, {
        client: 'search', method: 'GetSimilarDocuments',
        request: { id: req.params.id, limit: toInt(req.query.limit) },
        finish: (response, r) => {
            if (!response.found) {
                return sendSearchError(r, notFoundError(
                    `Document with ID ${req.params.id} not found in search index`
                ));
            }
            return r.status(200).json(s.mapSimilar(response));
        }
    }));

    v1.get('/document/:id', (req, res) => call(req, res, {
        client: 'search', method: 'GetDocument',
        request: { id: req.params.id },
        finish: (response, r) => {
            if (!response.found) {
                return sendSearchError(r, notFoundError(
                    `Document with ID ${req.params.id} not found`
                ));
            }
            return r.status(200).json(s.mapDocument(response));
        }
    }));

    v1.get('/documents/by-author/:authorId', (req, res) => call(req, res, {
        client: 'search', method: 'GetDocumentsByAuthor',
        request: { author_id: req.params.authorId, page: toInt(req.query.page), per_page: toInt(req.query.per_page) },
        finish: raw(s.mapDocumentsByAuthor)
    }));

    v1.get('/author/:id/collaborators', (req, res) => call(req, res, {
        client: 'search', method: 'GetAuthorCollaborators',
        request: { author_id: req.params.id },
        finish: raw(s.mapCollaborators)
    }));

    v1.get('/ip/suggest', (req, res) => call(req, res, {
        client: 'search', method: 'IpSuggest',
        request: { q: req.query.q || '', limit: toInt(req.query.limit) },
        finish: raw(s.mapIpSuggest)
    }));

    v1.post('/ip/search', json, (req, res) => {
        const b = req.body || {};
        return call(req, res, {
            client: 'search', method: 'IpSearch',
            request: {
                query: b.query || '',
                filters: b.filters,
                sort: b.sort || '',
                page: toInt(b.page),
                per_page: toInt(b.per_page),
                search_in: b.search_in || [],
                mode: b.mode || '',
                refine_within: b.refine_within,
                refine_chain: b.refine_chain || [],
                rerank: b.rerank
            },
            finish: raw(s.mapSearchBody)
        });
    });

    v1.get('/ip/document/:id', (req, res) => call(req, res, {
        client: 'search', method: 'GetIpDocument',
        request: { id: req.params.id },
        finish: (response, r) => {
            if (!response.found) {
                return sendSearchError(r, notFoundError(
                    `IP document with ID ${req.params.id} not found`
                ));
            }
            return r.status(200).json(s.mapDocument(response));
        }
    }));

    v1.get('/taxonomy/departments', (req, res) => call(req, res, {
        client: 'taxonomy', method: 'GetDepartments', request: {},
        finish: raw(s.mapTaxDepartments)
    }));

    v1.get('/taxonomy/themes', (req, res) => call(req, res, {
        client: 'taxonomy', method: 'GetThemes',
        request: addOpt({}, 'department', req.query.department),
        finish: raw(s.mapThemes)
    }));

    v1.get('/taxonomy/domains', (req, res) => {
        const request = {};
        addOpt(request, 'theme', req.query.theme);
        addOpt(request, 'department', req.query.department);
        return call(req, res, { client: 'taxonomy', method: 'GetDomains', request, finish: raw(s.mapDomains) });
    });

    v1.get('/taxonomy/domains/:domainSlug/subdomains', (req, res) => {
        const request = { domain_slug: req.params.domainSlug };
        addOpt(request, 'theme', req.query.theme);
        addOpt(request, 'department', req.query.department);
        return call(req, res, { client: 'taxonomy', method: 'GetSubdomains', request, finish: raw(s.mapSubdomains) });
    });

    v1.get('/taxonomy/counts', (req, res) => {
        const request = {};
        addOpt(request, 'theme', req.query.theme);
        addOpt(request, 'domain', req.query.domain);
        addOpt(request, 'subdomain', req.query.subdomain);
        addOpt(request, 'department', req.query.department);
        return call(req, res, { client: 'taxonomy', method: 'GetCounts', request, finish: raw(s.mapCounts) });
    });

    v1.get('/taxonomy/faculty', (req, res) => {
        const request = { page: toInt(req.query.page), per_page: toInt(req.query.per_page) };
        addOpt(request, 'theme', req.query.theme);
        addOpt(request, 'domain', req.query.domain);
        addOpt(request, 'subdomain', req.query.subdomain);
        addOpt(request, 'department', req.query.department);
        return call(req, res, { client: 'taxonomy', method: 'GetFaculty', request, finish: raw(s.mapTaxonomyFaculty) });
    });

    v1.get('/taxonomy/faculty/:kerberos/papers', (req, res) => {
        const request = { kerberos: req.params.kerberos, page: toInt(req.query.page), per_page: toInt(req.query.per_page) };
        addOpt(request, 'theme', req.query.theme);
        addOpt(request, 'domain', req.query.domain);
        addOpt(request, 'subdomain', req.query.subdomain);
        return call(req, res, { client: 'taxonomy', method: 'GetFacultyPapers', request, finish: raw(s.mapTaxonomyFacultyPapers) });
    });

    router.use('/search/api/v1', v1);
    return router;
}
