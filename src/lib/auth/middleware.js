/**
 * Authentication middleware
 */

import { verifyAccessToken } from './jwt.js';

/**
 * Middleware to verify JWT access token
 * Supports both Cookie-based (for web/Capacitor) and Authorization header (for native)
 */
export async function authenticateToken(req, res, next) {
  // Try to get token from cookies first (for web/Capacitor), then from Authorization header (for native)
  let token = req.cookies?.accessToken;
  
  // 🔥 CRITICAL FIX: Filter out "undefined", "null" strings, empty strings, and invalid tokens
  // Also check if token is actually a valid JWT (should have 3 parts separated by dots)
  if (!token || 
      token === 'undefined' || 
      token === 'null' || 
      typeof token !== 'string' ||
      token.trim() === '' ||
      token.length < 10) { // JWT tokens are at least 10 characters
    token = null;
  } else {
    // Additional validation: Check if it looks like a JWT (has 3 parts)
    const parts = token.split('.');
    if (parts.length !== 3) {
      token = null;
    }
  }
  
  if (!token) {
    const authHeader = req.headers['authorization'];
    const headerToken = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    if (headerToken && 
        headerToken !== 'undefined' && 
        headerToken !== 'null' &&
        typeof headerToken === 'string' &&
        headerToken.length >= 10 &&
        headerToken.split('.').length === 3) {
      token = headerToken;
    }
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
  
  // 🔥 CRITICAL FIX: Filter out "undefined", "null" strings, empty strings, and invalid tokens
  // Also check if token is actually a valid JWT (should have 3 parts separated by dots)
  if (!token || 
      token === 'undefined' || 
      token === 'null' || 
      typeof token !== 'string' ||
      token.trim() === '' ||
      token.length < 10) { // JWT tokens are at least 10 characters
    token = null;
  } else {
    // Additional validation: Check if it looks like a JWT (has 3 parts)
    const parts = token.split('.');
    if (parts.length !== 3) {
      token = null;
    }
  }
  
  if (!token) {
    const authHeader = req.headers['authorization'];
    const headerToken = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    if (headerToken && 
        headerToken !== 'undefined' && 
        headerToken !== 'null' &&
        typeof headerToken === 'string' &&
        headerToken.length >= 10 &&
        headerToken.split('.').length === 3) {
      token = headerToken;
    }
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
        console.log(`[optionalAuth] ⚠️ Invalid/expired token (ignored for optional auth): ${error.message}`);
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


