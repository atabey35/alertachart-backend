/**
 * Price alerts management routes
 */

import express from 'express';
import {
  createPriceAlert,
  getPriceAlerts,
  deletePriceAlert,
} from '../lib/push/db.js';
import { authenticateToken, optionalAuth } from '../lib/auth/middleware.js';
import { getUserById } from '../lib/auth/db.js';
import { generateAccessToken } from '../lib/auth/jwt.js';
import { getSessionByRefreshToken, verifyRefreshToken } from '../lib/auth/jwt.js';

const router = express.Router();

/**
 * Check if user has premium access
 */
async function checkPremiumAccess(userId) {
  if (!userId) return false;
  
  const user = await getUserById(userId);
  if (!user) return false;
  
  // Premium users (with or without expiry)
  if (user.plan === 'premium') {
    if (!user.expiry_date) return true; // Lifetime premium
    return new Date(user.expiry_date) > new Date();
  }
  
  // Trial users (active trial)
  if (user.plan === 'free' && user.trial_started_at) {
    const trialEnd = user.trial_ended_at 
      ? new Date(user.trial_ended_at)
      : new Date(new Date(user.trial_started_at).getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days
    
    return new Date() < trialEnd;
  }
  
  return false;
}

/**
 * POST /api/alerts/price
 * Create new price alert (PREMIUM ONLY)
 */
router.post('/price', optionalAuth, async (req, res) => {
  try {
    // Debug: Log authentication info
    console.log('[Alerts POST] Request received:', {
      hasCookies: !!req.cookies,
      cookieNames: req.cookies ? Object.keys(req.cookies) : [],
      hasAuthHeader: !!req.headers['authorization'],
      hasUser: !!req.user,
      userId: req.user?.userId,
      userEmail: req.user?.email,
    });

    const { deviceId, symbol, targetPrice, proximityDelta, direction } = req.body;

    // Validation
    if (!deviceId || !symbol || !targetPrice || !proximityDelta || !direction) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    if (!['up', 'down'].includes(direction)) {
      return res.status(400).json({
        error: 'Invalid direction. Must be "up" or "down"'
      });
    }

    // Premium check - if no user, try to refresh token
    let userId = req.user?.userId;
    
    if (!userId && req.cookies?.refreshToken) {
      // Try to refresh access token from refresh token
      try {
        const refreshToken = req.cookies.refreshToken;
        const decoded = verifyRefreshToken(refreshToken);
        const session = await getSessionByRefreshToken(refreshToken);
        
        if (session) {
          // Generate new access token
          const accessToken = generateAccessToken(session.user_id, session.email);
          // Set accessToken cookie
          res.cookie('accessToken', accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 15 * 60 * 1000, // 15 minutes
          });
          
          userId = session.user_id;
          console.log('[Alerts POST] ✅ Token refreshed, userId:', userId);
        }
      } catch (refreshError) {
        console.log('[Alerts POST] ⚠️ Token refresh failed:', refreshError.message);
      }
    }
    
    if (!userId) {
      console.log('[Alerts POST] ❌ No userId found in req.user');
      console.log('[Alerts POST] req.user:', req.user);
      console.log('[Alerts POST] req.cookies:', req.cookies);
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    const hasPremium = await checkPremiumAccess(userId);
    if (!hasPremium) {
      return res.status(403).json({
        error: 'Premium subscription required for custom coin alerts'
      });
    }

    const alert = await createPriceAlert(
      deviceId,
      symbol,
      parseFloat(targetPrice),
      parseFloat(proximityDelta),
      direction,
      userId
    );

    console.log(`✅ Price alert created: ${symbol} @ ${targetPrice} (${direction}) for user ${userId}`);

    res.json({ success: true, alert });
  } catch (error) {
    console.error('Error creating price alert:', error);
    res.status(500).json({
      error: error.message || 'Failed to create price alert'
    });
  }
});

/**
 * GET /api/alerts/price?deviceId=xxx
 * Get all price alerts for device (PREMIUM ONLY)
 */
router.get('/price', optionalAuth, async (req, res) => {
  try {
    const { deviceId } = req.query;

    if (!deviceId) {
      return res.status(400).json({ error: 'Missing deviceId' });
    }

    // Premium check
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    const hasPremium = await checkPremiumAccess(userId);
    if (!hasPremium) {
      return res.status(403).json({
        error: 'Premium subscription required'
      });
    }

    const alerts = await getPriceAlerts(deviceId, userId);

    res.json({ alerts });
  } catch (error) {
    console.error('Error fetching price alerts:', error);
    res.status(500).json({
      error: error.message || 'Failed to fetch price alerts'
    });
  }
});

/**
 * DELETE /api/alerts/price
 * Delete price alert (PREMIUM ONLY)
 */
router.delete('/price', optionalAuth, async (req, res) => {
  try {
    const { id, deviceId } = req.body;

    if (!id || !deviceId) {
      return res.status(400).json({
        error: 'Missing id or deviceId'
      });
    }

    // Premium check
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    const hasPremium = await checkPremiumAccess(userId);
    if (!hasPremium) {
      return res.status(403).json({
        error: 'Premium subscription required'
      });
    }

    // Verify alert belongs to user
    const alerts = await getPriceAlerts(deviceId, userId);
    const alert = alerts.find(a => a.id === parseInt(id));
    
    if (!alert) {
      return res.status(404).json({
        error: 'Alert not found or access denied'
      });
    }

    await deletePriceAlert(parseInt(id), deviceId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting price alert:', error);
    res.status(500).json({
      error: error.message || 'Failed to delete price alert'
    });
  }
});

export default router;


