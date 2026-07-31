import express, { Router } from 'express';
import multer from 'multer';

import { sendSuccess, sendDirectoryError } from '../transcode/envelopes.js';
import * as d from '../transcode/directory.js';
import { createUnaryBridge } from './grpcBridge.js';

// In-memory multipart parsing: the gateway re-packs uploaded files as gRPC
// FileUpload bytes, so it never touches disk.
const upload = multer({ storage: multer.memoryStorage() });
const json = express.json();
const fileUpload = (file) =>
    file ? { filename: file.originalname, content_type: file.mimetype, data: file.buffer } : undefined;

/**
 * @param {{ user: object, deadline: number }} deps
 */
export default function userRoutes({ user, deadline }) {
    const router = Router({ mergeParams: true });
    const { call, ok } = createUnaryBridge({
        clients: { user },
        onError: sendDirectoryError,
        defaultDeadline: deadline
    });

    router.post('/register', upload.single('profile_img'), (req, res) => call(req, res, {
        client: 'user', method: 'Register',
        request: {
            name: req.body?.name || '',
            email: req.body?.email || '',
            password: req.body?.password || '',
            role: req.body?.role,
            profile_img: fileUpload(req.file),
            profile_img_url: req.body?.profile_img
        },
        finish: ok(d.mapJsonData, 'User created successfully', 201)
    }));

    router.post('/login', json, (req, res) => call(req, res, {
        client: 'user', method: 'Login',
        request: { email: req.body?.email || '', password: req.body?.password || '' },
        finish: (response, r) => sendSuccess(r, { token: response.token || '' }, 'Login successful')
    }));

    router.put('/edit', upload.single('profile_img'), (req, res) => call(req, res, {
        client: 'user', method: 'EditUser',
        request: {
            name: req.body?.name,
            password: req.body?.password,
            profile_img: fileUpload(req.file),
            profile_img_url: req.body?.profile_img
        },
        finish: ok(d.mapJsonData, 'User updated successfully')
    }));

    router.delete('/delete', json, (req, res) => call(req, res, {
        client: 'user', method: 'DeleteUser',
        request: { email: req.body?.email || '' },
        finish: ok(d.mapJsonData, 'User deleted successfully')
    }));

    return router;
}
