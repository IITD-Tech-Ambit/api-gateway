import { Router } from 'express';

import directoryRoutes from './directory.js';
import kgRoutes from './kg.js';
import contentRoutes from './content.js';
import userRoutes from './user.js';
import suggestionsRoutes from './suggestions.js';

/**
 * Directory/KG/CMS surface (/api/*), served over directory.v1 gRPC through
 * Envoy. /api/auth/* is NOT handled here (it stays an HTTP proxy in proxy.js).
 *
 * @param {{ clients: object }} deps
 */
export default function apiRoutes({ clients }) {
    const router = Router();
    const deadline = clients.deadlines.directory;

    router.use('/api/directory', directoryRoutes({
        directory: clients.directory,
        deadline
    }));
    router.use('/api/kg', kgRoutes({
        knowledgeGraph: clients.knowledgeGraph,
        deadline,
        atlasDeadline: clients.deadlines.atlas
    }));
    router.use('/api/content', contentRoutes({
        content: clients.content,
        deadline
    }));
    router.use('/api/user', userRoutes({
        user: clients.user,
        deadline
    }));
    router.use('/api/suggestions', suggestionsRoutes({
        suggestion: clients.suggestion,
        deadline
    }));

    return router;
}
