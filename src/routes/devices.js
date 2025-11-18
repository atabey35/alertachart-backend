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

    // Validate pushToken is not a placeholder
    if (pushToken.toLowerCase().includes('placeholder')) {
      console.error(`[Device Register Native] ❌ Invalid pushToken provided (contains 'placeholder'): ${pushToken.substring(0, 40)}...`);
      return res.status(400).json({
        error: 'Invalid pushToken: placeholder tokens are not allowed. Please provide a valid push token.',
        invalidToken: true
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
 * Device yoksa otomatik olarak oluşturur (pushToken varsa tam kayıt, yoksa minimal kayıt)
 */
router.post('/link', authenticateToken, async (req, res) => {
  try {
    const { deviceId, pushToken, platform } = req.body;

    // Validation
    if (!deviceId) {
      return res.status(400).json({
        error: 'Missing required field: deviceId'
      });
    }

    const userId = req.user.userId; // From authenticateToken middleware
    console.log(`[Device Link] Linking device ${deviceId} to user ${userId}`, {
      userId,
      email: req.user.email,
      hasCookies: !!req.cookies,
      cookieNames: req.cookies ? Object.keys(req.cookies).join(', ') : 'none',
      hasAccessToken: !!req.cookies?.accessToken,
      accessTokenLength: req.cookies?.accessToken?.length || 0,
    });

    // Initialize database (first time)
    await initPushDatabase();

    // Check if device exists
    let device = await getDevice(deviceId);
    
    // 🔥 CRITICAL: If device doesn't exist, create it automatically
    if (!device) {
      console.log(`[Device Link] Device ${deviceId} not found, creating automatically...`);
      
      // Determine platform from request or default to 'ios'
      const devicePlatform = platform || req.body.platform || 'ios';
      
      // ⚠️ IMPORTANT: Don't create placeholder tokens - only create device if pushToken is provided
      // If pushToken is not provided, we can't create a valid device for push notifications
      if (!pushToken) {
        console.warn(`[Device Link] ⚠️  No pushToken provided for device ${deviceId}. Device will not be created. Push token is required for notifications.`);
        return res.status(400).json({
          error: 'pushToken is required to create a new device. Please provide a valid push token.',
          requiresPushToken: true
        });
      }
      
      // Validate pushToken is not a placeholder
      if (pushToken.toLowerCase().includes('placeholder')) {
        console.error(`[Device Link] ❌ Invalid pushToken provided (contains 'placeholder'): ${pushToken.substring(0, 40)}...`);
        return res.status(400).json({
          error: 'Invalid pushToken: placeholder tokens are not allowed. Please provide a valid push token.',
          invalidToken: true
        });
      }
      
      // Create device with provided pushToken
      device = await upsertDevice(
        deviceId,
        pushToken,
        devicePlatform,
        '1.0.0', // Default app version
        userId, // Link to user immediately
        null, // model
        null  // osVersion
      );
      
      console.log(`✅ Device ${deviceId} created automatically and linked to user ${userId}`);
    } else {
      // Device exists, just update userId
      const { neon } = await import('@neondatabase/serverless');
      if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL environment variable is not set');
      }
      const sql = neon(process.env.DATABASE_URL);
      
      // Update pushToken if provided (and validate it's not a placeholder)
      if (pushToken && pushToken !== device.expo_push_token) {
        // Validate pushToken is not a placeholder
        if (pushToken.toLowerCase().includes('placeholder')) {
          console.error(`[Device Link] ❌ Invalid pushToken provided (contains 'placeholder'): ${pushToken.substring(0, 40)}...`);
          return res.status(400).json({
            error: 'Invalid pushToken: placeholder tokens are not allowed. Please provide a valid push token.',
            invalidToken: true
          });
        }
        
        console.log(`[Device Link] Updating push token for device ${deviceId}`);
        const updateResult = await sql`
          UPDATE devices
          SET user_id = ${userId},
              expo_push_token = ${pushToken},
              updated_at = CURRENT_TIMESTAMP
          WHERE device_id = ${deviceId}
          RETURNING *
        `;
        device = updateResult[0];
      } else {
        // Just update userId
        const updateResult = await sql`
          UPDATE devices
          SET user_id = ${userId},
              updated_at = CURRENT_TIMESTAMP
          WHERE device_id = ${deviceId}
          RETURNING *
        `;
        device = updateResult[0];
      }

      if (!device) {
        return res.status(404).json({
          error: 'Device not found after update'
        });
      }

      console.log(`✅ Device ${deviceId} linked to user ${userId}`);
    }

    res.json({
      success: true,
      device: {
        deviceId: device.device_id,
        platform: device.platform,
        userId: device.user_id,
        linkedAt: device.updated_at,
        hasValidToken: !device.expo_push_token?.toLowerCase().includes('placeholder'), // Indicates if device has valid push token
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

