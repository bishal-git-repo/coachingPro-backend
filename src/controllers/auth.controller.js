import { query, withTransaction } from '../config/db.js';
import {
  hashPassword, verifyPassword, generateTokens,
  verifyRefreshToken, saveRefreshToken, revokeRefreshTokensByUser,
} from '../utils/auth.js';
import { sendWelcomeEmail } from '../services/email.service.js';

// ADMIN REGISTER
export async function adminRegister(req, res) {
  const { name, email, password, coaching_name, phone, address } = req.body;

  const existing = await query(`SELECT id FROM admins WHERE email=?`, [email]);
  if (existing.length) {
    return res.status(409).json({ success: false, message: 'Email already registered' });
  }

  const passwordHash = await hashPassword(password);

  // No UUID — INT AUTO_INCREMENT handles id
  const result = await query(
    `INSERT INTO admins (name, email, password_hash, coaching_name, phone, address, plan)
     VALUES (?, ?, ?, ?, ?, ?, 'free')`,
    [name, email, passwordHash, coaching_name, phone || null, address || null]
  );

  const id = result.insertId;

  sendWelcomeEmail({ to: email, name, coachingName: coaching_name }).catch(console.error);

  const { accessToken, refreshToken } = generateTokens({ id, email, role: 'admin', coaching_name });
  await saveRefreshToken(id, 'admin', refreshToken);

  res.status(201).json({
    success: true,
    message: 'Coaching registered successfully!',
    data: { id, name, email, coaching_name, plan: 'free' },
    accessToken,
    refreshToken,
  });
}

// ADMIN LOGIN
export async function adminLogin(req, res) {
  const { email, password } = req.body;

  const rows = await query(
    `SELECT id, name, email, password_hash, coaching_name, plan, plan_expires_at, is_active FROM admins WHERE email=?`,
    [email]
  );
  const admin = rows[0];

  if (!admin || !(await verifyPassword(password, admin.password_hash))) {
    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  }
  if (!admin.is_active) {
    return res.status(403).json({ success: false, message: 'Account suspended. Contact support.' });
  }

  const { accessToken, refreshToken } = generateTokens({
    id: admin.id, email: admin.email, role: 'admin',
    coaching_name: admin.coaching_name, plan: admin.plan,
  });
  await saveRefreshToken(admin.id, 'admin', refreshToken);

  const { password_hash, ...adminData } = admin;
  res.json({ success: true, data: adminData, accessToken, refreshToken });
}

// TEACHER LOGIN
export async function teacherLogin(req, res) {
  const { email, password } = req.body;

  const rows = await query(
    `SELECT t.id, t.name, t.email, t.password_hash, t.status, t.admin_id, t.photo,
            a.coaching_name, a.is_active as coaching_active
     FROM teachers t JOIN admins a ON a.id=t.admin_id WHERE t.email=?`,
    [email]
  );
  const teacher = rows[0];

  if (!teacher || !(await verifyPassword(password, teacher.password_hash))) {
    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  }
  if (teacher.status !== 'active') {
    return res.status(403).json({ success: false, message: 'Account inactive. Contact your coaching admin.' });
  }
  if (!teacher.coaching_active) {
    return res.status(403).json({ success: false, message: 'Coaching institute is suspended.' });
  }

  const { accessToken, refreshToken } = generateTokens({
    id: teacher.id, email: teacher.email, role: 'teacher',
    admin_id: teacher.admin_id, coaching_name: teacher.coaching_name,
  });
  await saveRefreshToken(teacher.id, 'teacher', refreshToken);

  const { password_hash, ...teacherData } = teacher;
  res.json({ success: true, data: teacherData, accessToken, refreshToken });
}

// STUDENT LOGIN
export async function studentLogin(req, res) {
  const { email, password } = req.body;

  const rows = await query(
    `SELECT s.id, s.name, s.email, s.password_hash, s.status, s.admin_id, s.photo,
            a.coaching_name, a.is_active as coaching_active
     FROM students s JOIN admins a ON a.id=s.admin_id WHERE s.email=?`,
    [email]
  );
  const student = rows[0];

  if (!student || !(await verifyPassword(password, student.password_hash))) {
    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  }
  if (student.status !== 'active') {
    return res.status(403).json({ success: false, message: 'Account inactive. Contact your coaching admin.' });
  }
  if (!student.coaching_active) {
    return res.status(403).json({ success: false, message: 'Coaching institute is suspended.' });
  }

  const { accessToken, refreshToken } = generateTokens({
    id: student.id, email: student.email, role: 'student',
    admin_id: student.admin_id, coaching_name: student.coaching_name,
  });
  await saveRefreshToken(student.id, 'student', refreshToken);

  const { password_hash, ...studentData } = student;
  res.json({ success: true, data: studentData, accessToken, refreshToken });
}

// REFRESH TOKENS
export async function refreshTokens(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ success: false, message: 'Refresh token required' });

  const decoded = verifyRefreshToken(refreshToken);
  const { id, role } = decoded;

  const { accessToken, refreshToken: newRefreshToken } = generateTokens(
    Object.fromEntries(Object.entries(decoded).filter(([k]) => !['iat','exp','type'].includes(k)))
  );

  await revokeRefreshTokensByUser(id, role);
  await saveRefreshToken(id, role, newRefreshToken);

  res.json({ success: true, accessToken, refreshToken: newRefreshToken });
}

// LOGOUT
export async function logout(req, res) {
  await revokeRefreshTokensByUser(req.user.id, req.user.role);
  res.json({ success: true, message: 'Logged out' });
}

// CHANGE PASSWORD
export async function changePassword(req, res) {
  const { current_password, new_password } = req.body;
  const { id, role } = req.user;

  const table = { admin: 'admins', teacher: 'teachers', student: 'students' }[role];
  const rows = await query(`SELECT password_hash FROM ${table} WHERE id=?`, [id]);
  if (!rows[0]) return res.status(404).json({ success: false, message: 'User not found' });

  const valid = await verifyPassword(current_password, rows[0].password_hash);
  if (!valid) return res.status(401).json({ success: false, message: 'Current password is incorrect' });

  const newHash = await hashPassword(new_password);
  await query(`UPDATE ${table} SET password_hash=? WHERE id=?`, [newHash, id]);
  res.json({ success: true, message: 'Password changed' });
}

// GET CURRENT USER
export async function getMe(req, res) {
  const { id, role } = req.user;
  let data;

  if (role === 'admin') {
    const rows = await query(
      `SELECT id, name, email, coaching_name, coaching_logo, phone, address, plan, plan_expires_at, created_at FROM admins WHERE id=?`,
      [id]
    );
    data = rows[0];
  } else if (role === 'teacher') {
    const rows = await query(
      `SELECT t.id, t.name, t.email, t.phone, t.subject, t.qualification, t.photo, t.status, t.join_date,
              a.coaching_name, a.id as admin_id
       FROM teachers t JOIN admins a ON a.id=t.admin_id WHERE t.id=?`,
      [id]
    );
    data = rows[0];
  } else {
    const rows = await query(
      `SELECT s.id, s.name, s.email, s.phone, s.photo, s.status, s.roll_number, s.join_date,
              a.coaching_name, a.id as admin_id
       FROM students s JOIN admins a ON a.id=s.admin_id WHERE s.id=?`,
      [id]
    );
    data = rows[0];
  }

  if (!data) return res.status(404).json({ success: false, message: 'User not found' });
  res.json({ success: true, data: { ...data, role } });
}
