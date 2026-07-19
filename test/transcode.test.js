import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as d from '../src/transcode/directory.js';
import * as s from '../src/transcode/search.js';
import { successEnvelope, parseJsonField, isAbsent } from '../src/transcode/envelopes.js';
import { grpcToHttpStatus } from '../src/grpc/status.js';

// These tests are the shape-fidelity contract: representative gRPC response
// fixtures (keepCase snake_case, as proto-loader emits) -> the EXACT JSON the
// frontend received from the REST endpoints. A regression here means the SPA
// sees a different body shape.

// ---------------------------------------------------------------------------
// directory.v1
// ---------------------------------------------------------------------------

test('mapDepartment: card projection omits category', () => {
    assert.deepEqual(
        d.mapDepartment({ id: '507f1f77bcf86cd799439011', name: 'Physics', code: 'PHY' }),
        { _id: '507f1f77bcf86cd799439011', name: 'Physics', code: 'PHY' }
    );
});

test('mapDepartment: detail includes category; unset -> null', () => {
    assert.deepEqual(
        d.mapDepartment({ id: '1', name: 'CS', code: 'CSE', category: 'Department' }),
        { _id: '1', name: 'CS', code: 'CSE', category: 'Department' }
    );
    assert.equal(d.mapDepartment(undefined), null);
    assert.equal(d.mapDepartment({}), null);
});

test('mapFacultyCard: null image/designation, department null when absent', () => {
    const card = {
        id: 'f1', name: 'Dr A', email: 'a@iitd.ac.in',
        citation_count: 12, h_index: 5, research_areas: ['ML'],
        department: undefined, profile_image_url: undefined, designation: undefined
    };
    assert.deepEqual(d.mapFacultyCard(card), {
        _id: 'f1', name: 'Dr A', email: 'a@iitd.ac.in',
        citationCount: 12, hIndex: 5, research_areas: ['ML'],
        department: null, profileImageUrl: null, designation: null
    });
});

test('mapFaculty: absent identifiers OMITTED, workingFromYear null when absent', () => {
    const faculty = {
        id: 'f2', name: 'Dr B', email: 'b@iitd.ac.in',
        citation_count: 100, h_index: 9, research_areas: ['NLP'],
        // orc_id/scopus_id/google_scholar_id unset -> undefined
        department: { id: 'd1', name: 'CS', code: 'CSE', category: 'Department' },
        tags: ['all'], profile_image_url: 'http://img', designation: 'Prof',
        working_from_year: undefined
    };
    const out = d.mapFaculty(faculty);
    assert.deepEqual(out, {
        _id: 'f2', name: 'Dr B', email: 'b@iitd.ac.in',
        citationCount: 100, hIndex: 9, research_areas: ['NLP'],
        department: { _id: 'd1', name: 'CS', code: 'CSE', category: 'Department' },
        tags: ['all'], profileImageUrl: 'http://img', designation: 'Prof',
        workingFromYear: null
    });
    assert.ok(!('orcId' in out) && !('scopusId' in out) && !('googleScholarId' in out));
});

test('mapFaculty: present identifiers appear in source order', () => {
    const out = d.mapFaculty({
        id: 'f3', name: 'C', email: 'c@x', citation_count: 0, h_index: 0,
        research_areas: [], orc_id: '0000-1', scopus_id: '55', google_scholar_id: 'gs1',
        working_from_year: 2015
    });
    assert.deepEqual(Object.keys(out), [
        '_id', 'name', 'email', 'citationCount', 'hIndex', 'research_areas',
        'orcId', 'scopusId', 'googleScholarId', 'department', 'tags',
        'profileImageUrl', 'designation', 'workingFromYear'
    ]);
    assert.equal(out.workingFromYear, 2015);
    assert.equal(out.orcId, '0000-1');
});

