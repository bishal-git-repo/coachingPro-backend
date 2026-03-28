import { query } from '../config/db.js';

// ─── SCHEDULED CLASSES ────────────────────────────────────────
export async function listScheduledClasses(req, res) {
  const adminId = req.user.admin_id || req.user.id;
  const { batch_id, date_from, date_to, status } = req.query;

  let sql = `SELECT sc.*, b.name as batch_name, b.class_id,
    c.name as class_name, t.name as teacher_name
    FROM scheduled_classes sc
    JOIN batches b ON b.id = sc.batch_id
    JOIN classes c ON c.id = b.class_id
    LEFT JOIN teachers t ON t.id = sc.teacher_id
    WHERE sc.admin_id=?`;
  const params = [adminId];

  if (batch_id) { sql += ' AND sc.batch_id=?'; params.push(batch_id); }
  if (date_from) { sql += ' AND sc.scheduled_date >= ?'; params.push(date_from); }
  if (date_to)   { sql += ' AND sc.scheduled_date <= ?'; params.push(date_to); }
  if (status)    { sql += ' AND sc.status=?'; params.push(status); }
  sql += ' ORDER BY sc.scheduled_date DESC, sc.start_time DESC';

  const classes = await query(sql, params);
  res.json({ success: true, data: classes });
}

export async function createScheduledClass(req, res) {
  const adminId = req.user.id;
  const { batch_id, teacher_id, title, description, scheduled_date, start_time, end_time, meeting_link } = req.body;

  const batch = await query('SELECT id FROM batches WHERE id=? AND admin_id=?', [batch_id, adminId]);
  if (!batch.length) return res.status(404).json({ success: false, message: 'Batch not found' });

  const result = await query(
    'INSERT INTO scheduled_classes (admin_id, batch_id, teacher_id, title, description, scheduled_date, start_time, end_time, meeting_link) VALUES (?,?,?,?,?,?,?,?,?)',
    [adminId, batch_id, teacher_id || null, title || null, description || null, scheduled_date, start_time, end_time, meeting_link || null]
  );

  res.status(201).json({ success: true, message: 'Class scheduled', data: { id: result.insertId } });
}

export async function updateScheduledClass(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;
  const { title, description, scheduled_date, start_time, end_time, status, meeting_link, notes, teacher_id } = req.body;

  await query(
    'UPDATE scheduled_classes SET title=COALESCE(?,title), description=COALESCE(?,description), scheduled_date=COALESCE(?,scheduled_date), start_time=COALESCE(?,start_time), end_time=COALESCE(?,end_time), status=COALESCE(?,status), meeting_link=COALESCE(?,meeting_link), notes=COALESCE(?,notes), teacher_id=COALESCE(?,teacher_id) WHERE id=? AND admin_id=?',
    [title, description, scheduled_date, start_time, end_time, status, meeting_link, notes, teacher_id, id, adminId]
  );

  res.json({ success: true, message: 'Scheduled class updated' });
}

export async function deleteScheduledClass(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;
  await query('DELETE FROM scheduled_classes WHERE id=? AND admin_id=?', [id, adminId]);
  res.json({ success: true, message: 'Scheduled class removed' });
}

// ─── ATTENDANCE SHEET ─────────────────────────────────────────
export async function getAttendanceSheet(req, res) {
  const { class_id } = req.params;

  const sc = await query(
    'SELECT sc.*, b.id as batch_id FROM scheduled_classes sc JOIN batches b ON b.id=sc.batch_id WHERE sc.id=?',
    [class_id]
  );
  if (!sc[0]) return res.status(404).json({ success: false, message: 'Scheduled class not found' });

  const students = await query(
    'SELECT s.id as student_id, s.id, s.name as student_name, s.roll_number, COALESCE(a.status, NULL) as status, a.remarks FROM students s JOIN batch_students bs ON bs.student_id=s.id LEFT JOIN attendance a ON a.student_id=s.id AND a.scheduled_class_id=? WHERE bs.batch_id=? ORDER BY s.name',
    [class_id, sc[0].batch_id]
  );

  res.json({ success: true, data: students });
}

// ─── MARK ATTENDANCE ─────────────────────────────────────────
export async function markAttendance(req, res) {
  const { scheduled_class_id, records } = req.body;

  if (!scheduled_class_id) return res.status(400).json({ success: false, message: 'scheduled_class_id required' });
  if (!Array.isArray(records)) return res.status(400).json({ success: false, message: 'records must be an array' });

  const markerId = req.user.id;

  for (const entry of records) {
    const { student_id, status, remarks } = entry;
    if (!student_id || !status) continue;
    await query(
      'INSERT INTO attendance (scheduled_class_id, student_id, status, remarks, marked_by) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status), remarks=VALUES(remarks), marked_by=VALUES(marked_by), marked_at=NOW()',
      [scheduled_class_id, student_id, status, remarks || null, markerId]
    );
  }

  await query('UPDATE scheduled_classes SET status="completed" WHERE id=?', [scheduled_class_id]);
  res.json({ success: true, message: 'Attendance saved successfully' });
}

export async function markTeacherAttendance(req, res) {
  const { scheduled_class_id, attendance } = req.body;
  for (const entry of (attendance || [])) {
    const { teacher_id, status, remarks } = entry;
    if (!teacher_id || !status) continue;
    await query(
      'INSERT INTO teacher_attendance (scheduled_class_id, teacher_id, status, remarks) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status), remarks=VALUES(remarks), marked_at=NOW()',
      [scheduled_class_id, teacher_id, status, remarks || null]
    );
  }
  await query('UPDATE scheduled_classes SET status="completed" WHERE id=?', [scheduled_class_id]);
  res.json({ success: true, message: 'Teacher attendance marked' });
}

export async function getBatchAttendanceReport(req, res) {
  const { batch_id } = req.params;
  const { month } = req.query;
  let dateFilter = '';
  const params = [batch_id];
  if (month) { dateFilter = "AND DATE_FORMAT(sc.scheduled_date, '%Y-%m') = ?"; params.push(month); }

  const report = await query(
    'SELECT s.id, s.name, s.roll_number, COUNT(sc.id) as total_classes, SUM(a.status="present") as present, SUM(a.status="absent") as absent, SUM(a.status="late") as late, ROUND(SUM(a.status="present") * 100.0 / NULLIF(COUNT(sc.id), 0), 1) as attendance_pct FROM students s JOIN batch_students bs ON bs.student_id=s.id JOIN scheduled_classes sc ON sc.batch_id=bs.batch_id ' + dateFilter + ' LEFT JOIN attendance a ON a.student_id=s.id AND a.scheduled_class_id=sc.id WHERE bs.batch_id=? GROUP BY s.id ORDER BY s.name',
    [...params, batch_id]
  );

  res.json({ success: true, data: report });
}
