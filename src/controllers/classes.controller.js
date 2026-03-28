import { query } from '../config/db.js';

// ─── CLASSES ─────────────────────────────────────────────────
export async function listClasses(req, res) {
  const adminId = req.user.admin_id || req.user.id;
  const classes = await query(
    `SELECT c.*, COUNT(DISTINCT b.id) as batch_count FROM classes c
     LEFT JOIN batches b ON b.class_id = c.id
     WHERE c.admin_id=? GROUP BY c.id ORDER BY c.created_at DESC`,
    [adminId]
  );
  res.json({ success: true, data: classes });
}

export async function getClass(req, res) {
  const adminId = req.user.admin_id || req.user.id;
  const { id } = req.params;

  const cls = await query(`SELECT * FROM classes WHERE id=? AND admin_id=?`, [id, adminId]);
  if (!cls[0]) return res.status(404).json({ success: false, message: 'Class not found' });

  const batches = await query(`SELECT * FROM batches WHERE class_id=? ORDER BY name`, [id]);
  res.json({ success: true, data: { ...cls[0], batches } });
}

export async function createClass(req, res) {
  const adminId = req.user.id;
  const { name, subjects, description } = req.body;
  const result = await query(`INSERT INTO classes (admin_id, name, subjects, description) VALUES (?,?,?,?)`,
    [adminId, name, subjects||null, description||null]);
  const id = result.insertId;
  res.status(201).json({ success: true, message: 'Class created', data: { id, name } });
}

export async function updateClass(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;
  const { name, subjects, description } = req.body;
  await query(`UPDATE classes SET name=COALESCE(?,name), subjects=COALESCE(?,subjects), description=COALESCE(?,description) WHERE id=? AND admin_id=?`,
    [name, subjects, description, id, adminId]);
  res.json({ success: true, message: 'Class updated' });
}

export async function deleteClass(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;
  await query(`DELETE FROM classes WHERE id=? AND admin_id=?`, [id, adminId]);
  res.json({ success: true, message: 'Class deleted' });
}

// ─── BATCHES ─────────────────────────────────────────────────
export async function listBatches(req, res) {
  const adminId = req.user.admin_id || req.user.id;
  const { class_id } = req.query;

  let sql = `SELECT b.*, c.name as class_name,
    COUNT(DISTINCT bs.student_id) as student_count,
    COUNT(DISTINCT bt.teacher_id) as teacher_count
    FROM batches b
    JOIN classes c ON c.id = b.class_id
    LEFT JOIN batch_students bs ON bs.batch_id = b.id
    LEFT JOIN batch_teachers bt ON bt.batch_id = b.id
    WHERE b.admin_id=?`;
  const params = [adminId];

  if (class_id) { sql += ` AND b.class_id=?`; params.push(class_id); }
  sql += ` GROUP BY b.id ORDER BY b.created_at DESC`;

  const batches = await query(sql, params);
  res.json({ success: true, data: batches });
}

export async function getBatch(req, res) {
  const adminId = req.user.admin_id || req.user.id;
  const { id } = req.params;

  const rows = await query(
    `SELECT b.*, c.name as class_name FROM batches b JOIN classes c ON c.id=b.class_id WHERE b.id=? AND b.admin_id=?`,
    [id, adminId]
  );
  if (!rows[0]) return res.status(404).json({ success: false, message: 'Batch not found' });

  const [students, teachers, materials] = await Promise.all([
    query(`SELECT s.id, s.name, s.email, s.phone, s.photo, s.status, s.roll_number FROM students s JOIN batch_students bs ON bs.student_id=s.id WHERE bs.batch_id=?`, [id]),
    query(`SELECT t.id, t.name, t.email, t.subject, t.photo, t.status FROM teachers t JOIN batch_teachers bt ON bt.teacher_id=t.id WHERE bt.batch_id=?`, [id]),
    query(`SELECT * FROM study_materials WHERE batch_id=? ORDER BY created_at DESC`, [id]),
  ]);

  res.json({ success: true, data: { ...rows[0], students, teachers, materials } });
}

