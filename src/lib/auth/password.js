/**
 * Password hashing utilities
 */

import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

/**
 * Hash password
 */
export async function hashPassword(password) {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify password
 */
export async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}


