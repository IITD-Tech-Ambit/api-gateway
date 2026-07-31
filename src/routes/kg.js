import { Router } from 'express';

import { sendSuccess, sendDirectoryError } from '../transcode/envelopes.js';
import * as d from '../transcode/directory.js';
import { createUnaryBridge, notFoundError } from './grpcBridge.js';

const toInt = (v) => Number.parseInt(v, 10) || 0;

/**
 * @param {{ knowledgeGraph: object, deadline: number, atlasDeadline: number }} deps
 */
export default function kgRoutes({ knowledgeGraph, deadline, atlasDeadline }) {
    const router = Router({ mergeParams: true });
    const { call, ok } = createUnaryBridge({
        clients: { knowledgeGraph },
        onError: sendDirectoryError,
        defaultDeadline: deadline
    });

    router.get('/health', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'GetHealth', request: {},
        finish: ok(d.mapKgHealth, 'Success')
    }));

    router.get('/faculty', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'GetFacultyIndex', request: {},
        finish: ok(d.mapJsonData, 'Success')
    }));

    router.get('/faculty/:id/knowledge-graph', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'GetFacultyKnowledgeGraph',
        request: { id: req.params.id },
        finish: ok(d.mapJsonData, 'Success')
    }));

    router.get('/explore/terms', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'ExploreTerms',
        request: { q: req.query.q || '', type: req.query.type || '', limit: toInt(req.query.limit) },
        finish: ok(d.mapJsonData, 'Success')
    }));

    router.get('/explore/detail', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'ExploreDetail',
        request: { key: req.query.key || '' },
        finish: (response, r) => {
            if (!response.found) {
                return sendDirectoryError(r, notFoundError(
                    `No explore detail for key '${req.query.key || ''}'.`
                ));
            }
            return sendSuccess(r, d.mapJsonData({ data_json: response.detail_json }), 'Success');
        }
    }));

    router.get('/paper/:id/meta', (req, res) => {
        const rawId = String(req.params.id).replace(/[^a-fA-F0-9]/g, '');
        return call(req, res, {
            client: 'knowledgeGraph', method: 'GetPaperMeta',
            request: { id: rawId },
            finish: (response, r) => {
                if (!response.found) {
                    return sendDirectoryError(r, notFoundError(`No paper found for id '${rawId}'.`));
                }
                return sendSuccess(r, d.mapPaperMeta(response), 'Success');
            }
        });
    });

    // GET /api/kg/atlas — RAW body (not enveloped), ETag/304 aware.
    router.get('/atlas', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'GetAtlas', deadline: atlasDeadline,
        request: { if_none_match: req.headers['if-none-match'] || '' },
        finish: (response, r) => {
            r.setHeader('Content-Type', 'application/json; charset=utf-8');
            r.setHeader('Cache-Control', 'no-cache, must-revalidate');
            if (response.etag) r.setHeader('ETag', response.etag);
            if (response.not_modified) return r.status(304).end();
            return r.status(200).send(response.body_json);
        }
    }));

    router.get('/atlas/search', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'SearchAtlas',
        request: { q: req.query.q || '', limit: toInt(req.query.limit) },
        finish: ok(d.mapAtlasIndices, 'Success')
    }));

    router.get('/atlas/refine', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'SearchAtlasRefine', deadline: atlasDeadline,
        request: {
            base_q: req.query.baseQ || req.query.base_q || '',
            q: req.query.q || '',
            limit: toInt(req.query.limit),
            entity: req.query.entity || '',
            base_entity: req.query.baseEntity || req.query.base_entity || '',
        },
        finish: ok(d.mapAtlasRefine, 'Success')
    }));

    router.get('/atlas/suggest', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'SearchAtlasSuggest',
        request: { q: req.query.q || '', limit: toInt(req.query.limit) },
        finish: ok(d.mapAtlasSuggest, 'Success')
    }));

    router.get('/atlas/faculty-indices', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'GetAtlasFacultyIndices',
        request: { ids: String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean) },
        finish: ok(d.mapAtlasFacultyIndices, 'Success')
    }));

    router.get('/atlas/faculty-search', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'SearchAtlasFaculty',
        request: { q: req.query.q || '', limit: toInt(req.query.limit) },
        finish: ok(d.mapAtlasFacultySearch, 'Success')
    }));

    router.get('/atlas/department-indices', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'GetAtlasDepartmentIndices',
        request: { departments: String(req.query.departments || '').split('|').map((s) => s.trim()).filter(Boolean) },
        finish: ok(d.mapAtlasDepartmentIndices, 'Success')
    }));

    router.get('/atlas/year-indices', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'GetAtlasYearIndices',
        request: { since_year: toInt(req.query.sinceYear || req.query.since_year) },
        finish: ok(d.mapAtlasYearIndices, 'Success')
    }));

    router.get('/atlas/department-search', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'SearchAtlasDepartment',
        request: { q: req.query.q || '', limit: toInt(req.query.limit) },
        finish: ok(d.mapAtlasDepartmentSearch, 'Success')
    }));

    router.get('/atlas/cluster-breakdown', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'GetAtlasClusterBreakdown', deadline: atlasDeadline,
        request: { theme: req.query.theme || '', q: req.query.q || '', paper_limit: toInt(req.query.paperLimit) },
        finish: ok(d.mapAtlasClusterBreakdown, 'Success')
    }));

    router.get('/atlas/tree', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'GetAtlasTree', deadline: atlasDeadline, request: {},
        finish: ok(d.mapJsonData, 'Success')
    }));

    router.get('/atlas/dict', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'GetAtlasDict', deadline: atlasDeadline, request: {},
        finish: ok(d.mapJsonData, 'Success')
    }));

    router.get('/atlas/points', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'GetAtlasPoints',
        request: {
            indices: String(req.query.indices || '')
                .split(',').map((s) => Number.parseInt(s, 10)).filter(Number.isFinite)
        },
        finish: ok((r) => ({
            points: (r.points || []).map((p) => ({
                i: p.i,
                x: p.x,
                y: p.y,
                z: p.z,
                id: p.id || '',
                title: p.title || '',
                theme: p.theme || '',
                domain: p.domain || '',
                department: p.department || '',
            })),
        }), 'Success')
    }));

    // Raw quantized bytes (not enveloped); immutable per build => long cache.
    router.get('/atlas/tile/:nodeKey', (req, res) => call(req, res, {
        client: 'knowledgeGraph', method: 'GetAtlasTile', deadline: atlasDeadline,
        request: { node_key: req.params.nodeKey },
        finish: (response, r) => {
            if (response.etag) r.setHeader('ETag', response.etag);
            if (req.headers['if-none-match'] && req.headers['if-none-match'] === response.etag) {
                return r.status(304).end();
            }
            r.setHeader('Content-Type', 'application/octet-stream');
            r.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            return r.status(200).send(Buffer.from(response.payload || []));
        }
    }));

    return router;
}