export async function createBatch(req, res) {
  const adminId = req.user.id;
  const { class_id, name, start_time, end_time, days_of_week, max_students, fees_amount, fees_frequency, description } = req.body;

  const cls = await query(`SELECT id FROM classes WHERE id=? AND admin_id=?`, [class_id, adminId]);
  if (!cls.length) return res.status(404).json({ success: false, message: 'Class not found' });

  const result = await query(
    `INSERT INTO batches (admin_id, class_id, name, start_time, end_time, days_of_week, max_students, fees_amount, fees_frequency, description)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [adminId, class_id, name, start_time||null, end_time||null, days_of_week||null, max_students||50, fees_amount||0, fees_frequency||'monthly', description||null]
  );
  const id = result.insertId;
  res.status(201).json({ success: true, message: 'Batch created', data: { id, name } });
}

export async function updateBatch(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;
  const { name, start_time, end_time, days_of_week, max_students, fees_amount, fees_frequency, description, is_active } = req.body;

  // Convert empty strings / undefined to null so COALESCE keeps existing value
  const toNull = v => (v === undefined || v === '') ? null : v;

  await query(
    `UPDATE batches SET name=COALESCE(?,name), start_time=COALESCE(?,start_time), end_time=COALESCE(?,end_time),
     days_of_week=COALESCE(?,days_of_week), max_students=COALESCE(?,max_students), fees_amount=COALESCE(?,fees_amount),
     fees_frequency=COALESCE(?,fees_frequency), description=COALESCE(?,description), is_active=COALESCE(?,is_active) WHERE id=? AND admin_id=?`,
    [toNull(name), toNull(start_time), toNull(end_time), toNull(days_of_week), toNull(max_students), toNull(fees_amount), toNull(fees_frequency), toNull(description), toNull(is_active), id, adminId]
  );

  res.json({ success: true, message: 'Batch updated' });
}

export async function deleteBatch(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;
  await query(`DELETE FROM batches WHERE id=? AND admin_id=?`, [id, adminId]);
  res.json({ success: true, message: 'Batch deleted' });
}

// ─── ASSIGN / REMOVE FROM BATCH ───────────────────────────────
export async function assignStudentToBatch(req, res) {
  const adminId = req.user.id;
  const { batch_id, student_id } = req.body;

  // Verify ownership
  const batch = await query(`SELECT id, max_students FROM batches WHERE id=? AND admin_id=?`, [batch_id, adminId]);
  if (!batch.length) return res.status(404).json({ success: false, message: 'Batch not found' });

  const student = await query(`SELECT id FROM students WHERE id=? AND admin_id=?`, [student_id, adminId]);
  if (!student.length) return res.status(404).json({ success: false, message: 'Student not found' });

  const [{ cnt }] = await query(`SELECT COUNT(*) as cnt FROM batch_students WHERE batch_id=?`, [batch_id]);
  if (cnt >= batch[0].max_students) {
    return res.status(400).json({ success: false, message: 'Batch is full' });
  }

  await query(`INSERT IGNORE INTO batch_students (batch_id, student_id) VALUES (?,?)`, [batch_id, student_id]);
  res.json({ success: true, message: 'Student assigned to batch' });
}

export async function removeStudentFromBatch(req, res) {
  const { batch_id, student_id } = req.body;
  await query(`DELETE FROM batch_students WHERE batch_id=? AND student_id=?`, [batch_id, student_id]);
  res.json({ success: true, message: 'Student removed from batch' });
}

export async function assignTeacherToBatch(req, res) {
  const adminId = req.user.id;
  const { batch_id, teacher_id } = req.body;

  const batch = await query(`SELECT id FROM batches WHERE id=? AND admin_id=?`, [batch_id, adminId]);
  if (!batch.length) return res.status(404).json({ success: false, message: 'Batch not found' });

  await query(`INSERT IGNORE INTO batch_teachers (batch_id, teacher_id) VALUES (?,?)`, [batch_id, teacher_id]);
  res.json({ success: true, message: 'Teacher assigned to batch' });
}

export async function removeTeacherFromBatch(req, res) {
  const { batch_id, teacher_id } = req.body;
  await query(`DELETE FROM batch_teachers WHERE batch_id=? AND teacher_id=?`, [batch_id, teacher_id]);
  res.json({ success: true, message: 'Teacher removed from batch' });
}
