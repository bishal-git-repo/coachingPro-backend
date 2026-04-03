import { query } from '../config/db.js';
import { s3, PDF_BUCKET, VIDEO_BUCKET } from '../middleware/upload.middleware.js';
import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ─── Free Plan Limits ─────────────────────────────────────────
const FREE_PDF_LIMIT   = 15;
const FREE_VIDEO_LIMIT = 5;

// Get bucket name from file_type
function getBucketForType(fileType) {
  return fileType === 'video' ? VIDEO_BUCKET : PDF_BUCKET;
}

// ─── List Materials ───────────────────────────────────────────
export async function listMaterials(req, res) {
  const adminId = req.user.admin_id || req.user.id;
  const { batch_id, class_id, file_type } = req.query;

  let sql = `SELECT sm.*, b.name as batch_name, c.name as class_name
    FROM study_materials sm
    LEFT JOIN batches b ON b.id = sm.batch_id
    LEFT JOIN classes c ON c.id = COALESCE(sm.class_id, b.class_id)
    WHERE sm.admin_id=? AND sm.is_active=1`;
  const params = [adminId];

  if (batch_id) { sql += ` AND sm.batch_id=?`;                      params.push(batch_id); }
  if (class_id) { sql += ` AND (sm.class_id=? OR b.class_id=?)`;    params.push(class_id, class_id); }
  if (file_type){ sql += ` AND sm.file_type=?`;                      params.push(file_type); }

  sql += ` ORDER BY sm.created_at DESC`;

  const materials = await query(sql, params);
  res.json({ success: true, data: materials });
}

// ─── Get Single Material ──────────────────────────────────────
export async function getMaterial(req, res) {
  const { id }    = req.params;
  const adminId   = req.user.admin_id || req.user.id;

  const rows = await query(
    `SELECT * FROM study_materials WHERE id=? AND admin_id=?`,
    [id, adminId]
  );
  if (!rows[0]) return res.status(404).json({ success: false, message: 'Material not found' });

  res.json({ success: true, data: rows[0] });
}

// ─── Upload Material ──────────────────────────────────────────
export async function uploadMaterial(req, res) {
  const adminId    = req.user.admin_id || req.user.id;
  const uploaderId = req.user.id;

  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

  // S3 multer puts these on req.file
  const { key, bucket, size, mimetype, originalname, location } = req.file;

  // Determine file type
  let fileType = 'other';
  if (mimetype === 'application/pdf')    fileType = 'pdf';
  else if (mimetype.startsWith('video/')) fileType = 'video';
  else if (mimetype.startsWith('image/')) fileType = 'image';

  // ─── Free Plan Limit Check ───────────────────────────────────
  // Check AFTER upload so we have the file type; delete from S3 if over limit
  if (req.user.plan !== 'paid' && req.user.role === 'admin') {
    if (fileType === 'pdf') {
      const [{ cnt }] = await query(
        `SELECT COUNT(*) as cnt FROM study_materials WHERE admin_id=? AND file_type='pdf' AND is_active=1`,
        [adminId]
      );
      if (cnt >= FREE_PDF_LIMIT) {
        // Delete the just-uploaded file from S3 to avoid orphans
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        return res.status(402).json({
          success: false,
          message: `Free plan limit: ${FREE_PDF_LIMIT} PDFs. Upgrade to Paid Plan to upload more.`,
          code: 'LIMIT_REACHED',
        });
      }
    } else if (fileType === 'video') {
      const [{ cnt }] = await query(
        `SELECT COUNT(*) as cnt FROM study_materials WHERE admin_id=? AND file_type='video' AND is_active=1`,
        [adminId]
      );
      if (cnt >= FREE_VIDEO_LIMIT) {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        return res.status(402).json({
          success: false,
          message: `Free plan limit: ${FREE_VIDEO_LIMIT} videos. Upgrade to Paid Plan to upload more.`,
          code: 'LIMIT_REACHED',
        });
      }
    }
  }

  const { title, description, batch_id, class_id } = req.body;

  // Verify teacher is assigned to this batch
  if (req.user.role === 'teacher' && batch_id) {
    const assigned = await query(
      `SELECT bt.batch_id FROM batch_teachers bt WHERE bt.batch_id=? AND bt.teacher_id=?`,
      [batch_id, uploaderId]
    );
    if (!assigned.length) {
      // Clean up S3 file
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      return res.status(403).json({ success: false, message: 'You are not assigned to this batch' });
    }
  }

  // Save S3 key in file_path so we can look it up for delete/stream
  const result = await query(
    `INSERT INTO study_materials
       (admin_id, batch_id, class_id, title, description, file_type, file_path, file_size, file_name, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [adminId, batch_id||null, class_id||null, title, description||null, fileType, key, size, originalname, uploaderId]
  );

  res.status(201).json({
    success: true,
    message: 'Material uploaded to S3',
    data: {
      id:        result.insertId,
      title,
      file_type: fileType,
      file_name: originalname,
      s3_url:    location,  // public or pre-signed — useful for immediate preview
    },
  });
}

// ─── Delete Material ──────────────────────────────────────────
export async function deleteMaterial(req, res) {
  const adminId = req.user.admin_id || req.user.id;
  const { id }  = req.params;

  const rows = await query(
    `SELECT file_path, file_type FROM study_materials WHERE id=? AND admin_id=?`,
    [id, adminId]
  );
  if (!rows[0]) return res.status(404).json({ success: false, message: 'Material not found' });

  const { file_path: s3Key, file_type } = rows[0];
  const bucket = getBucketForType(file_type);

  // Delete from S3
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: s3Key }));
  } catch (e) {
    console.error('S3 delete error:', e.message);
    // Still proceed to delete from DB even if S3 fails
  }

  await query(`DELETE FROM study_materials WHERE id=?`, [id]);
  res.json({ success: true, message: 'Material deleted' });
}

// ─── Serve / Stream File (via S3 Pre-signed URL) ──────────────
// Instead of piping through the server, we generate a short-lived
// pre-signed URL and redirect the client directly to S3.
// This saves EC2 bandwidth and is much faster for videos.
export async function serveFile(req, res) {
  const { id }    = req.params;

  const rows = await query(
    `SELECT sm.* FROM study_materials sm WHERE sm.id=?`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ success: false, message: 'File not found' });

  const { file_path: s3Key, file_type, file_name } = rows[0];
  const bucket = getBucketForType(file_type);

  const contentTypes = {
    pdf:   'application/pdf',
    video: 'video/mp4',
    image: 'image/jpeg',
  };

  // Pre-signed URL valid for 1 hour (3600 seconds)
  const command = new GetObjectCommand({
    Bucket:                     bucket,
    Key:                        s3Key,
    ResponseContentType:        contentTypes[file_type] || 'application/octet-stream',
    ResponseContentDisposition: `inline; filename="${file_name}"`,
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

  // Redirect client directly to S3 — no server-side streaming needed
  // res.redirect(302, signedUrl);
  res.json({ success: true, url: signedUrl });
}
