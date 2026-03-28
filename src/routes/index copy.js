import express from 'express';
import { body } from 'express-validator';
import { requireAuth, requirePaidPlan, checkFreeplanLimits } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/error.middleware.js';
import { uploadMaterial as uploadMiddleware } from '../middleware/upload.middleware.js';
import { query } from '../config/db.js';

import * as auth from '../controllers/auth.controller.js';
import * as students from '../controllers/students.controller.js';
import * as teachers from '../controllers/teachers.controller.js';
import * as classes from '../controllers/classes.controller.js';
import * as attendance from '../controllers/attendance.controller.js';
import * as fees from '../controllers/fees.controller.js';
import * as materials from '../controllers/materials.controller.js';
import * as dashboard from '../controllers/dashboard.controller.js';

const router = express.Router();

// ─── AUTH ────────────────────────────────────────────────────
// Strong password: min 8 chars, 1 uppercase, 1 number, 1 symbol
const strongPassword = body('password')
  .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
  .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
  .matches(/[0-9]/).withMessage('Password must contain at least one number')
  .matches(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/).withMessage('Password must contain at least one special character');

router.post('/auth/admin/register',
  [body('name').trim().notEmpty().withMessage('Name required'),
   body('email').isEmail().withMessage('Valid email required'),
   strongPassword,
   body('coaching_name').trim().notEmpty().withMessage('Coaching name required')],
  validate, auth.adminRegister
);
router.post('/auth/admin/login',
  [body('email').isEmail(), body('password').notEmpty()], validate, auth.adminLogin
);
router.post('/auth/teacher/login',
  [body('email').isEmail(), body('password').notEmpty()], validate, auth.teacherLogin
);
router.post('/auth/student/login',
  [body('email').isEmail(), body('password').notEmpty()], validate, auth.studentLogin
);
router.post('/auth/refresh', auth.refreshTokens);
router.post('/auth/logout', requireAuth(), auth.logout);
router.get('/auth/me', requireAuth(), auth.getMe);
router.put('/auth/change-password',
  requireAuth(),
  [body('current_password').notEmpty(),
   body('new_password').isLength({ min: 8 }).matches(/[A-Z]/).matches(/[0-9]/).matches(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/)],
  validate, auth.changePassword
);

// ─── DASHBOARD ───────────────────────────────────────────────
router.get('/dashboard/admin',   requireAuth('admin'),   dashboard.getAdminDashboard);
router.get('/dashboard/student', requireAuth('student'), dashboard.getStudentDashboard);
router.get('/dashboard/teacher', requireAuth('teacher'), dashboard.getTeacherDashboard);

// ─── STUDENTS ────────────────────────────────────────────────
router.get('/students',     requireAuth('admin'),           students.listStudents);
router.get('/students/:id', requireAuth('admin','student'), students.getStudent);
router.post('/students',    requireAuth('admin'), checkFreeplanLimits('student'),
  [body('name').trim().notEmpty(), body('email').isEmail()], validate, students.createStudent);
router.put('/students/:id',                requireAuth('admin'), students.updateStudent);
router.delete('/students/:id',             requireAuth('admin'), students.deleteStudent);
router.patch('/students/:id/toggle-status',requireAuth('admin'), students.toggleStudentStatus);
router.post('/students/:id/resend-credentials', requireAuth('admin'), students.resendStudentCredentials);
router.get('/students/:id/attendance',     requireAuth('admin','student'), students.getStudentAttendanceSummary);

// ─── TEACHERS ────────────────────────────────────────────────
router.get('/teachers',     requireAuth('admin','student','teacher'), teachers.listTeachers);
router.get('/teachers/:id', requireAuth('admin','teacher'),           teachers.getTeacher);
router.post('/teachers',    requireAuth('admin'), checkFreeplanLimits('teacher'),
  [body('name').trim().notEmpty(), body('email').isEmail()], validate, teachers.createTeacher);
