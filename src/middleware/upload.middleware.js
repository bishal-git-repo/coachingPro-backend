import multer from 'multer';
import multerS3 from 'multer-s3';
import { S3Client } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

// ─── S3 Client Setup ─────────────────────────────────────────
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Two separate S3 buckets — one for PDFs, one for Videos
export const PDF_BUCKET   = process.env.AWS_S3_PDF_BUCKET;
export const VIDEO_BUCKET = process.env.AWS_S3_VIDEO_BUCKET;

// Determine which bucket based on file type
function getBucket(file) {
  if (file.mimetype === 'application/pdf') return PDF_BUCKET;
  if (file.mimetype.startsWith('video/'))  return VIDEO_BUCKET;
  return PDF_BUCKET; // fallback for images/misc
}

// ─── File Filter ─────────────────────────────────────────────
function fileFilter(req, file, cb) {
  const allowed = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf',
    'video/mp4', 'video/webm', 'video/ogg',
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} not allowed`), false);
  }
}

// ─── S3 Storage ──────────────────────────────────────────────
const s3Storage = multerS3({
  s3,
  bucket: (req, file, cb) => cb(null, getBucket(file)),
  contentType: multerS3.AUTO_CONTENT_TYPE,
  key: (req, file, cb) => {
    const ext    = path.extname(file.originalname).toLowerCase();
    const folder = file.mimetype.startsWith('video/') ? 'videos' : 'pdfs';
    cb(null, `${folder}/${uuidv4()}${ext}`);
  },
});

const MAX_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '500') * 1024 * 1024;

export const upload = multer({
  storage: s3Storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE },
});

export const uploadPhoto    = upload.single('photo');
export const uploadMaterial = upload.single('file');
export const uploadLogo     = upload.single('logo');

// Export s3 client so controllers can delete/presign
export { s3 };
