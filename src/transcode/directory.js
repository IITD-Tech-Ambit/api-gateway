import {
    isAbsent,
    parseJsonField,
    assignIfPresent,
    assignOrNull
} from './envelopes.js';

// directory.v1 response mappers.
//
// The proto loader runs with keepCase:true, so message fields arrive
// snake_case (citation_count, h_index, total_pages, ...). These mappers
// reproduce the EXACT JSON the research-ambit backend returns today — key
// names, key order, and the omit-vs-null convention per field:
//   * orcId/scopusId/googleScholarId  -> OMITTED when absent (pickPrimaryIdentifier)
//   * department/profileImageUrl/designation/workingFromYear -> null when absent
// See research-ambit-main/src/domain/facultyDirectory.js for the source shapes.

export function mapDepartment(dept) {
    if (isAbsent(dept) || (isAbsent(dept.id) && isAbsent(dept.name) && isAbsent(dept.code))) {
        return null;
    }
    const out = {};
    assignIfPresent(out, '_id', dept.id);
    assignIfPresent(out, 'name', dept.name);
    assignIfPresent(out, 'code', dept.code);
    assignIfPresent(out, 'category', dept.category);
    return out;
}

export function mapFacultyCard(card) {
    return {
        _id: card.id,
        name: card.name,
        email: card.email,
        citationCount: card.citation_count ?? 0,
        hIndex: card.h_index ?? 0,
        research_areas: card.research_areas ?? [],
        department: mapDepartment(card.department),
        profileImageUrl: isAbsent(card.profile_image_url) ? null : card.profile_image_url,
        designation: isAbsent(card.designation) ? null : card.designation
    };
}

export function mapFaculty(faculty) {
    if (isAbsent(faculty)) return null;
    const out = {
        _id: faculty.id,
        name: faculty.name,
        email: faculty.email,
        citationCount: faculty.citation_count ?? 0,
        hIndex: faculty.h_index ?? 0,
        research_areas: faculty.research_areas ?? []
    };
    // Present-only identifiers (position after research_areas matches source).
    assignIfPresent(out, 'orcId', faculty.orc_id);
    assignIfPresent(out, 'scopusId', faculty.scopus_id);
    assignIfPresent(out, 'googleScholarId', faculty.google_scholar_id);
    out.department = mapDepartment(faculty.department);
    out.tags = faculty.tags ?? [];
    assignOrNull(out, 'profileImageUrl', faculty.profile_image_url);
    assignOrNull(out, 'designation', faculty.designation);
    out.workingFromYear = isAbsent(faculty.working_from_year) ? null : faculty.working_from_year;
    return out;
}

export function mapPagination(p) {
    return {
        page: p.page ?? 0,
        limit: p.limit ?? 0,
        total: p.total ?? 0,
        totalPages: p.total_pages ?? 0,
        hasNext: Boolean(p.has_next),
        hasPrev: Boolean(p.has_prev)
    };
}

export function mapListFaculty(msg) {
    return {
        data: (msg.data ?? []).map(mapFacultyCard),
        pagination: mapPagination(msg.pagination ?? {})
    };
}

export function mapSearchDirectory(msg) {
    return {
        faculties: (msg.faculties ?? []).map(mapFaculty),
        departments: (msg.departments ?? []).map(mapDepartment),
        total: msg.total ?? 0
    };
}

function mapGroupedStats(stats) {
    const out = { totalFaculty: stats?.total_faculty ?? 0 };
    if (!isAbsent(stats?.avg_h_index)) out.avgHIndex = stats.avg_h_index;
    return out;
}

export function mapGrouped(msg, { summaryOnly = false } = {}) {
    return {
        departments: (msg.departments ?? []).map((d) => {
            const dept = {
                _id: d.id,
                department: mapDepartment(d.department) ?? {},
                stats: mapGroupedStats(d.stats)
            };
            // Full mode carries faculty cards; summary mode omits the key.
            if (!summaryOnly) dept.faculties = (d.faculties ?? []).map(mapFacultyCard);
            return dept;
        }),
        totalDepartments: msg.total_departments ?? 0,
        totalFaculty: msg.total_faculty ?? 0
    };
}