router.put('/teachers/:id',                requireAuth('admin'), teachers.updateTeacher);
router.delete('/teachers/:id',             requireAuth('admin'), teachers.deleteTeacher);
router.patch('/teachers/:id/toggle-status',requireAuth('admin'), teachers.toggleTeacherStatus);
router.post('/teachers/:id/resend-credentials', requireAuth('admin'), teachers.resendTeacherCredentials);
router.get('/teachers/:id/attendance',     requireAuth('admin','teacher'), teachers.getTeacherAttendanceSummary);
router.get('/teachers/:id/payments',       requireAuth('admin','teacher'), teachers.getTeacherSalaryHistory);

// ─── TEACHER PAYMENTS ────────────────────────────────────────
router.get('/teacher-payments',  requireAuth('admin','teacher'), teachers.listTeacherPayments);
router.post('/teacher-payments', requireAuth('admin'), teachers.addTeacherPayment);

// ─── CLASSES ─────────────────────────────────────────────────
router.get('/classes',     requireAuth(), classes.listClasses);
router.get('/classes/:id', requireAuth(), classes.getClass);
router.post('/classes',    requireAuth('admin'), [body('name').trim().notEmpty()], validate, classes.createClass);
router.put('/classes/:id', requireAuth('admin'), classes.updateClass);
router.delete('/classes/:id', requireAuth('admin'), classes.deleteClass);

// ─── BATCHES ─────────────────────────────────────────────────
router.get('/batches',     requireAuth(), classes.listBatches);
router.get('/batches/:id', requireAuth(), classes.getBatch);
router.post('/batches',    requireAuth('admin'),
  [body('name').trim().notEmpty(), body('class_id').notEmpty()], validate, classes.createBatch);
router.put('/batches/:id', requireAuth('admin'), classes.updateBatch);
router.delete('/batches/:id', requireAuth('admin'), classes.deleteBatch);
router.post('/batches/assign-student',  requireAuth('admin'), classes.assignStudentToBatch);
router.post('/batches/remove-student',  requireAuth('admin'), classes.removeStudentFromBatch);
router.post('/batches/assign-teacher',  requireAuth('admin'), classes.assignTeacherToBatch);
router.post('/batches/remove-teacher',  requireAuth('admin'), classes.removeTeacherFromBatch);

// ─── SCHEDULE ────────────────────────────────────────────────
// NOTE: /attendance/session/:id and /attendance/mark must come before /attendance/:class_id
router.get('/attendance/scheduled',    requireAuth(), attendance.listScheduledClasses);
router.post('/attendance/scheduled',   requireAuth('admin'),
  [body('batch_id').notEmpty(), body('scheduled_date').notEmpty(), body('start_time').notEmpty(), body('end_time').notEmpty()],
  validate, attendance.createScheduledClass);
router.put('/attendance/scheduled/:id',    requireAuth('admin'), attendance.updateScheduledClass);
router.delete('/attendance/scheduled/:id', requireAuth('admin'), attendance.deleteScheduledClass);

// ─── ATTENDANCE ──────────────────────────────────────────────
router.get('/attendance/session/:class_id',     requireAuth(), attendance.getAttendanceSheet);
router.post('/attendance/mark',                 requireAuth('admin','teacher'), attendance.markAttendance);
router.post('/attendance/teacher',              requireAuth('admin','teacher'), attendance.markTeacherAttendance);
router.get('/attendance/batch/:batch_id/report',requireAuth('admin'), attendance.getBatchAttendanceReport);
// keep legacy route for old clients
router.get('/attendance/:class_id',             requireAuth(), attendance.getAttendanceSheet);

// ─── FEES ────────────────────────────────────────────────────
// Static routes MUST be before /:id
router.get('/fees/analytics',        requireAuth('admin'), fees.getFeesAnalytics);
router.post('/fees/bulk',            requireAuth('admin'), fees.createBulkFees);
router.post('/fees/razorpay/order',  requireAuth(), requirePaidPlan, fees.createRazorpayOrder);
router.post('/fees/razorpay/verify', requireAuth(), requirePaidPlan, fees.verifyRazorpayPayment);
router.get('/fees',                  requireAuth('admin','student'), fees.listFees);
router.post('/fees',                 requireAuth('admin'), fees.createFee);
router.patch('/fees/:id/mark-paid',  requireAuth('admin'), fees.markFeePaid);
router.delete('/fees/:id',           requireAuth('admin'), fees.deleteFee);
router.post('/fees/:id/send-slip',   requireAuth('admin'), requirePaidPlan, fees.sendFeeSlip);
router.get('/fees/:id/download-slip',requireAuth(), fees.downloadFeeSlip);

