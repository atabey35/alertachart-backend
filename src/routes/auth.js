/**
 * Authentication routes
 */

import express from 'express';
import { hashPassword, verifyPassword } from '../lib/auth/password.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, getTokenExpiration } from '../lib/auth/jwt.js';
import {
  createUser,
  getUserByEmail,
  getUserById,
  updateUserLastLogin,
  createSession,
  getSessionByRefreshToken,
  deleteSession,
  deleteUserSessions,
} from '../lib/auth/db.js';

const router = express.Router();

/**
 * POST /api/auth/register
 * Register new user
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'Invalid email format'
      });
    }

    // Password validation (min 6 characters)
    if (password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters'
      });
    }

    // Check if user already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({
        error: 'User with this email already exists'
      });
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const user = await createUser(email, passwordHash, name || null);

    // Generate tokens
    const accessToken = generateAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, user.email);

    // Create session
    const expiresAt = getTokenExpiration(process.env.JWT_REFRESH_EXPIRES_IN || '7d');
    const deviceId = req.body.deviceId || null;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent');

    await createSession(user.id, refreshToken, deviceId, ipAddress, userAgent, expiresAt);

    // Update last login
    await updateUserLastLogin(user.id);

    // Set httpOnly cookies for secure token storage across subdomains
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      domain: isProduction ? '.alertachart.com' : undefined,
      path: '/',
    };

    res.cookie('accessToken', accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie('refreshToken', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      token: accessToken,
    });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({
      error: error.message || 'Failed to register user'
    });
  }
});

/**
 * POST /api/auth/login
 * Login user
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    // Get user
    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, user.email);

    // Create session
    const expiresAt = getTokenExpiration(process.env.JWT_REFRESH_EXPIRES_IN || '7d');
    const deviceId = req.body.deviceId || null;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent');

    await createSession(user.id, refreshToken, deviceId, ipAddress, userAgent, expiresAt);

    // Update last login
    await updateUserLastLogin(user.id);

    // Set httpOnly cookies for secure token storage across subdomains
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      domain: isProduction ? '.alertachart.com' : undefined,
      path: '/',
    };

    res.cookie('accessToken', accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie('refreshToken', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      token: accessToken,
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({
      error: error.message || 'Failed to login'
    });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: 'Refresh token is required'
      });
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (error) {
      return res.status(403).json({
        error: 'Invalid or expired refresh token'
      });
    }

    // Check session in database
    const session = await getSessionByRefreshToken(refreshToken);
    if (!session) {
      return res.status(403).json({
        error: 'Session not found or expired'
      });
    }

    // Generate new access token
    const accessToken = generateAccessToken(session.user_id, session.email);

    res.json({
      success: true,
      tokens: {
        accessToken,
        refreshToken, // Keep the same refresh token
      },
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).json({
      error: error.message || 'Failed to refresh token'
    });
  }
});

/**
 * POST /api/auth/logout
 * Logout user (delete session)
 */
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const cookieRefreshToken = req.cookies?.refreshToken;

    if (refreshToken || cookieRefreshToken) {
      await deleteSession(refreshToken || cookieRefreshToken);
    }

    // Clear cookies
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      domain: isProduction ? '.alertachart.com' : undefined,
      path: '/',
    };

    res.clearCookie('accessToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Error logging out:', error);
    res.status(500).json({
      error: error.message || 'Failed to logout'
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        error: 'Access token required'
      });
    }

    const { verifyAccessToken } = await import('../lib/auth/jwt.js');
    const decoded = verifyAccessToken(token);

    const user = await getUserById(decoded.userId);
    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at,
      },
    });
  } catch (error) {
    console.error('Error getting user info:', error);
    res.status(401).json({
      error: 'Invalid or expired token'
    });
  }
});

export default router;


