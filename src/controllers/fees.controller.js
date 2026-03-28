import Razorpay from 'razorpay';
import crypto from 'crypto';
import { query } from '../config/db.js';
import { generateFeeSlipPDF } from '../services/pdf.service.js';
import { sendFeeSlipEmail } from '../services/email.service.js';

function getRazorpay() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

function generateReceiptNumber() {
  const d = new Date();
  const yr = d.getFullYear().toString().slice(-2);
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `RCP-${yr}${mo}-${rand}`;
}

// LIST FEES
export async function listFees(req, res) {
  const adminId = req.user.admin_id || req.user.id;
  const { student_id, batch_id, status, month_year } = req.query;

  let sql = `
    SELECT f.*, s.name as student_name, s.email as student_email,
      COALESCE(b.name,'—') as batch_name, COALESCE(c.name,'—') as class_name
    FROM fees f
    JOIN students s ON s.id = f.student_id
    LEFT JOIN batches b ON b.id = f.batch_id
    LEFT JOIN classes c ON c.id = b.class_id
    WHERE f.admin_id=?`;
  const params = [adminId];

  if (student_id) { sql += ` AND f.student_id=?`; params.push(student_id); }
  if (batch_id)   { sql += ` AND f.batch_id=?`;   params.push(batch_id); }
  if (status)     { sql += ` AND f.status=?`;      params.push(status); }
  if (month_year) { sql += ` AND f.month_year=?`;  params.push(month_year); }
  sql += ` ORDER BY f.created_at DESC`;

  const fees = await query(sql, params);
  res.json({ success: true, data: fees });
}

// CREATE FEE — batch_id is now optional
export async function createFee(req, res) {
  const adminId = req.user.id;
  const { student_id, batch_id, amount, due_date, month_year, description } = req.body;

  if (!student_id) return res.status(400).json({ success: false, message: 'student_id is required' });
  if (!amount)     return res.status(400).json({ success: false, message: 'amount is required' });

  // Verify student belongs to this admin
  const [student] = await query(`SELECT id FROM students WHERE id=? AND admin_id=?`, [student_id, adminId]);
  if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

  // Verify batch if provided
  if (batch_id) {
    const [batch] = await query(`SELECT id FROM batches WHERE id=? AND admin_id=?`, [batch_id, adminId]);
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });
  }

  const receiptNumber = generateReceiptNumber();
  const result = await query(
    `INSERT INTO fees (admin_id, student_id, batch_id, amount, due_date, month_year, description, receipt_number)
     VALUES (?,?,?,?,?,?,?,?)`,
    [adminId, student_id, batch_id || null, amount, due_date || null, month_year || null, description || null, receiptNumber]
  );

  res.status(201).json({ success: true, message: 'Fee entry created', data: { id: result.insertId, receiptNumber } });
}

// BULK CREATE
export async function createBulkFees(req, res) {
  const adminId = req.user.id;
  const { batch_id, amount, due_date, month_year } = req.body;

  if (!batch_id) return res.status(400).json({ success: false, message: 'batch_id is required' });
  if (!amount)   return res.status(400).json({ success: false, message: 'amount is required' });

  const [batch] = await query(`SELECT id FROM batches WHERE id=? AND admin_id=?`, [batch_id, adminId]);
  if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });

  const students = await query(
    `SELECT s.id FROM students s JOIN batch_students bs ON bs.student_id=s.id WHERE bs.batch_id=? AND s.admin_id=? AND s.status='active'`,
    [batch_id, adminId]
  );
  if (!students.length) return res.status(400).json({ success: false, message: 'No active students in this batch' });

  let created = 0;
  for (const { id: sid } of students) {
    if (month_year) {
      const existing = await query(`SELECT id FROM fees WHERE student_id=? AND batch_id=? AND month_year=?`, [sid, batch_id, month_year]);
      if (existing.length) continue;
    }
    await query(
      `INSERT INTO fees (admin_id, student_id, batch_id, amount, due_date, month_year, receipt_number)
       VALUES (?,?,?,?,?,?,?)`,
      [adminId, sid, batch_id, amount, due_date || null, month_year || null, generateReceiptNumber()]
    );
    created++;
  }

  res.json({ success: true, message: `${created} fee entries created` });
}

