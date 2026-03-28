import path from 'path';
import fs from 'fs';
import { query } from '../config/db.js';

export async function listMaterials(req, res) {
  const adminId = req.user.admin_id || req.user.id;
  const { batch_id, class_id, file_type } = req.query;

  let sql = `SELECT sm.*, b.name as batch_name, c.name as class_name
    FROM study_materials sm
    LEFT JOIN batches b ON b.id = sm.batch_id
    LEFT JOIN classes c ON c.id = COALESCE(sm.class_id, b.class_id)
    WHERE sm.admin_id=? AND sm.is_active=1`;
  const params = [adminId];

  if (batch_id) { sql += ` AND sm.batch_id=?`; params.push(batch_id); }
  if (class_id) { sql += ` AND (sm.class_id=? OR b.class_id=?)`; params.push(class_id, class_id); }
  if (file_type) { sql += ` AND sm.file_type=?`; params.push(file_type); }

  sql += ` ORDER BY sm.created_at DESC`;

  const materials = await query(sql, params);
  res.json({ success: true, data: materials });
}

export async function getMaterial(req, res) {
  const { id } = req.params;
  const adminId = req.user.admin_id || req.user.id;

  const rows = await query(`SELECT * FROM study_materials WHERE id=? AND admin_id=?`, [id, adminId]);
  if (!rows[0]) return res.status(404).json({ success: false, message: 'Material not found' });

  res.json({ success: true, data: rows[0] });
}

export async function uploadMaterial(req, res) {
  // For teachers, use their admin_id so materials are associated with the right admin
  const adminId = req.user.admin_id || req.user.id;
  const uploaderId = req.user.id;

  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

  const { title, description, batch_id, class_id } = req.body;
  const { filename, mimetype, size, path: filePath } = req.file;

  // Verify teacher is assigned to this batch if teacher role
  if (req.user.role === 'teacher' && batch_id) {
    const assigned = await query(
      `SELECT bt.batch_id FROM batch_teachers bt WHERE bt.batch_id=? AND bt.teacher_id=?`,
      [batch_id, uploaderId]
    );
    if (!assigned.length) return res.status(403).json({ success: false, message: 'You are not assigned to this batch' });
  }

  let fileType = 'other';
  if (mimetype === 'application/pdf') fileType = 'pdf';
  else if (mimetype.startsWith('video/')) fileType = 'video';
  else if (mimetype.startsWith('image/')) fileType = 'image';

  const relativePath = filePath.replace(process.cwd(), '');

  const result = await query(
    `INSERT INTO study_materials (admin_id, batch_id, class_id, title, description, file_type, file_path, file_size, file_name, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [adminId, batch_id||null, class_id||null, title, description||null, fileType, relativePath, size, req.file.originalname, uploaderId]
  );
  const id = result.insertId;

  res.status(201).json({
    success: true,
    message: 'Material uploaded',
    data: { id, title, file_type: fileType, file_name: req.file.originalname },
  });
}

export async function deleteMaterial(req, res) {
  const adminId = req.user.admin_id || req.user.id;
  const { id } = req.params;

  const rows = await query(`SELECT file_path FROM study_materials WHERE id=? AND admin_id=?`, [id, adminId]);
  if (!rows[0]) return res.status(404).json({ success: false, message: 'Material not found' });

  // Delete file from disk
  try {
    const fullPath = path.join(process.cwd(), rows[0].file_path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  } catch (e) {
    console.error('File delete error:', e.message);
  }

  await query(`DELETE FROM study_materials WHERE id=?`, [id]);
  res.json({ success: true, message: 'Material deleted' });
}

// Stream video/serve file
export async function serveFile(req, res) {
  const { id } = req.params;
  const adminId = req.user.admin_id || req.user.id;

  const rows = await query(
    `SELECT sm.* FROM study_materials sm WHERE sm.id=?`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ success: false, message: 'File not found' });

  const filePath = path.join(process.cwd(), rows[0].file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: 'File not on disk' });

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  if (rows[0].file_type === 'video') {
    // Range request support for video streaming
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });

      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } else {
    // PDF or other files
    const contentTypes = {
      pdf: 'application/pdf',
      image: 'image/jpeg',
    };
    res.setHeader('Content-Type', contentTypes[rows[0].file_type] || 'application/octet-stream');
    res.setHeader('Content-Length', fileSize);
    fs.createReadStream(filePath).pipe(res);
  }
}
