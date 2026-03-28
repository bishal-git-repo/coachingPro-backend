import { verifyAccessToken } from '../utils/auth.js';
import { query } from '../config/db.js';

export function requireAuth(...allowedRoles) {
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'No token provided' });
      }

      const token = authHeader.split(' ')[1];
      const decoded = verifyAccessToken(token);

      if (allowedRoles.length && !allowedRoles.includes(decoded.role)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      let user;
      if (decoded.role === 'admin') {
        const rows = await query(
          `SELECT id, name, email, coaching_name, plan, plan_expires_at, is_active FROM admins WHERE id=?`,
          [decoded.id]
        );
        user = rows[0];
        if (!user?.is_active) {
          return res.status(403).json({ success: false, message: 'Account suspended' });
        }
      } else if (decoded.role === 'teacher') {
        const rows = await query(
          `SELECT id, name, email, admin_id, status FROM teachers WHERE id=?`,
          [decoded.id]
        );
        user = rows[0];
        if (user?.status !== 'active') {
          return res.status(403).json({ success: false, message: 'Account inactive. Contact your coaching admin.' });
        }
      } else if (decoded.role === 'student') {
        const rows = await query(
          `SELECT id, name, email, admin_id, status FROM students WHERE id=?`,
          [decoded.id]
        );
        user = rows[0];
        if (user?.status !== 'active') {
          return res.status(403).json({ success: false, message: 'Account inactive. Contact your coaching admin.' });
        }
      }

      if (!user) {
        return res.status(401).json({ success: false, message: 'User not found' });
      }

      req.user = { ...decoded, ...user };
      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
  };
}

export function requirePaidPlan(req, res, next) {
  if (req.user.role !== 'admin') return next();
  if (req.user.plan !== 'paid') {
    return res.status(402).json({
      success: false,
      message: 'This feature requires a Paid Plan (Rs.999/month). Please upgrade.',
      code: 'UPGRADE_REQUIRED',
    });
  }
  if (req.user.plan_expires_at && new Date(req.user.plan_expires_at) < new Date()) {
    return res.status(402).json({
      success: false,
      message: 'Your paid plan has expired. Please renew.',
      code: 'PLAN_EXPIRED',
    });
  }
  next();
}

// Plain function (NOT async) that returns a middleware — fixes the "got [object Promise]" error
export function checkFreeplanLimits(type) {
  return async (req, res, next) => {
    try {
      if (req.user.plan === 'paid') return next();
      const adminId = req.user.id;
      if (type === 'student') {
        const [{ cnt }] = await query(`SELECT COUNT(*) as cnt FROM students WHERE admin_id=?`, [adminId]);
        if (cnt >= 50) {
          return res.status(402).json({
            success: false,
            message: 'Free plan limit: 50 students. Upgrade to Paid Plan for unlimited students.',
            code: 'LIMIT_REACHED',
          });
        }
      } else if (type === 'teacher') {
        const [{ cnt }] = await query(`SELECT COUNT(*) as cnt FROM teachers WHERE admin_id=?`, [adminId]);
        if (cnt >= 5) {
          return res.status(402).json({
            success: false,
            message: 'Free plan limit: 5 teachers. Upgrade to Paid Plan for unlimited teachers.',
            code: 'LIMIT_REACHED',
          });
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