test('mapListFaculty + mapPagination', () => {
    const msg = {
        data: [{ id: 'f1', name: 'A', email: 'a@x', citation_count: 1, h_index: 1, research_areas: [] }],
        pagination: { page: 2, limit: 9, total: 20, total_pages: 3, has_next: true, has_prev: true }
    };
    const out = d.mapListFaculty(msg);
    assert.deepEqual(out.pagination, { page: 2, limit: 9, total: 20, totalPages: 3, hasNext: true, hasPrev: true });
    assert.equal(out.data[0]._id, 'f1');
    assert.equal(out.data[0].department, null);
});

test('mapGrouped: summary omits faculties + avgHIndex, full includes both', () => {
    const msg = {
        departments: [{
            id: 'd1', department: { id: 'd1', name: 'CS' },
            stats: { total_faculty: 3 }, faculties: []
        }],
        total_departments: 1, total_faculty: 3
    };
    const summary = d.mapGrouped(msg, { summaryOnly: true });
    assert.deepEqual(summary.departments[0], {
        _id: 'd1', department: { _id: 'd1', name: 'CS' }, stats: { totalFaculty: 3 }
    });
    assert.equal('faculties' in summary.departments[0], false);

    const fullMsg = {
        departments: [{
            id: 'd1', department: { id: 'd1', name: 'CS' },
            stats: { total_faculty: 1, avg_h_index: 7.5 },
            faculties: [{ id: 'f1', name: 'A', email: 'a@x', citation_count: 0, h_index: 0, research_areas: [] }]
        }],
        total_departments: 1, total_faculty: 1
    };
    const full = d.mapGrouped(fullMsg, { summaryOnly: false });
    assert.equal(full.departments[0].stats.avgHIndex, 7.5);
    assert.equal(full.departments[0].faculties[0]._id, 'f1');
});

test('mapFacultyMatches: keyed map of full faculty', () => {
    const out = d.mapFacultyMatches({
        matches: { '55': { id: 'f1', name: 'A', email: 'a@x', citation_count: 0, h_index: 0, research_areas: [] } }
    });
    assert.equal(out.matches['55']._id, 'f1');
});

test('mapJsonData: opaque data_json round-trips to nested shape', () => {
    const original = { faculty: { name: 'X', _id: 'f1' }, timeline: [{ year: 2020, papers: [{ matched_profile: null }] }] };
    assert.deepEqual(d.mapJsonData({ data_json: JSON.stringify(original) }), original);
});

test('mapKgHealth', () => {
    assert.deepEqual(d.mapKgHealth({
        graphs_ready: true, explore_ready: false, atlas_ready: true, atlas_count: 42,
        data_dir: '/data/kg', redis_connected: true, cache_ttl_seconds: 10800
    }), {
        graphsReady: true, exploreReady: false, atlasReady: true, atlasCount: 42,
        dataDir: '/data/kg', redisConnected: true, cacheTtlSeconds: 10800
    });
});

test('mapPaperMeta: nested authors/iitd_faculty camelCase facultyId', () => {
    const out = d.mapPaperMeta({
        link: 'http://l', document_scopus_id: 'ds', document_eid: 'e', title: 'T', abstract: 'A',
        publication_year: 2021, citation_count: 3, reference_count: 10, document_type: 'Article',
        field_associated: 'CS', subject_area: ['AI'],
        authors: [{ name: 'N', author_id: '1', position: 1 }],
        iitd_faculty: [{ faculty_id: 'fid', name: 'FN', department: 'CS', kerberos: 'k' }]
    });
    assert.equal(out.iitd_faculty[0].facultyId, 'fid');
    assert.equal(out.authors[0].author_id, '1');
    assert.equal(out.publication_year, 2021);
});

