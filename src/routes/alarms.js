/**
 * Alarm notification routes
 */

import express from 'express';
import { getAllActiveDevices, getDevice } from '../lib/push/db.js';
import { getUserDevices, getUserById } from '../lib/auth/db.js';
import { sendAlarmNotification } from '../lib/push/unified-push.js';
import { optionalAuth } from '../lib/auth/middleware.js';

const router = express.Router();

/**
 * POST /api/alarms/notify
 * Send alarm notification to device by deviceId
 * Auth is optional - if deviceId is provided, it's used directly (deviceId is unique)
 * If no deviceId, falls back to user_id-based lookup (requires auth)
 */
router.post('/notify', optionalAuth, async (req, res) => {
  try {
    const { alarmKey, symbol, message, data, pushToken, deviceId } = req.body;
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📨 Alarm notification request received:');
    console.log('  - alarmKey:', alarmKey);
    console.log('  - symbol:', symbol);
    console.log('  - deviceId:', deviceId);
    console.log('  - pushToken:', pushToken ? `${pushToken.substring(0, 30)}...` : 'none');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Validation
    if (!symbol || !message) {
      return res.status(400).json({
        error: 'Missing required fields: symbol, message'
      });
    }

    const userId = req.user?.userId; // Optional - for logging only
    console.log(`🔔 Alarm triggered: ${symbol} - ${message}${alarmKey ? ` (key: ${alarmKey})` : ''}${userId ? ` for user ${userId}` : ''}`);

    let devices = [];
    let targetDeviceInfo = null;

    // 🔥 YENİ YAKLAŞIM: deviceId'ye göre direkt cihazı bul (user_id kontrolü yok)
    // deviceId benzersiz ve alarm kurulurken kaydediliyor, o yüzden güvenli
    if (deviceId) {
      console.log(`🔍 Looking up device by deviceId: ${deviceId}`);
      const targetDevice = await getDevice(deviceId);
      
      if (targetDevice && targetDevice.expo_push_token) {
        // 🔒 PREMIUM CHECK: Check if user has premium access
        // CRITICAL: If user_id is null, we cannot verify premium status, so skip notification
        if (!targetDevice.user_id) {
          console.log(`⚠️ Device ${deviceId} not linked to user (user_id is null) - Cannot verify premium status, skipping notification`);
          console.log(`   💡 User needs to login and link device via /api/devices/link`);
          return res.json({ 
            success: true, 
            message: 'Device not linked to user - cannot verify premium status',
            sent: 0,
            skipped: true,
            reason: 'device_not_linked',
          });
        }
        
        // User is linked, check premium status
        const user = await getUserById(targetDevice.user_id);
        if (!user) {
          console.log(`⚠️ User ${targetDevice.user_id} not found - Skipping notification`);
          return res.json({ 
            success: true, 
            message: 'User not found',
            sent: 0,
            skipped: true,
          });
        }
        
        // Check premium/trial status
        const isPremium = user.plan === 'premium' && (!user.expiry_date || new Date(user.expiry_date) > new Date());
        const isTrial = user.plan === 'free' && user.trial_started_at && user.trial_ended_at && 
                       new Date() >= new Date(user.trial_started_at) && 
                       new Date() < new Date(user.trial_ended_at);
        const hasPremiumAccess = isPremium || isTrial;
        
        if (!hasPremiumAccess) {
          console.log(`🚫 Free user ${targetDevice.user_id} (${user.email}) - Skipping automatic price tracking notification (local alarms still work)`);
          return res.json({ 
            success: true, 
            message: 'Free user - automatic notifications disabled',
            sent: 0,
            skipped: true,
            reason: 'free_user',
          });
        }
        
        console.log(`✅ Premium/Trial user ${targetDevice.user_id} (${user.email}) - Sending notification`);
        
        devices = [targetDevice];
        targetDeviceInfo = `Device ${targetDevice.device_id} (by deviceId)`;
        console.log(`✅ Found device by deviceId: ${deviceId} - Sending notification`);
        console.log(`   Device details: platform=${targetDevice.platform}, user_id=${targetDevice.user_id}, email=${user.email}, plan=${user.plan}, token=${targetDevice.expo_push_token.substring(0, 30)}...`);
      } else {
        console.log(`❌ Device ${deviceId} not found or has no push token`);
        return res.json({ 
          success: true, 
          message: 'Device not found or has no push token',
          sent: 0,
        });
      }
    } else if (pushToken) {
      // Fallback: pushToken ile cihaz bul (eski yöntem)
      console.log(`🔍 Looking up device by pushToken`);
      const allDevices = await getAllActiveDevices();
      const targetDevice = allDevices.find(d => d.expo_push_token === pushToken);
      
      if (targetDevice) {
        devices = [targetDevice];
        targetDeviceInfo = `Device ${targetDevice.device_id} (by pushToken)`;
        console.log(`✅ Found device by pushToken - Sending notification`);
      } else {
        console.log(`❌ Push token not found`);
        return res.json({ 
          success: true, 
          message: 'Device not found',
          sent: 0,
        });
      }
    } else if (userId) {
      // Fallback: user_id ile tüm cihazları bul (eski yöntem)
      const userDevices = await getUserDevices(userId);
      
      if (userDevices.length === 0) {
        console.log(`⚠️ User ${userId} has no registered devices - skipping push notification`);
        return res.json({ 
          success: true, 
          message: 'No devices registered for user',
          sent: 0,
        });
      }
      
      devices = userDevices;
      targetDeviceInfo = `All user devices (${devices.length} device(s))`;
      console.log(`📱 Sending to all ${devices.length} device(s) for user ${userId}`);
    } else {
      console.log(`❌ No deviceId, pushToken, or userId provided`);
      return res.json({ 
        success: true, 
        message: 'No device identifier provided',
        sent: 0,
      });
    }

    // Collect valid push tokens (exclude test tokens)
    // Support both Expo tokens and FCM tokens
    const tokens = devices
      .map(d => d.expo_push_token)
      .filter(token => {
        if (!token) return false;
        // Exclude any test tokens (case-insensitive)
        const lowerToken = token.toLowerCase();
        if (lowerToken.includes('test') || lowerToken === 'unknown') return false;
        // Accept both Expo tokens and FCM tokens
        // Expo: ExponentPushToken[...] or ExpoPushToken[...]
        // FCM: long string without brackets
        return token.length > 10; // Simple validation
      });

    if (tokens.length === 0) {
      console.log('📱 No valid push tokens found');
      return res.json({ 
        success: true, 
        message: 'No valid tokens',
        sent: 0,
      });
    }

    console.log(`📱 Sending alarm notification to ${tokens.length} device(s): ${symbol}${targetDeviceInfo ? ` (${targetDeviceInfo})` : ''}`);

    // Send push notification
    const success = await sendAlarmNotification(
      tokens,
      symbol,
      message,
      data
    );

    if (success) {
      console.log(`✅ Alarm notifications sent to ${tokens.length} devices`);

      res.json({ 
        success: true,
        sent: tokens.length,
        totalDevices: devices.length,
        targetDeviceInfo,
      });
    } else {
      res.status(500).json({
        error: 'Failed to send alarm notifications'
      });
    }
  } catch (error) {
    console.error('❌ Error sending alarm notifications:', error);
    res.status(500).json({
      error: error.message || 'Failed to send alarm notifications'
    });
  }
});

export default router;

