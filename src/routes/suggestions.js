import { Router } from 'express';
import multer from 'multer';

import { sendSuccess, sendDirectoryError } from '../transcode/envelopes.js';
import { createUnaryBridge } from './grpcBridge.js';

// In-memory multipart parsing: the gateway re-packs uploaded files as gRPC
// FileUpload bytes, so it never touches disk.
const upload = multer({ storage: multer.memoryStorage() });
const fileUpload = (file) =>
    file ? { filename: file.originalname, content_type: file.mimetype, data: file.buffer } : undefined;

/**
 * @param {{ suggestion: object, deadline: number }} deps
 */
export default function suggestionsRoutes({ suggestion, deadline }) {
    const router = Router({ mergeParams: true });
    const { call } = createUnaryBridge({
        clients: { suggestion },
        onError: sendDirectoryError,
        defaultDeadline: deadline
    });

    router.post('/', upload.single('screenshot'), (req, res) => call(req, res, {
        client: 'suggestion', method: 'CreateSuggestion',
        request: {
            category: req.body?.category || '',
            message: req.body?.message || '',
            email: req.body?.email,
            name: req.body?.name,
            screenshot: fileUpload(req.file)
        },
        finish: (response, r) => sendSuccess(r, { id: response.id || '' }, 'Thank you! Your suggestion has been received.', 201)
    }));

    return router;
}
