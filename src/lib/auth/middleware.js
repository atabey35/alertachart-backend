/**
 * Authentication middleware
 */

import { verifyAccessToken } from './jwt.js';

/**
 * Middleware to verify JWT access token
 * Supports both Cookie-based (for web/Capacitor) and Authorization header (for native)
 */
export function authenticateToken(req, res, next) {
  // Try to get token from cookies first (for web/Capacitor), then from Authorization header (for native)
  let token = req.cookies?.accessToken;
  
  if (!token) {
    const authHeader = req.headers['authorization'];
    token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  }

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded; // { userId, email, type: 'access' }
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Optional authentication - doesn't fail if no token
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = verifyAccessToken(token);
      req.user = decoded;
    } catch (error) {
      // Ignore invalid tokens for optional auth
    }
  }

  next();
}


