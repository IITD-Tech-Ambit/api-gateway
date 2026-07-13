import express, { Router } from 'express';

import { sendSuccess, sendDirectoryError } from '../transcode/envelopes.js';
import * as d from '../transcode/directory.js';
import { createUnaryBridge } from './grpcBridge.js';

const json = express.json();
const toInt = (v) => Number.parseInt(v, 10) || 0;

/**
 * @param {{ directory: object, deadline: number }} deps
 */
export default function directoryRoutes({ directory, deadline }) {
    const router = Router({ mergeParams: true });
    const { call, ok } = createUnaryBridge({
        clients: { directory },
        onError: sendDirectoryError,
        defaultDeadline: deadline
    });

    router.get('/', (req, res) => call(req, res, {
        client: 'directory', method: 'ListFaculty',
        request: {
            page: toInt(req.query.page),
            limit: toInt(req.query.limit),
            sort_by: req.query.sortBy || '',
            order: req.query.order || ''
        },
        finish: ok(d.mapListFaculty, 'Faculties fetched successfully')
    }));

    router.get('/search', (req, res) => call(req, res, {
        client: 'directory', method: 'SearchDirectory',
        request: { q: req.query.q || '', limit: toInt(req.query.limit) },
        finish: (response, r) =>
            sendSuccess(r, d.mapSearchDirectory(response), response.message || 'Search completed')
    }));

    router.get('/grouped', (req, res) => {
        const summaryOnly = req.query.summaryOnly === 'true';
        return call(req, res, {
            client: 'directory', method: 'GetGrouped',
            request: { category: req.query.category || '', summary_only: summaryOnly },
            finish: (response, r) => sendSuccess(
                r,
                d.mapGrouped(response, { summaryOnly }),
                summaryOnly ? 'Grouped department summary fetched successfully' : 'Grouped faculties fetched successfully'
            )
        });
    });

    router.get('/grouped/:departmentId/faculties', (req, res) => call(req, res, {
        client: 'directory', method: 'GetDepartmentFaculties',
        request: { department_id: req.params.departmentId, category: req.query.category || '' },
        finish: ok(d.mapDepartmentFaculties, 'Department faculties fetched successfully')
    }));

    router.get('/by-scopus/:scopusId', (req, res) => call(req, res, {
        client: 'directory', method: 'GetFacultyByScopus',
        request: { scopus_id: req.params.scopusId },
        finish: (response, r) => sendSuccess(r, d.mapFaculty(response.faculty), 'Faculty fetched successfully')
    }));

    router.post('/by-scopus/batch', json, (req, res) => call(req, res, {
        client: 'directory', method: 'BatchFacultyByScopus',
        request: { scopus_ids: Array.isArray(req.body?.scopusIds) ? req.body.scopusIds : [] },
        finish: (response, r) => {
            const data = d.mapFacultyMatches(response);
            const message = Object.keys(data.matches).length ? 'Resolved' : 'No matching faculty';
            return sendSuccess(r, data, message);
        }
    }));

    router.post('/by-kerberos/batch', json, (req, res) => call(req, res, {
        client: 'directory', method: 'BatchFacultyByKerberos',
        request: { kerberos_ids: Array.isArray(req.body?.kerberosIds) ? req.body.kerberosIds : [] },
        finish: (response, r) => {
            const data = d.mapFacultyMatches(response);
            const message = Object.keys(data.matches).length ? 'Resolved' : 'No matching faculty';
            return sendSuccess(r, data, message);
        }
    }));

    router.get('/faculty/:kerberos/profile', (req, res) => call(req, res, {
        client: 'directory', method: 'GetFacultyProfile',
        request: { kerberos: req.params.kerberos },
        finish: (response, r) => sendSuccess(r, d.mapFaculty(response.faculty), 'Faculty fetched successfully')
    }));

    router.get('/faculty/:kerberos/research-summary', (req, res) => call(req, res, {
        client: 'directory', method: 'GetFacultyResearchSummary',
        request: {
            kerberos: req.params.kerberos,
            year_limit: toInt(req.query.yearLimit),
            year_offset: toInt(req.query.yearOffset)
        },
        finish: ok(d.mapJsonData, 'Research summary fetched successfully')
    }));

    router.get('/faculty/:kerberos/publications', (req, res) => call(req, res, {
        client: 'directory', method: 'GetFacultyPublications',
        request: {
            kerberos: req.params.kerberos,
            year: toInt(req.query.year),
            skip: toInt(req.query.skip),
            limit: toInt(req.query.limit)
        },
        finish: ok(d.mapJsonData, 'Publications fetched successfully')
    }));

    // Bare :id is the catch-all — MUST be registered last so it never shadows
    // the specific directory routes above.
    router.get('/:id', (req, res) => call(req, res, {
        client: 'directory', method: 'GetFacultyById',
        request: { id: req.params.id },
        finish: (response, r) => sendSuccess(r, d.mapFaculty(response.faculty), 'Faculty fetched successfully')
    }));

    return router;
}