export function mapDepartmentFaculties(msg) {
    return { faculties: (msg.faculties ?? []).map(mapFacultyCard) };
}

export function mapFacultyMatches(msg) {
    const matches = {};
    for (const [key, faculty] of Object.entries(msg.matches ?? {})) {
        matches[key] = mapFaculty(faculty);
    }
    return { matches };
}

export function mapKgHealth(msg) {
    return {
        graphsReady: Boolean(msg.graphs_ready),
        exploreReady: Boolean(msg.explore_ready),
        atlasReady: Boolean(msg.atlas_ready),
        atlasCount: msg.atlas_count ?? 0,
        dataDir: msg.data_dir ?? '',
        redisConnected: Boolean(msg.redis_connected),
        cacheTtlSeconds: msg.cache_ttl_seconds ?? 0
    };
}

export function mapPaperMeta(msg) {
    return {
        link: msg.link ?? '',
        document_scopus_id: msg.document_scopus_id ?? '',
        document_eid: msg.document_eid ?? '',
        title: msg.title ?? '',
        abstract: msg.abstract ?? '',
        publication_year: isAbsent(msg.publication_year) ? null : msg.publication_year,
        citation_count: msg.citation_count ?? 0,
        reference_count: msg.reference_count ?? 0,
        document_type: msg.document_type ?? '',
        field_associated: msg.field_associated ?? '',
        subject_area: msg.subject_area ?? [],
        authors: (msg.authors ?? []).map((a) => ({
            name: a.name ?? '',
            author_id: a.author_id ?? '',
            position: a.position ?? ''
        })),
        iitd_faculty: (msg.iitd_faculty ?? []).map((f) => ({
            facultyId: f.faculty_id ?? '',
            name: f.name ?? '',
            department: f.department ?? '',
            kerberos: f.kerberos ?? ''
        }))
    };
}

export function mapAtlasIndices(msg) {
    return {
        query: msg.query ?? '',
        matchCount: msg.match_count ?? 0,
        indices: msg.indices ?? []
    };
}

export function mapAtlasFacultyIndices(msg) {
    return {
        facultyIds: msg.faculty_ids ?? [],
        matchCount: msg.match_count ?? 0,
        indices: msg.indices ?? []
    };
}

export function mapAtlasFacultySearch(msg) {
    return {
        query: msg.query ?? '',
        matches: (msg.matches ?? []).map((m) => ({
            facultyId: m.faculty_id ?? '',
            name: m.name ?? '',
            department: m.department ?? '',
            paperCount: m.paper_count ?? 0,
            atlasCount: m.atlas_count ?? 0
        })),
        matchCount: msg.match_count ?? 0,
        indices: msg.indices ?? []
    };
}

export function mapAtlasDepartmentIndices(msg) {
    return {
        departments: msg.departments ?? [],
        matchCount: msg.match_count ?? 0,
        indices: msg.indices ?? []
    };
}

export function mapAtlasDepartmentSearch(msg) {
    return {
        query: msg.query ?? '',
        matches: (msg.matches ?? []).map((m) => ({
            department: m.department ?? '',
            facultyCount: m.faculty_count ?? 0,
            atlasCount: m.atlas_count ?? 0
        })),
        matchCount: msg.match_count ?? 0,
        indices: msg.indices ?? []
    };
}

export function mapAtlasClusterBreakdown(msg) {
    return {
        theme: msg.theme ?? '',
        query: msg.query ?? '',
        totalPapers: msg.total_papers ?? 0,
        departments: (msg.departments ?? []).map((d) => ({
            department: d.department ?? '',
            paperCount: d.paper_count ?? 0,
            papers: (d.papers ?? []).map((p) => ({
                id: p.id ?? '',
                i: p.i ?? 0,
                title: p.title ?? '',
                domain: p.domain ?? '',
                topic: p.topic ?? '',
                citations: p.citations ?? 0
            }))
        }))
    };
}

// Opaque `*_json` payloads: JSON.parse back to the original nested shape.
export function mapJsonData(msg) {
    return parseJsonField(msg.data_json);
}