// ─── PLAN ────────────────────────────────────────────────────
router.post('/plan/order',  requireAuth('admin'), fees.createPlanOrder);
router.post('/plan/verify', requireAuth('admin'), fees.verifyPlanPayment);

// ─── MATERIALS ───────────────────────────────────────────────
router.get('/materials',          requireAuth(), materials.listMaterials);
router.get('/materials/:id',      requireAuth(), materials.getMaterial);
router.post('/materials',         requireAuth('admin','teacher'), uploadMiddleware, materials.uploadMaterial);
router.delete('/materials/:id',   requireAuth('admin','teacher'), materials.deleteMaterial);
router.get('/materials/:id/stream',   requireAuth(), materials.serveFile);
router.get('/materials/:id/download', requireAuth(), materials.serveFile);

// ─── ADMIN PROFILE ───────────────────────────────────────────
router.put('/admin/profile', requireAuth('admin'), async (req, res, next) => {
  try {
    const { name, coaching_name, phone, address } = req.body;
    await query(
      `UPDATE admins SET name=COALESCE(?,name), coaching_name=COALESCE(?,coaching_name), phone=COALESCE(?,phone), address=COALESCE(?,address) WHERE id=?`,
      [name||null, coaching_name||null, phone||null, address||null, req.user.id]
    );
    res.json({ success: true, message: 'Profile updated' });
  } catch(err) { next(err); }
});

export default router;

// ─── UNIFIED PROFILE UPDATE (admin/teacher/student) ──────────
router.put('/auth/profile', requireAuth(), async (req, res, next) => {
  try {
    const { id, role } = req.user;
    const { name, phone, coaching_name, subject, qualification } = req.body;
    if (role === 'admin') {
      await query(
        `UPDATE admins SET name=COALESCE(?,name), phone=COALESCE(?,phone), coaching_name=COALESCE(?,coaching_name) WHERE id=?`,
        [name||null, phone||null, coaching_name||null, id]
      );
    } else if (role === 'teacher') {
      await query(
        `UPDATE teachers SET name=COALESCE(?,name), phone=COALESCE(?,phone), subject=COALESCE(?,subject), qualification=COALESCE(?,qualification) WHERE id=?`,
        [name||null, phone||null, subject||null, qualification||null, id]
      );
    } else {
      await query(
        `UPDATE students SET name=COALESCE(?,name), phone=COALESCE(?,phone) WHERE id=?`,
        [name||null, phone||null, id]
      );
    }
    res.json({ success: true, message: 'Profile updated' });
  } catch(err) { next(err); }
});

// ─── MY BATCHES (teacher/student — returns only assigned batches) ─
router.get('/my-batches', requireAuth('teacher','student'), async (req, res, next) => {
  try {
    const { id, role, admin_id } = req.user;
    const adminId = admin_id || id;
    let rows;
    if (role === 'teacher') {
      rows = await query(
        `SELECT b.id, b.name, b.start_time, b.end_time, b.fees_amount, b.fees_frequency, b.max_students,
                c.name as class_name, c.id as class_id,
                COUNT(DISTINCT bs.student_id) as student_count
         FROM batches b
         JOIN classes c ON c.id = b.class_id
         JOIN batch_teachers bt ON bt.batch_id = b.id AND bt.teacher_id = ?
         LEFT JOIN batch_students bs ON bs.batch_id = b.id
         WHERE b.admin_id = ?
         GROUP BY b.id ORDER BY b.name`,
        [id, adminId]
      );
    } else {
      rows = await query(
        `SELECT b.id, b.name, b.start_time, b.end_time, b.fees_amount, b.fees_frequency, b.max_students,
                c.name as class_name, c.id as class_id
         FROM batches b
         JOIN classes c ON c.id = b.class_id
         JOIN batch_students bs ON bs.batch_id = b.id AND bs.student_id = ?
         WHERE b.admin_id = ?
         ORDER BY b.name`,
        [id, adminId]
      );
    }
    res.json({ success: true, data: rows });
  } catch(err) { next(err); }
});