test('mapAtlasIndices / faculty-search camelCase counts', () => {
    assert.deepEqual(d.mapAtlasIndices({ query: 'ai', match_count: 2, indices: [1, 2] }),
        { query: 'ai', matchCount: 2, indices: [1, 2] });
    const fs = d.mapAtlasFacultySearch({
        query: 'x', match_count: 1, indices: [3],
        matches: [{ faculty_id: 'f', name: 'N', department: 'D', paper_count: 5, atlas_count: 4 }]
    });
    assert.deepEqual(fs.matches[0], { facultyId: 'f', name: 'N', department: 'D', paperCount: 5, atlasCount: 4 });
});

test('mapAtlasClusterBreakdown', () => {
    const out = d.mapAtlasClusterBreakdown({
        theme: 'T', query: 'q', total_papers: 2,
        departments: [{ department: 'CS', paper_count: 2, papers: [{ id: 'p', i: 1, title: 't', domain: 'd', topic: 'to', citations: 9 }] }]
    });
    assert.equal(out.totalPapers, 2);
    assert.equal(out.departments[0].paperCount, 2);
    assert.equal(out.departments[0].papers[0].citations, 9);
});

// ---------------------------------------------------------------------------
// search.v1
// ---------------------------------------------------------------------------

test('mapSearchBody: opaque body_json returned verbatim', () => {
    const body = { results: [{ _id: 'p1', rerank_score: 0.9 }], facets: { years: [{ value: 2020 }] }, meta: { took_ms: 12, cache_hit: false } };
    assert.deepEqual(s.mapSearchBody({ body_json: JSON.stringify(body) }), body);
});

test('mapSuggest: groups + meta', () => {
    const out = s.mapSuggest({
        intent: 'author', confidence: 0.8,
        groups: {
            authors: [{ id: 'a1', scopus_id: '55', name: 'N', department: 'CS', image_url: 'http://i', score: 0.7 }],
            papers: [{ id: 'p1', title: 'T', year: 2020, lead_author: 'L', score: 0.5 }]
        },
        meta: { took_ms: 4, cache_hit: true }
    });
    assert.equal(out.groups.authors[0].scopus_id, '55');
    assert.equal(out.groups.papers[0].lead_author, 'L');
    assert.deepEqual(out.meta, { took_ms: 4, cache_hit: true });
});

test('mapIpSuggest: inventors + documents + meta', () => {
    const out = s.mapIpSuggest({
        intent: 'inventor', confidence: 0.9,
        groups: {
            inventors: [{ id: 'i1', name: 'N', is_faculty: true, kerberos: 'abc', score: 0.8 }],
            documents: [{ id: 'd1', title: 'T', year: 2021, type_of_ip: 'Patent', lead_inventor: 'L', score: 0.6 }]
        },
        meta: { took_ms: 3, cache_hit: false }
    });
    assert.equal(out.groups.inventors[0].kerberos, 'abc');
    assert.equal(out.groups.documents[0].type_of_ip, 'Patent');
    assert.deepEqual(out.meta, { took_ms: 3, cache_hit: false });
});

test('mapFacultyForQuery: top-level took_ms/cache_hit re-nested under meta', () => {
    const out = s.mapFacultyForQuery({
        departments: [{ name: 'CS', total_paper_count: 3, faculty: [{ name: 'N', author_id: '1', paper_count: 3, relevance_score: 0.9 }] }],
        total_faculty: 1, total_matching_papers: 3, took_ms: 15, cache_hit: false
    });
    assert.deepEqual(out.meta, { took_ms: 15, cache_hit: false });
    assert.equal(out.departments[0].faculty[0].author_id, '1');
    assert.equal(out.total_matching_papers, 3);
});