// MARK PAID
export async function markFeePaid(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;
  const { payment_mode, payment_date, transaction_id } = req.body;

  const [fee] = await query(`SELECT * FROM fees WHERE id=? AND admin_id=?`, [id, adminId]);
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });

  await query(
    `UPDATE fees SET status='paid', paid_amount=amount, paid_date=COALESCE(?,CURDATE()),
     payment_mode=COALESCE(?,payment_mode), transaction_id=COALESCE(?,transaction_id) WHERE id=?`,
    [payment_date || null, payment_mode || null, transaction_id || null, id]
  );

  res.json({ success: true, message: 'Fee marked as paid' });
}

// SEND FEE SLIP EMAIL (paid plan only)
export async function sendFeeSlip(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;

  const [fee] = await query(
    `SELECT f.*, s.name as student_name, s.email as student_email,
     COALESCE(b.name,'') as batch_name, COALESCE(c.name,'') as class_name, a.coaching_name
     FROM fees f
     JOIN students s ON s.id = f.student_id
     LEFT JOIN batches b ON b.id = f.batch_id
     LEFT JOIN classes c ON c.id = b.class_id
     JOIN admins a ON a.id = f.admin_id
     WHERE f.id=? AND f.admin_id=?`,
    [id, adminId]
  );
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });

  const pdfBuffer = await generateFeeSlipPDF({
    receiptNumber: fee.receipt_number, studentName: fee.student_name,
    studentEmail: fee.student_email, batchName: fee.batch_name,
    className: fee.class_name, coachingName: fee.coaching_name,
    monthYear: fee.month_year, amount: fee.amount, status: fee.status,
    dueDate: fee.due_date, paidDate: fee.paid_date,
  });

  await sendFeeSlipEmail({ to: fee.student_email, name: fee.student_name, coachingName: fee.coaching_name, pdfBuffer });
  await query(`UPDATE fees SET slip_sent=1, slip_sent_at=NOW() WHERE id=?`, [id]);

  res.json({ success: true, message: 'Fee slip sent to student email' });
}

