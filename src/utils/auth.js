import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/db.js';

const SALT_ROUNDS = 12;

export const hashPassword = (plain) => bcrypt.hash(plain, SALT_ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

export function generateTokens(payload) {
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    issuer: 'coaching-management',
    audience: 'coaching-app',
  });

  const refreshToken = jwt.sign(
    { ...payload, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
  );

  return { accessToken, refreshToken };
}

export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, {
    issuer: 'coaching-management',
    audience: 'coaching-app',
  });
}

export function verifyRefreshToken(token) {
  return jwt.verify(
    token,
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
  );
}

export async function saveRefreshToken(userId, userType, token) {
  const tokenHash = await bcrypt.hash(token, 8);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO refresh_tokens (user_id, user_type, token_hash, expires_at) VALUES (?,?,?,?)`,
    [uuidv4(), userId, userType, tokenHash, expiresAt]
  );
}

export async function revokeRefreshTokensByUser(userId, userType) {
  await query(
    `DELETE FROM refresh_tokens WHERE user_id=? AND user_type=?`,
    [userId, userType]
  );
}

export function generateSecureToken() {
  return uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
}
