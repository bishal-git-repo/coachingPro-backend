
import { query } from '../config/db.js';
import { hashPassword } from '../utils/auth.js';
import { sendCredentialsEmail } from '../services/email.service.js';

// ─── LIST STUDENTS ────────────────────────────────────────────
export async function listStudents(req, res) {
  const adminId = req.user.admin_id || req.user.id;
  const { search, status, batch_id, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let sql = `SELECT s.*, 
    GROUP_CONCAT(b.name SEPARATOR ', ') as batch_names
    FROM students s
    LEFT JOIN batch_students bs ON bs.student_id = s.id
    LEFT JOIN batches b ON b.id = bs.batch_id
    WHERE s.admin_id=?`;
  const params = [adminId];

  if (search) { sql += ` AND (s.name LIKE ? OR s.email LIKE ? OR s.phone LIKE ?)`; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (status) { sql += ` AND s.status=?`; params.push(status); }
  if (batch_id) { sql += ` AND bs.batch_id=?`; params.push(batch_id); }

  sql += ` GROUP BY s.id ORDER BY s.created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), offset);

  const students = await query(sql, params);

  const countSql = `SELECT COUNT(DISTINCT s.id) as total FROM students s
    LEFT JOIN batch_students bs ON bs.student_id = s.id
    WHERE s.admin_id=? ${search ? 'AND (s.name LIKE ? OR s.email LIKE ? OR s.phone LIKE ?)' : ''}
    ${status ? 'AND s.status=?' : ''} ${batch_id ? 'AND bs.batch_id=?' : ''}`;
  const countParams = [adminId, ...(search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []), ...(status ? [status] : []), ...(batch_id ? [batch_id] : [])];
  const [{ total }] = await query(countSql, countParams);

  res.json({ success: true, data: students, total, page: +page, pages: Math.ceil(total / limit) });
}

// ─── GET STUDENT ──────────────────────────────────────────────
export async function getStudent(req, res) {
  const adminId = req.user.admin_id || req.user.id;
  const { id } = req.params;

  const rows = await query(
    `SELECT s.*, GROUP_CONCAT(b.id SEPARATOR ',') as batch_ids, GROUP_CONCAT(b.name SEPARATOR ',') as batch_names
     FROM students s
     LEFT JOIN batch_students bs ON bs.student_id = s.id
     LEFT JOIN batches b ON b.id = bs.batch_id
     WHERE s.id=? AND s.admin_id=?
     GROUP BY s.id`,
    [id, adminId]
  );

  if (!rows[0]) return res.status(404).json({ success: false, message: 'Student not found' });
  res.json({ success: true, data: rows[0] });
}

// ─── CREATE STUDENT ───────────────────────────────────────────
export async function createStudent(req, res) {
  const adminId = req.user.id;
  const { name, email, phone, parent_name, parent_phone, address, date_of_birth,
          gender, roll_number, plain_password, send_credentials } = req.body;

  const existing = await query(`SELECT id FROM students WHERE email=? AND admin_id=?`, [email, adminId]);
  if (existing.length) return res.status(409).json({ success: false, message: 'Email already used in this coaching' });

  const password = plain_password || Math.random().toString(36).slice(-8) + 'S@1';
  const passwordHash = await hashPassword(password);

  // Get coaching name for email
  const [admin] = await query(`SELECT coaching_name FROM admins WHERE id=?`, [adminId]);

  const result = await query(
    `INSERT INTO students (admin_id, name, email, password_hash, phone, parent_name, parent_phone, address, date_of_birth, gender, roll_number, join_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE())`,
    [adminId, name, email, passwordHash, phone||null, parent_name||null, parent_phone||null, address||null, date_of_birth||null, gender||null, roll_number||null]
  );
  const id = result.insertId;

  if (send_credentials) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    sendCredentialsEmail({
      to: email, name, role: 'student', email, password,
      coachingName: admin.coaching_name,
      loginUrl: `${frontendUrl}/login/student`,
    }).catch(console.error);
  }

  const [student] = await query(`SELECT * FROM students WHERE id=?`, [id]);
  const { password_hash, ...studentData } = student;

  res.status(201).json({
    success: true,
    message: 'Student added successfully' + (send_credentials ? '. Credentials sent by email.' : ''),
    data: { ...studentData, ...(send_credentials ? { tempPassword: password } : {}) },
  });
}

// ─── UPDATE STUDENT ───────────────────────────────────────────
export async function updateStudent(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;
  const { name, email, phone, parent_name, parent_phone, address, date_of_birth, gender, roll_number, status } = req.body;

  const existing = await query(`SELECT id FROM students WHERE id=? AND admin_id=?`, [id, adminId]);
  if (!existing.length) return res.status(404).json({ success: false, message: 'Student not found' });

  await query(
    `UPDATE students SET name=COALESCE(?,name), email=COALESCE(?,email), phone=COALESCE(?,phone), parent_name=COALESCE(?,parent_name),
     parent_phone=COALESCE(?,parent_phone), address=COALESCE(?,address), date_of_birth=COALESCE(?,date_of_birth),
     gender=COALESCE(?,gender), roll_number=COALESCE(?,roll_number), status=COALESCE(?,status) WHERE id=?`,
    [name, email, phone, parent_name, parent_phone, address, date_of_birth, gender, roll_number, status, id]
  );

  const [updated] = await query(`SELECT * FROM students WHERE id=?`, [id]);
  const { password_hash, ...studentData } = updated;
  res.json({ success: true, message: 'Student updated', data: studentData });
}

// ─── DELETE STUDENT ───────────────────────────────────────────
export async function deleteStudent(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;
  await query(`DELETE FROM students WHERE id=? AND admin_id=?`, [id, adminId]);
  res.json({ success: true, message: 'Student removed' });
}

// ─── TOGGLE STATUS ────────────────────────────────────────────
export async function toggleStudentStatus(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;

  const rows = await query(`SELECT status FROM students WHERE id=? AND admin_id=?`, [id, adminId]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'Student not found' });

  const newStatus = rows[0].status === 'active' ? 'inactive' : 'active';
  await query(`UPDATE students SET status=? WHERE id=?`, [newStatus, id]);
  res.json({ success: true, message: `Student ${newStatus}`, status: newStatus });
}

// ─── RESEND CREDENTIALS ───────────────────────────────────────
export async function resendStudentCredentials(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;

  const rows = await query(`SELECT * FROM students WHERE id=? AND admin_id=?`, [id, adminId]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'Student not found' });

  const student = rows[0];
  const tempPassword = Math.random().toString(36).slice(-8) + 'S@1';
  const passwordHash = await hashPassword(tempPassword);
  await query(`UPDATE students SET password_hash=? WHERE id=?`, [passwordHash, id]);

  const [admin] = await query(`SELECT coaching_name FROM admins WHERE id=?`, [adminId]);
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  await sendCredentialsEmail({
    to: student.email, name: student.name, role: 'student',
    email: student.email, password: tempPassword,
    coachingName: admin.coaching_name,
    loginUrl: `${frontendUrl}/login/student`,
  });

  res.json({ success: true, message: 'Credentials sent to student email' });
}

// ─── STUDENT ATTENDANCE SUMMARY ───────────────────────────────
export async function getStudentAttendanceSummary(req, res) {
  const { id } = req.params;
  const adminId = req.user.admin_id || req.user.id;

  const summary = await query(
    `SELECT 
       COUNT(*) as total_classes,
       SUM(a.status='present') as present,
       SUM(a.status='absent') as absent,
       SUM(a.status='late') as late,
       ROUND(SUM(a.status='present')*100/COUNT(*), 1) as attendance_percent
     FROM attendance a
     JOIN scheduled_classes sc ON sc.id = a.scheduled_class_id
     JOIN batches b ON b.id = sc.batch_id
     WHERE a.student_id=? AND b.admin_id=?`,
    [id, adminId]
  );

  const recent = await query(
    `SELECT sc.scheduled_date, sc.title, b.name as batch_name, a.status
     FROM attendance a
     JOIN scheduled_classes sc ON sc.id = a.scheduled_class_id
     JOIN batches b ON b.id = sc.batch_id
     WHERE a.student_id=?
     ORDER BY sc.scheduled_date DESC LIMIT 10`,
    [id]
  );

  res.json({ success: true, data: { summary: summary[0], recent } });
}
