/**
 * JWT token utilities
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m'; // 15 minutes
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d'; // 7 days

/**
 * Generate access token
 */
export function generateAccessToken(userId, email) {
  return jwt.sign(
    { userId, email, type: 'access' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Generate refresh token
 */
export function generateRefreshToken(userId, email) {
  return jwt.sign(
    { userId, email, type: 'refresh' },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN }
  );
}

/**
 * Verify access token
 */
export function verifyAccessToken(token) {
  try {
    // 🔥 DEBUG: Log token info before verification
    if (process.env.NODE_ENV === 'development') {
      console.log(`[JWT] Verifying token:`, {
        tokenLength: token?.length || 0,
        tokenPreview: token ? `${token.substring(0, 20)}...` : 'none',
        hasSecret: !!JWT_SECRET,
        secretLength: JWT_SECRET?.length || 0,
      });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[JWT] ✅ Token verified:`, {
        userId: decoded.userId,
        email: decoded.email,
        type: decoded.type,
        exp: decoded.exp,
        expiresAt: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : 'none',
      });
    }
    
    return decoded;
  } catch (error) {
    // 🔥 DEBUG: More detailed error info
    if (process.env.NODE_ENV === 'development') {
      console.error(`[JWT] ❌ Token verification failed:`, {
        errorName: error.name,
        errorMessage: error.message,
        tokenLength: token?.length || 0,
        tokenPreview: token ? `${token.substring(0, 30)}...` : 'none',
        isExpired: error.name === 'TokenExpiredError',
        isInvalid: error.name === 'JsonWebTokenError',
      });
    }
    
    // Preserve original error message for better debugging
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error(`Invalid token: ${error.message}`);
    } else {
      throw new Error(`Token verification failed: ${error.message}`);
    }
  }
}

/**
 * Verify refresh token
 */
export function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET);
  } catch (error) {
    throw new Error('Invalid or expired refresh token');
  }
}

/**
 * Get token expiration date
 */
export function getTokenExpiration(expiresIn) {
  const now = new Date();
  const [value, unit] = expiresIn.match(/(\d+)([smhd])/).slice(1);
  const multiplier = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
  return new Date(now.getTime() + parseInt(value) * multiplier);
}


