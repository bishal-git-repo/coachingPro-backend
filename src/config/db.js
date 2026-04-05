import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'coaching_management',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  // Security settings
  multipleStatements: false,
  dateStrings: true,
  // collation: 'UTF8MB4_UNICODE_CI',              // ← add this
  // charset: 'UTF8MB4_UNICODE_CI',              // ← add this
  // timezone: '+00:00', 
};

const pool = mysql.createPool(poolConfig);

// ✅ Add this — forces utf8mb4 on every new connection
// pool.pool.on('connection', (connection) => {
//   connection.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
// });

// Test connection on startup
export async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ MySQL connected successfully');
    conn.release();
    return true;
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
    throw err;
  }
}

// Helper: execute query with automatic connection management
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

// Helper: transaction wrapper
export async function withTransaction(callback) {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export default pool;
