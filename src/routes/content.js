import express, { Router } from 'express';
import multer from 'multer';

import { sendSuccess, sendDirectoryError } from '../transcode/envelopes.js';
import * as d from '../transcode/directory.js';
import { createUnaryBridge } from './grpcBridge.js';

// In-memory multipart parsing: the gateway re-packs uploaded files as gRPC
// FileUpload bytes, so it never touches disk.
const upload = multer({ storage: multer.memoryStorage() });
const json = express.json();
const toInt = (v) => Number.parseInt(v, 10) || 0;
const fileUpload = (file) =>
    file ? { filename: file.originalname, content_type: file.mimetype, data: file.buffer } : undefined;

/**
 * @param {{ content: object, deadline: number }} deps
 */
export default function contentRoutes({ content, deadline }) {
    const router = Router({ mergeParams: true });
    const { call, ok } = createUnaryBridge({
        clients: { content },
        onError: sendDirectoryError,
        defaultDeadline: deadline
    });

    router.get('/', (req, res) => call(req, res, {
        client: 'content', method: 'ListContent', request: {},
        finish: ok(d.mapJsonData, 'Content fetched successfully')
    }));

    router.get('/paginated', (req, res) => {
        const request = { page: toInt(req.query.page), limit: toInt(req.query.limit), mine: req.query.mine === 'true' };
        if (req.query.status) request.status = String(req.query.status);
        return call(req, res, {
            client: 'content', method: 'ListContentPaginated', request,
            finish: ok(d.mapJsonData, 'Content fetched successfully')
        });
    });

    router.post('/', upload.single('hero_img'), (req, res) => call(req, res, {
        client: 'content', method: 'CreateContent',
        request: {
            title: req.body?.title || '',
            subtitle: req.body?.subtitle || '',
            body: req.body?.body || '',
            est_read_time: req.body?.est_read_time || '',
            hero_img: fileUpload(req.file)
        },
        finish: ok(d.mapJsonData, 'Content created successfully', 201)
    }));

    router.put('/', upload.single('hero_img'), (req, res) => call(req, res, {
        client: 'content', method: 'UpdateContent',
        request: {
            id: req.body?.id || '',
            title: req.body?.title,
            subtitle: req.body?.subtitle,
            body: req.body?.body,
            est_read_time: req.body?.est_read_time,
            hero_img: fileUpload(req.file)
        },
        finish: ok(d.mapJsonData, 'Content updated successfully')
    }));

    router.delete('/', json, (req, res) => call(req, res, {
        client: 'content', method: 'DeleteContent',
        request: { id: req.body?.id || '' },
        finish: (response, r) => sendSuccess(r, null, response.message || 'Content deleted successfully')
    }));

    router.post('/like', json, (req, res) => call(req, res, {
        client: 'content', method: 'LikeContent',
        request: { content_id: req.body?.contentId || '' },
        finish: ok(d.mapJsonData, 'Like added successfully')
    }));

    router.post('/dislike', json, (req, res) => call(req, res, {
        client: 'content', method: 'DislikeContent',
        request: { content_id: req.body?.contentId || '' },
        finish: ok(d.mapJsonData, 'Like removed successfully')
    }));

    router.post('/comment', json, (req, res) => call(req, res, {
        client: 'content', method: 'CommentContent',
        request: { content_id: req.body?.contentId || '', body: req.body?.body || '' },
        finish: ok(d.mapJsonData, 'Comment added successfully', 201)
    }));

    router.post('/uncomment', json, (req, res) => call(req, res, {
        client: 'content', method: 'UncommentContent',
        request: { content_id: req.body?.contentId || '', comment_id: req.body?.commentId || '' },
        finish: (response, r) => sendSuccess(r, null, response.message || 'Comment deleted successfully')
    }));

    router.post('/status', json, (req, res) => call(req, res, {
        client: 'content', method: 'SetContentStatus',
        request: { content_id: req.body?.contentId || '', status: req.body?.status || '' },
        finish: ok(d.mapJsonData, 'Status changed successfully')
    }));

    return router;
}
