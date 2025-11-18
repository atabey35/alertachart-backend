/**
 * Push notification management routes
 */

import express from 'express';
import { 
  initPushDatabase, 
  upsertDevice, 
  getDevice, 
  deactivateDevice 
} from '../lib/push/db.js';
import { sendTestNotification } from '../lib/push/unified-push.js';
import { optionalAuth } from '../lib/auth/middleware.js';

const router = express.Router();

/**
 * POST /api/push/register
 * Register device for push notifications
 * Optional: If user is authenticated, device will be linked to user
 */
router.post('/register', optionalAuth, async (req, res) => {
  try {
    const { deviceId, token, expoPushToken, platform, appVersion, model, osVersion } = req.body;

    // Support both 'token' (FCM) and 'expoPushToken' (legacy Expo)
    const pushToken = token || expoPushToken;

    // Validation
    if (!deviceId || !pushToken || !platform) {
      return res.status(400).json({
        error: 'Missing required fields: deviceId, token (or expoPushToken), platform'
      });
    }

    console.log(`[Push Register] Registering device: ${deviceId} (${platform})`);
    console.log(`[Push Register] Token type: ${token ? 'FCM' : 'Expo'}`);
    console.log(`[Push Register] Token: ${pushToken.substring(0, 30)}...`);

    // Initialize database (first time)
    await initPushDatabase();

    // Get userId from authenticated user (if available)
    const userId = req.user?.userId || null;
    
    // 🔥 DEBUG: Log authentication status
    if (userId) {
      console.log(`[Push Register] ✅ User authenticated: ${userId} (${req.user?.email || 'no email'})`);
    } else {
      console.log(`[Push Register] ⚠️  No user authentication - device will be registered without user_id`);
      console.log(`[Push Register]    Cookies: ${req.cookies ? Object.keys(req.cookies).join(', ') : 'none'}`);
      console.log(`[Push Register]    Auth header: ${req.headers['authorization'] ? 'present' : 'none'}`);
    }

    // Upsert device
    const device = await upsertDevice(
      deviceId,
      pushToken,
      platform,
      appVersion || '1.0.0',
      userId,
      model || 'Unknown',
      osVersion || 'Unknown'
    );

    console.log(`✅ Device registered: ${deviceId} (${platform})${userId ? ` for user ${userId}` : ' (not linked - will be linked on login)'}`);

    res.json({
      success: true,
      device: {
        deviceId: device.device_id,
        platform: device.platform,
        userId: device.user_id,
        tokenType: token ? 'fcm' : 'expo',
        createdAt: device.created_at,
      },
    });
  } catch (error) {
    console.error('Error registering push token:', error);
    res.status(500).json({
      error: error.message || 'Failed to register push token'
    });
  }
});

/**
 * POST /api/push/unregister
 * Unregister device
 */
router.post('/unregister', async (req, res) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Missing deviceId' });
    }

    await deactivateDevice(deviceId);

    console.log(`✅ Device unregistered: ${deviceId}`);

    res.json({ success: true });
  } catch (error) {
    console.error('Error unregistering push token:', error);
    res.status(500).json({
      error: error.message || 'Failed to unregister push token'
    });
  }
});

/**
 * POST /api/push/test
 * Send test push notification
 * Can use either deviceId or direct token
 */
router.post('/test', async (req, res) => {
  try {
    const { deviceId, token } = req.body;

    let pushToken = token;

    // If deviceId provided, get token from database
    if (deviceId && !token) {
    const device = await getDevice(deviceId);

    if (!device) {
      return res.status(404).json({
        error: 'Device not found or inactive'
      });
    }

      pushToken = device.expo_push_token;
    }

    if (!pushToken) {
      return res.status(400).json({ error: 'Missing deviceId or token' });
    }

    console.log(`[Test Push] Sending to token: ${pushToken.substring(0, 30)}...`);
    const success = await sendTestNotification(pushToken);

    if (success) {
      console.log(`✅ Test notification sent successfully`);
      res.json({ 
        success: true,
        tokenType: pushToken.startsWith('ExponentPushToken') || pushToken.startsWith('ExpoPushToken') ? 'expo' : 'fcm'
      });
    } else {
      res.status(500).json({
        error: 'Failed to send test notification'
      });
    }
  } catch (error) {
    console.error('Error sending test push:', error);
    res.status(500).json({
      error: error.message || 'Failed to send test notification'
    });
  }
});

export default router;