// DOWNLOAD FEE SLIP PDF
export async function downloadFeeSlip(req, res) {
  const { id } = req.params;
  const userId = req.user.id;
  const adminId = req.user.admin_id || req.user.id;

  const [fee] = await query(
    `SELECT f.*, s.name as student_name, s.email as student_email,
     COALESCE(b.name,'') as batch_name, COALESCE(c.name,'') as class_name, a.coaching_name
     FROM fees f
     JOIN students s ON s.id = f.student_id
     LEFT JOIN batches b ON b.id = f.batch_id
     LEFT JOIN classes c ON c.id = b.class_id
     JOIN admins a ON a.id = f.admin_id
     WHERE f.id=? AND (f.admin_id=? OR f.student_id=?)`,
    [id, adminId, userId]
  );
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });

  const pdfBuffer = await generateFeeSlipPDF({
    receiptNumber: fee.receipt_number, studentName: fee.student_name,
    studentEmail: fee.student_email, batchName: fee.batch_name,
    className: fee.class_name, coachingName: fee.coaching_name,
    monthYear: fee.month_year, amount: fee.amount, status: fee.status,
    dueDate: fee.due_date, paidDate: fee.paid_date,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=fee-slip-${fee.receipt_number || id}.pdf`);
  res.send(pdfBuffer);
}

// RAZORPAY ORDER
export async function createRazorpayOrder(req, res) {
  const { fee_id } = req.body;
  const adminId = req.user.admin_id || req.user.id;

  const [fee] = await query(`SELECT * FROM fees WHERE id=? AND admin_id=?`, [fee_id, adminId]);
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });

  const order = await getRazorpay().orders.create({
    amount: Math.round(parseFloat(fee.amount) * 100),
    currency: 'INR',
    receipt: fee.receipt_number || `fee-${fee_id}`,
  });

  await query(`UPDATE fees SET razorpay_order_id=? WHERE id=?`, [order.id, fee_id]);
  res.json({ success: true, data: { orderId: order.id, amount: order.amount, currency: order.currency, key: process.env.RAZORPAY_KEY_ID } });
}

// RAZORPAY VERIFY
export async function verifyRazorpayPayment(req, res) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, fee_id } = req.body;

  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');

  if (expected !== razorpay_signature) {
    return res.status(400).json({ success: false, message: 'Payment verification failed' });
  }

  await query(
    `UPDATE fees SET razorpay_payment_id=?, razorpay_signature=?, status='paid', paid_date=CURDATE(), paid_amount=amount WHERE id=?`,
    [razorpay_payment_id, razorpay_signature, fee_id]
  );
  res.json({ success: true, message: 'Payment verified' });
}

// PLAN ORDER — ₹999/month
export async function createPlanOrder(req, res) {
  const adminId = req.user.id;
  const order = await getRazorpay().orders.create({
    amount: 99900, // ₹999 in paise
    currency: 'INR',
    receipt: `PLAN-${adminId}`,
    notes: { admin_id: adminId, plan: 'paid', duration: 'monthly' },
  });

  await query(
    `INSERT INTO plan_payments (admin_id, razorpay_order_id, amount_paise, status) VALUES (?,?,99900,'created')`,
    [adminId, order.id]
  );
  res.json({ success: true, data: { orderId: order.id, amount: order.amount, currency: order.currency, key: process.env.RAZORPAY_KEY_ID } });
}

// PLAN VERIFY — sets expiry 1 month ahead
export async function verifyPlanPayment(req, res) {
  const adminId = req.user.id;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');

  if (expected !== razorpay_signature) {
    return res.status(400).json({ success: false, message: 'Payment verification failed' });
  }

  // Check if already paid — extend expiry if already paid
  const [admin] = await query(`SELECT plan, plan_expires_at FROM admins WHERE id=?`, [adminId]);
  const base = admin.plan === 'paid' && admin.plan_expires_at && new Date(admin.plan_expires_at) > new Date()
    ? new Date(admin.plan_expires_at) : new Date();
  base.setMonth(base.getMonth() + 1); // +1 month

  await query(`UPDATE admins SET plan='paid', plan_expires_at=? WHERE id=?`, [base, adminId]);
  await query(
    `UPDATE plan_payments SET razorpay_payment_id=?, razorpay_signature=?, status='paid' WHERE razorpay_order_id=?`,
    [razorpay_payment_id, razorpay_signature, razorpay_order_id]
  );
  res.json({ success: true, message: 'Plan upgraded! Valid until ' + base.toDateString(), expires_at: base });
}

// DELETE FEE (pending/overdue only)
export async function deleteFee(req, res) {
  const adminId = req.user.id;
  const { id } = req.params;

  const [fee] = await query(`SELECT * FROM fees WHERE id=? AND admin_id=?`, [id, adminId]);
  if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });
  if (fee.status === 'paid') return res.status(400).json({ success: false, message: 'Cannot delete a paid fee record' });

  await query(`DELETE FROM fees WHERE id=? AND admin_id=?`, [id, adminId]);
  res.json({ success: true, message: 'Fee record deleted' });
}

// FEES ANALYTICS
export async function getFeesAnalytics(req, res) {
  const adminId = req.user.id;
  const [summary] = await query(
    `SELECT SUM(amount) as total_fees,
      SUM(CASE WHEN status='paid' THEN paid_amount ELSE 0 END) as collected,
      SUM(CASE WHEN status IN ('pending','overdue') THEN amount ELSE 0 END) as pending,
      COUNT(*) as total_entries,
      SUM(status='paid') as paid_count,
      SUM(status='pending') as pending_count,
      SUM(status='overdue') as overdue_count
     FROM fees WHERE admin_id=?`,
    [adminId]
  );
  const monthly = await query(
    `SELECT month_year, SUM(amount) as total,
      SUM(CASE WHEN status='paid' THEN paid_amount ELSE 0 END) as collected
     FROM fees WHERE admin_id=? AND month_year IS NOT NULL
     GROUP BY month_year ORDER BY month_year DESC LIMIT 12`,
    [adminId]
  );
  res.json({ success: true, data: { summary, monthly } });
}
