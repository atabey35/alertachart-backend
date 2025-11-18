/**
 * Authentication routes
 */

import express from 'express';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import appleSignin from 'apple-signin-auth';
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

// Google OAuth Client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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
 * Supports both Cookie-based and Authorization header authentication
 */
router.get('/me', async (req, res) => {
  try {
    // Try to get token from cookies first (for web/Capacitor), then from Authorization header (for native)
    let token = req.cookies?.accessToken;
    
    // 🔥 CRITICAL FIX: Filter out "undefined" string (common bug when cookie is set with undefined value)
    if (token === 'undefined' || token === 'null' || !token || token.trim() === '') {
      token = null;
    }
    
    let tokenSource = token ? 'cookie' : null;
    
    if (!token) {
      const authHeader = req.headers['authorization'];
      const headerToken = authHeader && authHeader.split(' ')[1];
      if (headerToken && headerToken !== 'undefined' && headerToken !== 'null') {
        token = headerToken;
        tokenSource = 'header';
      }
    }

    // 🔥 DEBUG: Log token info (without exposing full token)
    console.log(`[Auth /me] Token check:`, {
      hasCookie: !!req.cookies?.accessToken,
      hasAuthHeader: !!req.headers['authorization'],
      tokenLength: token ? token.length : 0,
      tokenPreview: token ? `${token.substring(0, 20)}...${token.substring(token.length - 10)}` : 'none',
      tokenSource: tokenSource || 'none',
      cookieNames: req.cookies ? Object.keys(req.cookies).join(', ') : 'none',
    });

    if (!token) {
      console.log(`[Auth /me] ❌ No token found in cookies or Authorization header`);
      return res.status(401).json({
        error: 'Access token required'
      });
    }

    const { verifyAccessToken } = await import('../lib/auth/jwt.js');
    
    // 🔥 DEBUG: Try to decode token to see what's wrong
    try {
      const decoded = verifyAccessToken(token);
      console.log(`[Auth /me] ✅ Token verified: userId=${decoded.userId}, email=${decoded.email}`);
      
      const user = await getUserById(decoded.userId);
      if (!user) {
        console.log(`[Auth /me] ❌ User not found: userId=${decoded.userId}`);
        return res.status(404).json({
          error: 'User not found'
        });
      }

      console.log(`[Auth /me] ✅ User found: ${user.email} (ID: ${user.id})`);
      
      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          provider: user.provider,
          plan: user.plan,
          expiryDate: user.expiry_date,
          createdAt: user.created_at,
          lastLoginAt: user.last_login_at,
        },
      });
    } catch (verifyError) {
      // 🔥 DEBUG: Log detailed error info
      console.error(`[Auth /me] ❌ Token verification failed:`, {
        error: verifyError.message,
        errorName: verifyError.name,
        tokenLength: token.length,
        tokenPreview: `${token.substring(0, 30)}...`,
        // Check if it's a JWT format issue
        isJWTFormat: token.split('.').length === 3,
        jwtParts: token.split('.').map((part, i) => `part${i}: ${part.length} chars`).join(', '),
      });
      
      // Re-throw to be caught by outer catch
      throw verifyError;
    }
  } catch (error) {
    console.error('[Auth /me] ❌ Error getting user info:', error);
    console.error('[Auth /me] Error stack:', error.stack);
    
    // More specific error messages
    let errorMessage = 'Invalid or expired token';
    if (error.message.includes('expired')) {
      errorMessage = 'Token has expired. Please login again.';
    } else if (error.message.includes('invalid')) {
      errorMessage = 'Invalid token format. Please login again.';
    } else if (error.message.includes('secret')) {
      errorMessage = 'Token verification failed. Server configuration issue.';
    }
    
    res.status(401).json({
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/auth/google/mobile
 * Google OAuth mobile app login
 * Receives authorization code from mobile app and exchanges it for tokens
 */
router.post('/google/mobile', async (req, res) => {
  try {
    const { code, redirectUri } = req.body;

    if (!code || !redirectUri) {
      return res.status(400).json({
        error: 'Authorization code and redirect URI are required'
      });
    }

    // Exchange authorization code for access token from Google
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      console.error('Google OAuth credentials not configured');
      return res.status(500).json({
        error: 'Google OAuth not configured'
      });
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[Google OAuth] Token exchange failed:', errorText);
      return res.status(401).json({
        error: 'Failed to exchange authorization code'
      });
    }

    const tokenData = await tokenResponse.json();
    const { access_token, id_token } = tokenData;

    if (!access_token) {
      return res.status(401).json({
        error: 'No access token received from Google'
      });
    }

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${access_token}`
      },
    });

    if (!userInfoResponse.ok) {
      console.error('[Google OAuth] Failed to get user info');
      return res.status(401).json({
        error: 'Failed to get user info from Google'
      });
    }

    const googleUser = await userInfoResponse.json();
    const { email, name, id: googleId, picture } = googleUser;

    if (!email) {
      return res.status(400).json({
        error: 'No email received from Google'
      });
    }

    // Find or create user in database
    let user = await getUserByEmail(email);
    
    if (!user) {
      // Create new user with Google provider
      // Note: password_hash is required, we'll set a random hash for OAuth users
      const { hashPassword } = await import('../lib/auth/password.js');
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const passwordHash = await hashPassword(randomPassword);
      
      // Create user (assuming createUser accepts provider info)
      // For now, we'll just create with email and password
      user = await createUser(email, passwordHash, name || null);
      console.log('[Google OAuth] Created new user:', email);
    } else {
      // Update last login
      await updateUserLastLogin(user.id);
    }

    // Generate JWT tokens
    const accessToken = generateAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, user.email);

    // Create session
    const expiresAt = getTokenExpiration(process.env.JWT_REFRESH_EXPIRES_IN || '7d');
    const deviceId = req.body.deviceId || null;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent');

    await createSession(user.id, refreshToken, deviceId, ipAddress, userAgent, expiresAt);

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
    console.error('[Google OAuth] Error:', error);
    res.status(500).json({
      error: error.message || 'Failed to authenticate with Google'
    });
  }
});

/**
 * POST /api/auth/session
 * Create session from token (for WebView)
 * Converts native app token to session cookie
 */
router.post('/session', async (req, res) => {
  try {
    const token = req.body.token || req.headers['authorization']?.replace('Bearer ', '');

    if (!token) {
      return res.status(400).json({
        error: 'Token is required'
      });
    }

    // Verify token
    const { verifyAccessToken } = await import('../lib/auth/jwt.js');
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (error) {
      return res.status(401).json({
        error: 'Invalid or expired token'
      });
    }

    // Get user
    const user = await getUserById(decoded.userId);
    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Set httpOnly cookies for secure token storage
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      domain: isProduction ? '.alertachart.com' : undefined,
      path: '/',
    };

    // Generate new access token for cookie (optional, can reuse existing)
    const accessToken = generateAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, user.email);

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
    });
  } catch (error) {
    console.error('[Session] Error:', error);
    res.status(500).json({
      error: error.message || 'Failed to create session'
    });
  }
});

/**
 * POST /api/auth/google-native
 * Google Sign-In for native Capacitor apps
 * Verifies Google ID token from native SDK
 */
router.post('/google-native', async (req, res) => {
  try {
    const { idToken, email, name, imageUrl } = req.body;

    if (!idToken) {
      return res.status(400).json({
        error: 'ID token is required'
      });
    }

    console.log('[Google Native] Verifying token for:', email);

    // Verify Google ID token
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
      console.log('[Google Native] Token verified:', payload.email);
    } catch (error) {
      console.error('[Google Native] Token verification failed:', error);
      return res.status(401).json({
        error: 'Invalid Google token'
      });
    }

    const userEmail = payload.email || email;
    const userName = payload.name || name;

    if (!userEmail) {
      return res.status(400).json({
        error: 'No email received from Google'
      });
    }

    // Find or create user
    let user = await getUserByEmail(userEmail);
    
    if (!user) {
      // Create new user with random password (OAuth users don't need password)
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const passwordHash = await hashPassword(randomPassword);
      user = await createUser(userEmail, passwordHash, userName || null, 'google', payload.sub);
      console.log('[Google Native] Created new user:', userEmail);
    } else {
      // Update last login
      await updateUserLastLogin(user.id);
      console.log('[Google Native] Existing user logged in:', userEmail);
    }

    // Generate JWT tokens
    const accessToken = generateAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, user.email);

    // Create session
    const expiresAt = getTokenExpiration(process.env.JWT_REFRESH_EXPIRES_IN || '7d');
    const deviceId = req.body.deviceId || null;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent');

    await createSession(user.id, refreshToken, deviceId, ipAddress, userAgent, expiresAt);

    // Set cookies for web compatibility
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
      tokens: {
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    console.error('[Google Native] Error:', error);
    res.status(500).json({
      error: error.message || 'Failed to authenticate with Google'
    });
  }
});

/**
 * POST /api/auth/apple-native
 * Apple Sign-In for native Capacitor apps
 * Verifies Apple identity token from native SDK
 */
router.post('/apple-native', async (req, res) => {
  try {
    const { identityToken, authorizationCode, email, givenName, familyName } = req.body;

    if (!identityToken) {
      return res.status(400).json({
        error: 'Identity token is required'
      });
    }

    console.log('[Apple Native] Verifying token...');

    // Verify Apple identity token
    let appleUser;
    try {
      appleUser = await appleSignin.verifyIdToken(identityToken, {
        audience: process.env.APPLE_CLIENT_ID || 'com.kriptokirmizi.alerta',
        ignoreExpiration: false,
      });
      console.log('[Apple Native] Token verified:', appleUser.email || email);
    } catch (error) {
      console.error('[Apple Native] Token verification failed:', error);
      return res.status(401).json({
        error: 'Invalid Apple token'
      });
    }

    const userEmail = appleUser.email || email;
    const userName = givenName && familyName ? `${givenName} ${familyName}` : null;

    if (!userEmail) {
      return res.status(400).json({
        error: 'No email received from Apple'
      });
    }

    // Find or create user
    let user = await getUserByEmail(userEmail);
    
    if (!user) {
      // Create new user with random password (OAuth users don't need password)
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const passwordHash = await hashPassword(randomPassword);
      user = await createUser(userEmail, passwordHash, userName || null, 'apple', appleUser.sub);
      console.log('[Apple Native] Created new user:', userEmail);
    } else {
      // Update last login
      await updateUserLastLogin(user.id);
      console.log('[Apple Native] Existing user logged in:', userEmail);
    }

    // Generate JWT tokens
    const accessToken = generateAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id, user.email);

    // Create session
    const expiresAt = getTokenExpiration(process.env.JWT_REFRESH_EXPIRES_IN || '7d');
    const deviceId = req.body.deviceId || null;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('user-agent');

    await createSession(user.id, refreshToken, deviceId, ipAddress, userAgent, expiresAt);

    // Set cookies for web compatibility
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
      tokens: {
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    console.error('[Apple Native] Error:', error);
    res.status(500).json({
      error: error.message || 'Failed to authenticate with Apple'
    });
  }
});

export default router;


