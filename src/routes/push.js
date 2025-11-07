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
import { sendTestNotification } from '../lib/push/expo-push.js';
import { optionalAuth } from '../lib/auth/middleware.js';

const router = express.Router();

/**
 * POST /api/push/register
 * Register device for push notifications
 * Optional: If user is authenticated, device will be linked to user
 */
router.post('/register', optionalAuth, async (req, res) => {
  try {
    const { deviceId, expoPushToken, platform, appVersion } = req.body;

    // Validation
    if (!deviceId || !expoPushToken || !platform) {
      return res.status(400).json({
        error: 'Missing required fields: deviceId, expoPushToken, platform'
      });
    }

    // Initialize database (first time)
    await initPushDatabase();

    // Get userId from authenticated user (if available)
    const userId = req.user?.userId || null;

    // Upsert device
    const device = await upsertDevice(
      deviceId,
      expoPushToken,
      platform,
      appVersion || '1.0.0',
      userId
    );

    console.log(`✅ Device registered: ${deviceId} (${platform})${userId ? ` for user ${userId}` : ''}`);

    res.json({
      success: true,
      device: {
        deviceId: device.device_id,
        platform: device.platform,
        userId: device.user_id,
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
 */
router.post('/test', async (req, res) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Missing deviceId' });
    }

    const device = await getDevice(deviceId);

    if (!device) {
      return res.status(404).json({
        error: 'Device not found or inactive'
      });
    }

    const success = await sendTestNotification(device.expo_push_token);

    if (success) {
      console.log(`✅ Test notification sent to ${deviceId}`);
      res.json({ success: true });
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


