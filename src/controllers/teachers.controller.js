
import { query } from '../config/db.js';
import { hashPassword } from '../utils/auth.js';
import { sendCredentialsEmail } from '../services/email.service.js';

export async function listTeachers(req, res) {
  const adminId = req.user.admin_id || req.user.id;
  const { search, status } = req.query;

  let sql = `SELECT t.id, t.name, t.email, t.phone, t.subject, t.qualification, t.salary, t.photo, t.status, t.join_date, t.created_at,
    COUNT(DISTINCT bt.batch_id) as batch_count
    FROM teachers t
    LEFT JOIN batch_teachers bt ON bt.teacher_id = t.id
    WHERE t.admin_id=?`;
  const params = [adminId];

  if (search) { sql += ` AND (t.name LIKE ? OR t.email LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  if (status) { sql += ` AND t.status=?`; params.push(status); }
  sql += ` GROUP BY t.id ORDER BY t.created_at DESC`;

  const teachers = await query(sql, params);
  res.json({ success: true, data: teachers });
}

export async function getTeacher(req, res) {
  const adminId = req.user.admin_id || req.user.id;
  const { id } = req.params;

  const rows = await query(
    `SELECT t.*, GROUP_CONCAT(b.name SEPARATOR ', ') as batch_names
     FROM teachers t
     LEFT JOIN batch_teachers bt ON bt.teacher_id = t.id
     LEFT JOIN batches b ON b.id = bt.batch_id
     WHERE t.id=? AND t.admin_id=?
     GROUP BY t.id`,
    [id, adminId]
  );

  if (!rows[0]) return res.status(404).json({ success: false, message: 'Teacher not found' });

  const { password_hash, ...data } = rows[0];
  res.json({ success: true, data });
}

export async function createTeacher(req, res) {
  const adminId = req.user.id;
  const { name, email, phone, subject, qualification, salary, plain_password, send_credentials } = req.body;

  const existing = await query(`SELECT id FROM teachers WHERE email=? AND admin_id=?`, [email, adminId]);
  if (existing.length) return res.status(409).json({ success: false, message: 'Email already used' });

  const password = plain_password || Math.random().toString(36).slice(-8) + 'T@1';
  const passwordHash = await hashPassword(password);
  const [admin] = await query(`SELECT coaching_name FROM admins WHERE id=?`, [adminId]);

  const result = await query(
    `INSERT INTO teachers (admin_id, name, email, password_hash, phone, subject, qualification, salary, join_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURDATE())`,
    [adminId, name, email, passwordHash, phone||null, subject||null, qualification||null, salary||0]
  );
  const id = result.insertId;

  if (send_credentials) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    sendCredentialsEmail({
      to: email, name, role: 'teacher', email, password,
      coachingName: admin.coaching_name,
      loginUrl: `${frontendUrl}/login/teacher`,
    }).catch(console.error);
  }

  res.status(201).json({
    success: true,
    message: 'Teacher added' + (send_credentials ? '. Credentials sent.' : ''),
    data: { id, name, email, ...(send_credentials ? { tempPassword: password } : {}) },
  });
}

export async function updateTeacher(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;
  const { name, phone, subject, qualification, salary, status } = req.body;

  await query(
    `UPDATE teachers SET name=COALESCE(?,name), phone=COALESCE(?,phone), subject=COALESCE(?,subject),
     qualification=COALESCE(?,qualification), salary=COALESCE(?,salary), status=COALESCE(?,status) WHERE id=? AND admin_id=?`,
    [name, phone, subject, qualification, salary, status, id, adminId]
  );

  res.json({ success: true, message: 'Teacher updated' });
}

export async function deleteTeacher(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;
  await query(`DELETE FROM teachers WHERE id=? AND admin_id=?`, [id, adminId]);
  res.json({ success: true, message: 'Teacher removed' });
}

export async function toggleTeacherStatus(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;
  const rows = await query(`SELECT status FROM teachers WHERE id=? AND admin_id=?`, [id, adminId]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'Teacher not found' });
  const newStatus = rows[0].status === 'active' ? 'inactive' : 'active';
  await query(`UPDATE teachers SET status=? WHERE id=?`, [newStatus, id]);
  res.json({ success: true, status: newStatus });
}

export async function resendTeacherCredentials(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;

  const rows = await query(`SELECT * FROM teachers WHERE id=? AND admin_id=?`, [id, adminId]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'Teacher not found' });

  const teacher = rows[0];
  const tempPassword = Math.random().toString(36).slice(-8) + 'T@1';
  await query(`UPDATE teachers SET password_hash=? WHERE id=?`, [await hashPassword(tempPassword), id]);

  const [admin] = await query(`SELECT coaching_name FROM admins WHERE id=?`, [adminId]);
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  await sendCredentialsEmail({
    to: teacher.email, name: teacher.name, role: 'teacher',
    email: teacher.email, password: tempPassword,
    coachingName: admin.coaching_name,
    loginUrl: `${frontendUrl}/login/teacher`,
  });

  res.json({ success: true, message: 'Credentials sent to teacher email' });
}

// Teacher attendance summary
export async function getTeacherAttendanceSummary(req, res) {
  const { id } = req.params;
  const adminId = req.user.admin_id || req.user.id;

  const summary = await query(
    `SELECT COUNT(*) as total_classes,
     SUM(ta.status='present') as present,
     SUM(ta.status='absent') as absent,
     ROUND(SUM(ta.status='present')*100/COUNT(*), 1) as attendance_percent
     FROM teacher_attendance ta
     JOIN scheduled_classes sc ON sc.id = ta.scheduled_class_id
     JOIN batches b ON b.id = sc.batch_id
     WHERE ta.teacher_id=? AND b.admin_id=?`,
    [id, adminId]
  );

  res.json({ success: true, data: summary[0] });
}

// Teacher salary history
export async function getTeacherSalaryHistory(req, res) {
  const adminId = req.user.admin_id || req.user.id;
  const { id } = req.params;

  const payments = await query(
    `SELECT * FROM teacher_payments WHERE teacher_id=? AND admin_id=? ORDER BY payment_date DESC`,
    [id, adminId]
  );

  res.json({ success: true, data: payments });
}

export async function addTeacherPayment(req, res) {
  const adminId = req.user.id;
  const { teacher_id, amount, payment_date, month_year, payment_mode, transaction_ref, notes } = req.body;

  await query(
    `INSERT INTO teacher_payments (admin_id, teacher_id, amount, payment_date, month_year, payment_mode, transaction_ref, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [adminId, teacher_id, amount, payment_date, month_year||null, payment_mode||'bank_transfer', transaction_ref||null, notes||null]
  );

  res.status(201).json({ success: true, message: 'Payment recorded' });
}

// LIST ALL TEACHER PAYMENTS (admin view)
export async function listTeacherPayments(req, res) {
  const { teacher_id } = req.query;

  // Teacher role: can only see their own payments
  if (req.user.role === 'teacher') {
    const payments = await query(
      `SELECT tp.*, t.name as teacher_name, t.subject
       FROM teacher_payments tp
       JOIN teachers t ON t.id = tp.teacher_id
       WHERE tp.teacher_id=?
       ORDER BY tp.payment_date DESC`,
      [req.user.id]
    );
    return res.json({ success: true, data: payments });
  }

  // Admin: see all or filter by teacher
  const adminId = req.user.id;
  let sql = `SELECT tp.*, t.name as teacher_name, t.subject
    FROM teacher_payments tp
    JOIN teachers t ON t.id = tp.teacher_id
    WHERE tp.admin_id=?`;
  const params = [adminId];
  if (teacher_id) { sql += ` AND tp.teacher_id=?`; params.push(teacher_id); }
  sql += ` ORDER BY tp.payment_date DESC`;
  const payments = await query(sql, params);
  res.json({ success: true, data: payments });
}
