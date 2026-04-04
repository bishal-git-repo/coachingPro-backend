import { query } from '../config/db.js';
import { sendContactNotification } from '../services/email.service.js';

// ─── Submit Contact Form (public — no auth needed) ────────────
export async function submitContact(req, res) {
  const { name, email, subject, message } = req.body;

  if (!name?.trim() || !email?.trim() || !subject?.trim() || !message?.trim()) {
    return res.status(400).json({ success: false, message: 'All fields are required.' });
  }

  // Basic email format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }

  // Save to DB
  const result = await query(
    `INSERT INTO contact_submissions (name, email, subject, message) VALUES (?, ?, ?, ?)`,
    [name.trim(), email.trim().toLowerCase(), subject.trim(), message.trim()]
  );

  // Send email notification to admin (non-blocking — don't fail if email fails)
  try {
    await sendContactNotification({ id: result.insertId, name, email, subject, message });
  } catch (err) {
    console.error('Contact email notification failed:', err.message);
  }

  res.status(201).json({
    success: true,
    message: 'Your message has been received. We will get back to you within 2 business days.',
    id: result.insertId,
  });
}

// ─── List All Submissions (admin only) ───────────────────────
export async function listContacts(req, res) {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let sql    = `SELECT * FROM contact_submissions`;
  let params = [];

  if (status) {
    sql += ` WHERE status = ?`;
    params.push(status);
  }

  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), offset);

  const [rows, [{ total }]] = await Promise.all([
    query(sql, params),
    query(`SELECT COUNT(*) as total FROM contact_submissions${status ? ' WHERE status=?' : ''}`, status ? [status] : []),
  ]);

  res.json({ success: true, data: rows, total, page: parseInt(page), limit: parseInt(limit) });
}

// ─── Update Status (admin only) ──────────────────────────────
export async function updateContactStatus(req, res) {
  const { id }     = req.params;
  const { status } = req.body;

  const allowed = ['new', 'read', 'replied', 'closed'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ success: false, message: `Status must be one of: ${allowed.join(', ')}` });
  }

  await query(`UPDATE contact_submissions SET status=? WHERE id=?`, [status, id]);
  res.json({ success: true, message: 'Status updated.' });
}

// ─── Delete Submission (admin only) ──────────────────────────
export async function deleteContact(req, res) {
  const { id } = req.params;
  await query(`DELETE FROM contact_submissions WHERE id=?`, [id]);
  res.json({ success: true, message: 'Submission deleted.' });
}
