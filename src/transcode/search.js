import { isAbsent, parseJsonField } from './envelopes.js';

// search.v1 response mappers.
//
// The search-api serialises its REST responses with snake_case keys (Fastify
// response schemas in opensearch/src/schemas/*.js), which match the proto
// field names 1:1 under keepCase — so most of the work is re-nesting the
// flattened `took_ms`/`cache_hit` back under `meta`, and JSON.parsing the
// opaque `*_json` document payloads. search.v1 responses are NOT enveloped;
// the frontend consumes the body directly.

function mapMeta(meta) {
    return {
        took_ms: meta?.took_ms ?? 0,
        cache_hit: Boolean(meta?.cache_hit)
    };
}

// POST /search and /search/author-scope: whole body is opaque (raw hydrated
// docs, polymorphic facets). meta is already inside body_json.
export function mapSearchBody(msg) {
    return parseJsonField(msg.body_json);
}

export function mapSuggest(msg) {
    const groups = msg.groups ?? {};
    return {
        intent: msg.intent ?? 'mixed',
        confidence: msg.confidence ?? 0,
        groups: {
            authors: (groups.authors ?? []).map((a) => ({
                id: a.id ?? '',
                scopus_id: a.scopus_id ?? '',
                name: a.name ?? '',
                department: a.department ?? '',
                image_url: a.image_url ?? '',
                score: a.score ?? 0
            })),
            papers: (groups.papers ?? []).map((p) => ({
                id: p.id ?? '',
                title: p.title ?? '',
                year: p.year ?? 0,
                lead_author: p.lead_author ?? '',
                score: p.score ?? 0
            }))
        },
        meta: mapMeta(msg.meta)
    };
}

// FacultyForQuery carries took_ms/cache_hit at the top level over the wire;
// the REST body nests them under `meta`.
export function mapFacultyForQuery(msg) {
    return {
        departments: (msg.departments ?? []).map((d) => ({
            name: d.name ?? '',
            faculty: (d.faculty ?? []).map((f) => ({
                name: f.name ?? '',
                author_id: f.author_id ?? '',
                paper_count: f.paper_count ?? 0,
                relevance_score: f.relevance_score ?? 0
            })),
            total_paper_count: d.total_paper_count ?? 0
        })),
        total_faculty: msg.total_faculty ?? 0,
        total_matching_papers: msg.total_matching_papers ?? 0,
        meta: {
            took_ms: msg.took_ms ?? 0,
            cache_hit: Boolean(msg.cache_hit)
        }
    };
}

// GetDocument: { document: <raw doc> }. `found` is handled by the route (404).
export function mapDocument(msg) {
    return { document: parseJsonField(msg.document_json) };
}

function mapSearchPagination(p) {
    return {
        page: p?.page ?? 0,
        per_page: p?.per_page ?? 0,
        total: p?.total ?? 0,
        total_pages: p?.total_pages ?? 0
    };
}

export function mapDocumentsByAuthor(msg) {
    return {
        documents: parseJsonField(msg.documents_json) ?? [],
        pagination: mapSearchPagination(msg.pagination)
    };
}

export function mapSimilar(msg) {
    return {
        source: {
            id: msg.source_id ?? '',
            title: msg.source_title ?? '',
            subject_areas: msg.source_subject_areas ?? []
        },
        similar: parseJsonField(msg.similar_json) ?? []
    };
}

export function mapCollaborators(msg) {
    return {
        author_id: msg.author_id ?? '',
        total_papers: msg.total_papers ?? 0,
        collaborators: (msg.collaborators ?? []).map((c) => ({
            author_id: c.author_id ?? '',
            collaboration_count: c.collaboration_count ?? 0,
            name: c.name ?? ''
        }))
    };
}

export function mapTaxDepartments(msg) {
    return {
        departments: (msg.departments ?? []).map((d) => ({
            id: d.id ?? '',
            name: d.name ?? '',
            code: d.code ?? ''
        })),
        meta: mapMeta(msg.meta)
    };
}

function mapThemeNode(n) {
    return {
        id: n.id ?? '',
        name: n.name ?? '',
        slug: n.slug ?? '',
        paper_count: n.paper_count ?? 0,
        faculty_count: n.faculty_count ?? 0
    };
}

export function mapThemes(msg) {
    return { themes: (msg.themes ?? []).map(mapThemeNode), meta: mapMeta(msg.meta) };
}

export function mapDomains(msg) {
    return {
        domains: (msg.domains ?? []).map((d) => ({
            id: d.id ?? '',
            name: d.name ?? '',
            slug: d.slug ?? '',
            paper_count: d.paper_count ?? 0,
            faculty_count: d.faculty_count ?? 0,
            subdomain_count: d.subdomain_count ?? 0
        })),
        meta: mapMeta(msg.meta)
    };
}

export function mapSubdomains(msg) {
    const domain = msg.domain ?? {};
    return {
        domain: {
            id: domain.id ?? '',
            name: domain.name ?? '',
            slug: domain.slug ?? ''
        },
        subdomains: (msg.subdomains ?? []).map(mapThemeNode),
        meta: mapMeta(msg.meta)
    };
}

export function mapCounts(msg) {
    return {
        paper_count: msg.paper_count ?? 0,
        faculty_count: msg.faculty_count ?? 0,
        meta: mapMeta(msg.meta)
    };
}

export function mapTaxonomyFaculty(msg) {
    return {
        kerberos_list: msg.kerberos_list ?? [],
        faculty_total: msg.faculty_total ?? 0,
        pagination: mapSearchPagination(msg.pagination),
        meta: mapMeta(msg.meta)
    };
}

export function mapTaxonomyFacultyPapers(msg) {
    return {
        results: (msg.results ?? []).map((p) => ({
            id: p.id ?? '',
            title: p.title ?? '',
            abstract: p.abstract ?? '',
            link: isAbsent(p.link) ? null : p.link,
            publication_year: isAbsent(p.publication_year) ? null : p.publication_year,
            document_type: isAbsent(p.document_type) ? null : p.document_type,
            citation_count: p.citation_count ?? 0,
            topics: p.topics ?? []
        })),
        pagination: mapSearchPagination(msg.pagination),
        meta: mapMeta(msg.meta)
    };
}
