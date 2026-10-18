import multer from 'multer';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});
