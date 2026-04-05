import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const createDatabase = `CREATE DATABASE IF NOT EXISTS \`coaching_db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;

const tables = [
  // ─── ADMINS ─────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS admins (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    coaching_name VARCHAR(200) NOT NULL,
    coaching_logo VARCHAR(500),
    phone VARCHAR(20),
    address TEXT,
    plan ENUM('free','paid') NOT NULL DEFAULT 'free',
    plan_expires_at DATETIME NULL,
    razorpay_subscription_id VARCHAR(100),
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    email_verified TINYINT(1) NOT NULL DEFAULT 0,
    verification_token VARCHAR(100),
    reset_token VARCHAR(100),
    reset_token_expires DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_plan (plan)
  ) ENGINE=InnoDB`,

  // ─── PLAN PAYMENTS ──────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS plan_payments (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    admin_id INT UNSIGNED NOT NULL,
    razorpay_order_id VARCHAR(100),
    razorpay_payment_id VARCHAR(100),
    razorpay_signature VARCHAR(255),
    amount_paise INT NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    status ENUM('created','paid','failed') NOT NULL DEFAULT 'created',
    plan_type VARCHAR(20) NOT NULL DEFAULT 'paid',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
    INDEX idx_admin (admin_id)
  ) ENGINE=InnoDB`,

  // ─── CLASSES ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS classes (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    admin_id INT UNSIGNED NOT NULL,
    name VARCHAR(100) NOT NULL,
    subjects TEXT,
    description TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
    INDEX idx_admin (admin_id)
  ) ENGINE=InnoDB`,

  // ─── BATCHES ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS batches (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    admin_id INT UNSIGNED NOT NULL,
    class_id INT UNSIGNED NOT NULL,
    name VARCHAR(100) NOT NULL,
    start_time TIME,
    end_time TIME,
    days_of_week VARCHAR(50),
    max_students INT DEFAULT 50,
    fees_amount DECIMAL(10,2) DEFAULT 0,
    fees_frequency ENUM('monthly','quarterly','annually','one-time') DEFAULT 'monthly',
    description TEXT,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
    INDEX idx_admin (admin_id),
    INDEX idx_class (class_id)
  ) ENGINE=InnoDB`,

  // ─── TEACHERS ───────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS teachers (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    admin_id INT UNSIGNED NOT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    subject VARCHAR(200),
    qualification VARCHAR(200),
    salary DECIMAL(10,2) DEFAULT 0,
    photo VARCHAR(500),
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    join_date DATE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_email_admin (email, admin_id),
    INDEX idx_admin (admin_id),
    INDEX idx_status (status)
  ) ENGINE=InnoDB`,

  // ─── STUDENTS ───────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS students (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    admin_id INT UNSIGNED NOT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    parent_name VARCHAR(100),
    parent_phone VARCHAR(20),
    address TEXT,
    photo VARCHAR(500),
    date_of_birth DATE,
    gender ENUM('male','female','other'),
    status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    roll_number VARCHAR(50),
    join_date DATE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_email_admin (email, admin_id),
    INDEX idx_admin (admin_id),
    INDEX idx_status (status)
  ) ENGINE=InnoDB`,

  // ─── BATCH TEACHERS ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS batch_teachers (
    batch_id INT UNSIGNED NOT NULL,
    teacher_id INT UNSIGNED NOT NULL,
    assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (batch_id, teacher_id),
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  // ─── BATCH STUDENTS ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS batch_students (
    batch_id INT UNSIGNED NOT NULL,
    student_id INT UNSIGNED NOT NULL,
    enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (batch_id, student_id),
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  // ─── SCHEDULED CLASSES ──────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS scheduled_classes (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    admin_id INT UNSIGNED NOT NULL,
    batch_id INT UNSIGNED NOT NULL,
    teacher_id INT UNSIGNED NULL,
    title VARCHAR(200),
    description TEXT,
    scheduled_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status ENUM('scheduled','completed','cancelled') NOT NULL DEFAULT 'scheduled',
    meeting_link VARCHAR(500),
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL,
    INDEX idx_admin (admin_id),
    INDEX idx_batch (batch_id),
    INDEX idx_date (scheduled_date)
  ) ENGINE=InnoDB`,

  // ─── ATTENDANCE ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS attendance (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    scheduled_class_id INT UNSIGNED NOT NULL,
    student_id INT UNSIGNED NOT NULL,
    status ENUM('present','absent','late') NOT NULL DEFAULT 'absent',
    remarks VARCHAR(200),
    marked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    marked_by INT UNSIGNED,
    FOREIGN KEY (scheduled_class_id) REFERENCES scheduled_classes(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_class_student (scheduled_class_id, student_id),
    INDEX idx_student (student_id),
    INDEX idx_class (scheduled_class_id)
  ) ENGINE=InnoDB`,

  // ─── TEACHER ATTENDANCE ─────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS teacher_attendance (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    scheduled_class_id INT UNSIGNED NOT NULL,
    teacher_id INT UNSIGNED NOT NULL,
    status ENUM('present','absent','late') NOT NULL DEFAULT 'absent',
    remarks VARCHAR(200),
    marked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (scheduled_class_id) REFERENCES scheduled_classes(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_class_teacher (scheduled_class_id, teacher_id),
    INDEX idx_teacher (teacher_id)
  ) ENGINE=InnoDB`,

  // ─── FEES ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS fees (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    admin_id INT UNSIGNED NOT NULL,
    student_id INT UNSIGNED NOT NULL,
    batch_id INT UNSIGNED NULL,
    amount DECIMAL(10,2) NOT NULL,
    due_date DATE,
    paid_date DATE,
    status ENUM('pending','paid','overdue','partial') NOT NULL DEFAULT 'pending',
    paid_amount DECIMAL(10,2) DEFAULT 0,
    month_year VARCHAR(7),
    description TEXT,
    receipt_number VARCHAR(50) UNIQUE,
    payment_mode VARCHAR(30),
    payment_date DATE,
    transaction_id VARCHAR(100),
    razorpay_order_id VARCHAR(100),
    razorpay_payment_id VARCHAR(100),
    razorpay_signature VARCHAR(255),
    slip_sent TINYINT(1) DEFAULT 0,
    slip_sent_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL,
    INDEX idx_admin (admin_id),
    INDEX idx_student (student_id),
    INDEX idx_status (status),
    INDEX idx_due_date (due_date)
  ) ENGINE=InnoDB`,

  // ─── TEACHER PAYMENTS ───────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS teacher_payments (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    admin_id INT UNSIGNED NOT NULL,
    teacher_id INT UNSIGNED NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_date DATE NOT NULL,
    month_year VARCHAR(7),
    payment_mode ENUM('cash','bank_transfer','upi','cheque') DEFAULT 'bank_transfer',
    transaction_ref VARCHAR(100),
    notes TEXT,
    status ENUM('paid','pending') NOT NULL DEFAULT 'paid',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    INDEX idx_admin (admin_id),
    INDEX idx_teacher (teacher_id)
  ) ENGINE=InnoDB`,

  // ─── STUDY MATERIALS ────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS study_materials (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    admin_id INT UNSIGNED NOT NULL,
    batch_id INT UNSIGNED NULL,
    class_id INT UNSIGNED NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    file_type ENUM('pdf','video','image','other') NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT,
    file_name VARCHAR(255),
    thumbnail VARCHAR(500),
    duration_seconds INT,
    uploaded_by INT UNSIGNED,
    is_active TINYINT(1) DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
    INDEX idx_admin (admin_id),
    INDEX idx_batch (batch_id),
    INDEX idx_type (file_type)
  ) ENGINE=InnoDB`,

  // ─── NOTIFICATIONS ──────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS notifications (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    admin_id INT UNSIGNED NOT NULL,
    recipient_type ENUM('student','teacher','all_students','all_teachers','all') NOT NULL,
    recipient_id INT UNSIGNED,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    is_read TINYINT(1) DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
    INDEX idx_admin (admin_id)
  ) ENGINE=InnoDB`,

  // ─── CONTACT FORM SUBMISSIONS ───────────────────────────────
  `CREATE TABLE IF NOT EXISTS contact_submissions (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    email      VARCHAR(150) NOT NULL,
    subject    VARCHAR(200) NOT NULL,
    message    TEXT NOT NULL,
    status     ENUM('new','read','replied','closed') NOT NULL DEFAULT 'new',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status  (status),
    INDEX idx_email   (email),
    INDEX idx_created (created_at)
  ) ENGINE=InnoDB`,

  // ─── REFRESH TOKENS ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    user_type ENUM('admin','teacher','student') NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id, user_type),
    INDEX idx_expires (expires_at)
  ) ENGINE=InnoDB`,
];

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: false,
  });

  try {
    await conn.query(createDatabase);
    await conn.query('USE `coaching_management`');
    console.log('📦 Database selected');

    for (const sql of tables) {
      const tableName = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
      await conn.query(sql);
      console.log(`✅ Table ready: ${tableName}`);
    }

    console.log('\n🎉 All tables created successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    await conn.end();
  }
}

migrate().catch(() => process.exit(1));
