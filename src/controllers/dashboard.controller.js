import { query } from '../config/db.js';

export async function getAdminDashboard(req, res) {
  const adminId = req.user.id;

  // Bug 6 fix: Update overdue status FIRST so the count query reflects reality
  await query(`UPDATE fees SET status='overdue' WHERE admin_id=? AND status='pending' AND due_date < CURDATE()`, [adminId]);

  const [
    [{ students }], [{ teachers }], [{ classes }], [{ batches }],
    [feeSummary], recentStudents, upcomingClasses, overdueFeesData, teacherPaymentsSummary
  ] = await Promise.all([
    query(`SELECT COUNT(*) as students FROM students WHERE admin_id=?`, [adminId]),
    query(`SELECT COUNT(*) as teachers FROM teachers WHERE admin_id=?`, [adminId]),
    query(`SELECT COUNT(*) as classes FROM classes WHERE admin_id=?`, [adminId]),
    query(`SELECT COUNT(*) as batches FROM batches WHERE admin_id=?`, [adminId]),
    query(`SELECT SUM(amount) as total, SUM(CASE WHEN status='paid' THEN paid_amount ELSE 0 END) as collected,
           SUM(CASE WHEN status IN('pending','overdue') THEN amount ELSE 0 END) as pending
           FROM fees WHERE admin_id=?`, [adminId]),
    query(`SELECT id, name, email, join_date, status FROM students WHERE admin_id=? ORDER BY created_at DESC LIMIT 5`, [adminId]),
    query(`SELECT sc.*, b.name as batch_name FROM scheduled_classes sc
           JOIN batches b ON b.id = sc.batch_id
           WHERE sc.admin_id=? AND sc.scheduled_date >= CURDATE() AND sc.status='scheduled'
           ORDER BY sc.scheduled_date, sc.start_time LIMIT 5`, [adminId]),
    query(`SELECT COUNT(*) as overdue FROM fees WHERE admin_id=? AND status='overdue'`, [adminId]),
    query(`SELECT SUM(amount) as total_paid FROM teacher_payments WHERE admin_id=? AND MONTH(payment_date)=MONTH(CURDATE()) AND YEAR(payment_date)=YEAR(CURDATE())`, [adminId]),
  ]);

  res.json({
    success: true,
    data: {
      stats: {
        students, teachers, classes, batches,
        fees: feeSummary,
        overdueFees: overdueFeesData[0]?.overdue || 0,
        teacherPaymentsThisMonth: teacherPaymentsSummary[0]?.total_paid || 0,
      },
      recentStudents,
      upcomingClasses,
    },
  });
}

export async function getStudentDashboard(req, res) {
  const studentId = req.user.id;

  const [batches, fees, upcomingClasses, attendanceSummary] = await Promise.all([
    query(`SELECT b.name, b.start_time, b.end_time, b.days_of_week, c.name as class_name
           FROM batches b JOIN classes c ON c.id=b.class_id JOIN batch_students bs ON bs.batch_id=b.id
           WHERE bs.student_id=?`, [studentId]),
    query(`SELECT * FROM fees WHERE student_id=? ORDER BY due_date DESC LIMIT 10`, [studentId]),
    query(`SELECT sc.*, b.name as batch_name FROM scheduled_classes sc
           JOIN batches b ON b.id=sc.batch_id JOIN batch_students bs ON bs.batch_id=b.id
           WHERE bs.student_id=? AND sc.scheduled_date >= CURDATE() AND sc.status='scheduled'
           ORDER BY sc.scheduled_date, sc.start_time LIMIT 5`, [studentId]),
    query(`SELECT COUNT(*) as total, SUM(status='present') as present
           FROM attendance WHERE student_id=?`, [studentId]),
  ]);

  const summary = attendanceSummary[0];
  const attendancePct = summary.total > 0
    ? Math.round((summary.present / summary.total) * 100)
    : 0;

  res.json({
    success: true,
    data: {
      batches,
      fees,
      upcomingClasses,
      attendance: { ...summary, percentage: attendancePct },
    },
  });
}

export async function getTeacherDashboard(req, res) {
  const teacherId = req.user.id;

  const [batches, upcomingClasses, attendanceSummary, payments] = await Promise.all([
    query(`SELECT b.id, b.name, b.start_time, b.end_time, c.name as class_name,
           COUNT(bs.student_id) as student_count
           FROM batches b JOIN classes c ON c.id=b.class_id
           JOIN batch_teachers bt ON bt.batch_id=b.id
           LEFT JOIN batch_students bs ON bs.batch_id=b.id
           WHERE bt.teacher_id=? GROUP BY b.id`, [teacherId]),
    query(`SELECT sc.*, b.name as batch_name, c.name as class_name
           FROM scheduled_classes sc
           JOIN batches b ON b.id=sc.batch_id
           JOIN classes c ON c.id=b.class_id
           JOIN batch_teachers bt ON bt.batch_id=sc.batch_id
           WHERE bt.teacher_id=? AND sc.scheduled_date >= CURDATE() AND sc.status='scheduled'
           ORDER BY sc.scheduled_date, sc.start_time LIMIT 5`, [teacherId]),
    query(`SELECT COUNT(*) as total, SUM(status='present') as present
           FROM teacher_attendance WHERE teacher_id=?`, [teacherId]),
    query(`SELECT * FROM teacher_payments WHERE teacher_id=? ORDER BY payment_date DESC LIMIT 5`, [teacherId]),
  ]);

  const summary = attendanceSummary[0];
  const attendancePct = summary.total > 0
    ? Math.round((summary.present / summary.total) * 100) : 0;

  res.json({
    success: true,
    data: {
      batches,
      upcomingClasses,
      attendance: { ...summary, percentage: attendancePct },
      payments,
    },
  });
}
