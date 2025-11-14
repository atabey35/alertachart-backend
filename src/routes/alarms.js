/**
 * Alarm notification routes
 */

import express from 'express';
import { getAllActiveDevices, getDevice } from '../lib/push/db.js';
import { getUserDevices } from '../lib/auth/db.js';
import { sendAlarmNotification } from '../lib/push/unified-push.js';
import { authenticateToken } from '../lib/auth/middleware.js';

const router = express.Router();

/**
 * POST /api/alarms/notify
 * Send alarm notification to user's devices only
 * Requires authentication - sends only to the authenticated user's devices
 */
router.post('/notify', authenticateToken, async (req, res) => {
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

    const userId = req.user.userId; // From authenticateToken middleware
    console.log(`🔔 Alarm triggered: ${symbol} - ${message}${alarmKey ? ` (key: ${alarmKey})` : ''} for user ${userId}`);

    let devices = [];
    let targetDeviceInfo = null;

    // Get user's devices
    const userDevices = await getUserDevices(userId);
    
    if (userDevices.length === 0) {
      console.log(`⚠️ User ${userId} has no registered devices - skipping push notification`);
      return res.json({ 
        success: true, 
        message: 'No devices registered for user',
        sent: 0,
      });
    }

    // Priority 1: deviceId (most specific - alarm was created on this device)
    // Eğer deviceId varsa, SADECE o cihaza gönder (ama kullanıcının cihazı olmalı)
    if (deviceId) {
      console.log(`🔍 Looking up device with deviceId: ${deviceId} for user ${userId}`);
      const targetDevice = userDevices.find(d => d.device_id === deviceId);
      
      if (targetDevice) {
        devices = [targetDevice];
        targetDeviceInfo = `Device ${targetDevice.device_id} (by deviceId)`;
        console.log(`✅ Found device by deviceId: ${deviceId} - Sending ONLY to this device`);
        console.log(`   Device details: platform=${targetDevice.platform}, token=${targetDevice.expo_push_token.substring(0, 30)}...`);
      } else {
        console.log(`❌ Device ${deviceId} not found or doesn't belong to user ${userId} - NOT sending to any device`);
        console.log(`   🔒 SECURITY: deviceId provided but not found in user's devices`);
        return res.json({ 
          success: true, 
          message: 'Device not found or not owned by user',
          sent: 0,
        });
      }
    } else if (pushToken) {
      // Priority 2: pushToken (sadece deviceId yoksa)
      // Find device by push token (must belong to user)
      const targetDevice = userDevices.find(d => d.expo_push_token === pushToken);
      
      if (targetDevice) {
        devices = [targetDevice];
        targetDeviceInfo = `Device ${targetDevice.device_id} (by pushToken)`;
        console.log(`✅ Found device by pushToken - Sending ONLY to this device`);
    } else {
        console.log(`❌ Push token not found or doesn't belong to user ${userId} - NOT sending to any device`);
      return res.json({ 
        success: true, 
          message: 'Device not found or not owned by user',
        sent: 0,
      });
      }
    } else {
      // Priority 3: Send to all user's devices
      devices = userDevices;
      targetDeviceInfo = `All user devices (${devices.length} device(s))`;
      console.log(`📱 Sending to all ${devices.length} device(s) for user ${userId}`);
    }

    // Collect valid push tokens (exclude test tokens)
    const tokens = devices
      .map(d => d.expo_push_token)
      .filter(token => {
        if (!token) return false;
        // Exclude any test tokens (case-insensitive)
        const lowerToken = token.toLowerCase();
        if (lowerToken.includes('test')) return false;
        // Must be valid Expo token format
        return token.startsWith('ExponentPushToken[') && token.endsWith(']');
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

