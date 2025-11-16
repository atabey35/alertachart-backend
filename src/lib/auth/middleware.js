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
 * Supports both Cookie-based (for web/Capacitor) and Authorization header (for native)
 */
export function optionalAuth(req, res, next) {
  // Try to get token from cookies first (for web/Capacitor), then from Authorization header (for native)
  let token = req.cookies?.accessToken;
  
  if (!token) {
    const authHeader = req.headers['authorization'];
    token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  }

  if (token) {
    try {
      const decoded = verifyAccessToken(token);
      req.user = decoded;
      // Optional: log successful authentication (only in development)
      if (process.env.NODE_ENV === 'development') {
        console.log(`[optionalAuth] ✅ Authenticated user: ${decoded.userId}`);
      }
    } catch (error) {
      // Ignore invalid tokens for optional auth - this is expected behavior
      // Don't log errors for optional auth to avoid spam
      if (process.env.NODE_ENV === 'development') {
        console.log(`[optionalAuth] ⚠️ Invalid/expired token (ignored for optional auth)`);
      }
    }
  } else {
    // No token provided - this is fine for optional auth
    if (process.env.NODE_ENV === 'development') {
      console.log(`[optionalAuth] ℹ️ No token provided (optional auth - continuing)`);
    }
  }

  next();
}


