/**
 * Device management routes
 * Handles native device registration and linking to users
 */

import express from 'express';
import { upsertDevice, getDevice } from '../lib/push/db.js';
import { authenticateToken } from '../lib/auth/middleware.js';
import { initPushDatabase } from '../lib/push/db.js';

const router = express.Router();

/**
 * POST /api/devices/register-native
 * Register native device - AUTH GEREKTİRMEZ
 * Login olmadan cihaz kaydı yapılabilir, login sonrası /api/devices/link ile kullanıcıya bağlanır
 */
router.post('/register-native', async (req, res) => {
  try {
    const { deviceId, pushToken, platform, appVersion } = req.body;

    // Validation
    if (!deviceId || !pushToken || !platform) {
      return res.status(400).json({
        error: 'Missing required fields: deviceId, pushToken, platform'
      });
    }

    console.log(`[Device Register Native] Registering device: ${deviceId} (${platform})`);
    console.log(`[Device Register Native] Token: ${pushToken.substring(0, 30)}...`);

    // Initialize database (first time)
    await initPushDatabase();

    // Upsert device WITHOUT userId (will be linked later via /api/devices/link)
    const device = await upsertDevice(
      deviceId,
      pushToken,
      platform,
      appVersion || '1.0.0',
      null, // userId = null (not linked yet)
      null, // model
      null  // osVersion
    );

    console.log(`✅ Native device registered: ${deviceId} (${platform}) - NOT linked to user yet`);

    res.json({
      success: true,
      device: {
        deviceId: device.device_id,
        platform: device.platform,
        userId: device.user_id, // Should be null
        createdAt: device.created_at,
      },
    });
  } catch (error) {
    console.error('❌ Error registering native device:', error);
    res.status(500).json({
      error: error.message || 'Failed to register native device'
    });
  }
});

/**
 * POST /api/devices/link
 * Link device to user - AUTH GEREKTİRİR
 * Login sonrası çağrılır, deviceId'yi mevcut kullanıcıya bağlar
 */
router.post('/link', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.body;

    // Validation
    if (!deviceId) {
      return res.status(400).json({
        error: 'Missing required field: deviceId'
      });
    }

    const userId = req.user.userId; // From authenticateToken middleware
    console.log(`[Device Link] Linking device ${deviceId} to user ${userId}`);

    // Check if device exists
    const device = await getDevice(deviceId);
    if (!device) {
      return res.status(404).json({
        error: 'Device not found'
      });
    }

    // Update device with userId
    const { neon } = await import('@neondatabase/serverless');
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    const sql = neon(process.env.DATABASE_URL);
    
    const result = await sql`
      UPDATE devices
      SET user_id = ${userId},
          updated_at = CURRENT_TIMESTAMP
      WHERE device_id = ${deviceId}
      RETURNING *
    `;

    const updatedDevice = result[0];

    if (!updatedDevice) {
      return res.status(404).json({
        error: 'Device not found'
      });
    }

    console.log(`✅ Device ${deviceId} linked to user ${userId}`);

    res.json({
      success: true,
      device: {
        deviceId: updatedDevice.device_id,
        platform: updatedDevice.platform,
        userId: updatedDevice.user_id,
        linkedAt: updatedDevice.updated_at,
      },
    });
  } catch (error) {
    console.error('❌ Error linking device:', error);
    res.status(500).json({
      error: error.message || 'Failed to link device'
    });
  }
});

export default router;