test('mapDocument / mapDocumentsByAuthor / mapSimilar round-trip opaque docs', () => {
    assert.deepEqual(s.mapDocument({ found: true, document_json: JSON.stringify({ _id: 'p1', title: 'T' }) }),
        { document: { _id: 'p1', title: 'T' } });

    const byAuthor = s.mapDocumentsByAuthor({
        documents_json: JSON.stringify([{ _id: 'p1' }]),
        pagination: { page: 1, per_page: 20, total: 1, total_pages: 1 }
    });
    assert.deepEqual(byAuthor.pagination, { page: 1, per_page: 20, total: 1, total_pages: 1 });
    assert.equal(byAuthor.documents[0]._id, 'p1');

    const similar = s.mapSimilar({
        found: true, source_id: 'p1', source_title: 'T', source_subject_areas: ['AI'],
        similar_json: JSON.stringify([{ _id: 'p2', similarity_score: 0.8 }])
    });
    assert.deepEqual(similar.source, { id: 'p1', title: 'T', subject_areas: ['AI'] });
    assert.equal(similar.similar[0].similarity_score, 0.8);
});

test('mapCollaborators', () => {
    assert.deepEqual(s.mapCollaborators({
        author_id: 'a1', total_papers: 30,
        collaborators: [{ author_id: 'a2', collaboration_count: 5, name: 'Co' }]
    }), {
        author_id: 'a1', total_papers: 30,
        collaborators: [{ author_id: 'a2', collaboration_count: 5, name: 'Co' }]
    });
});

test('taxonomy mappers: nodes + nullable paper fields', () => {
    assert.deepEqual(s.mapTaxDepartments({ departments: [{ id: 'd', name: 'CS', code: 'CSE' }], meta: { took_ms: 1, cache_hit: false } }),
        { departments: [{ id: 'd', name: 'CS', code: 'CSE' }], meta: { took_ms: 1, cache_hit: false } });

    const domains = s.mapDomains({ domains: [{ id: '1', name: 'AI', slug: 'ai', paper_count: 5, faculty_count: 2, subdomain_count: 3 }], meta: {} });
    assert.equal(domains.domains[0].subdomain_count, 3);

    const papers = s.mapTaxonomyFacultyPapers({
        results: [{ id: 'p', title: 'T', abstract: 'A', citation_count: 2, topics: [] }],
        pagination: { page: 1, per_page: 20, total: 1, total_pages: 1 }, meta: {}
    });
    assert.equal(papers.results[0].link, null);
    assert.equal(papers.results[0].publication_year, null);
    assert.equal(papers.results[0].document_type, null);
});

// ---------------------------------------------------------------------------
// envelopes + status mapping
// ---------------------------------------------------------------------------

test('successEnvelope shape', () => {
    const env = successEnvelope({ a: 1 }, 'ok');
    assert.equal(env.success, true);
    assert.equal(env.message, 'ok');
    assert.deepEqual(env.data, { a: 1 });
    assert.match(env.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('parseJsonField handles empty/absent', () => {
    assert.equal(parseJsonField(''), null);
    assert.equal(parseJsonField(undefined), null);
    assert.deepEqual(parseJsonField('{"x":1}'), { x: 1 });
});

test('isAbsent semantics', () => {
    assert.equal(isAbsent(''), true);
    assert.equal(isAbsent(undefined), true);
    assert.equal(isAbsent(null), true);
    assert.equal(isAbsent(0), false);
    assert.equal(isAbsent('x'), false);
});

test('grpcToHttpStatus mapping', () => {
    assert.equal(grpcToHttpStatus(5), 404);  // NOT_FOUND
    assert.equal(grpcToHttpStatus(3), 400);  // INVALID_ARGUMENT
    assert.equal(grpcToHttpStatus(16), 401); // UNAUTHENTICATED
    assert.equal(grpcToHttpStatus(7), 403);  // PERMISSION_DENIED
    assert.equal(grpcToHttpStatus(8), 429);  // RESOURCE_EXHAUSTED
    assert.equal(grpcToHttpStatus(14), 503); // UNAVAILABLE
    assert.equal(grpcToHttpStatus(4), 504);  // DEADLINE_EXCEEDED
    assert.equal(grpcToHttpStatus(13), 500); // INTERNAL
});
