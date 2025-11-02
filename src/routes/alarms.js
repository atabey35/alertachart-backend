/**
 * Alarm notification routes
 */

import express from 'express';
import { getAllActiveDevices } from '../lib/push/db.js';
import { sendAlarmNotification } from '../lib/push/expo-push.js';

const router = express.Router();

/**
 * POST /api/alarms/notify
 * Send alarm notification to ALL active devices
 */
router.post('/notify', async (req, res) => {
  try {
    const { alarmKey, symbol, message, data } = req.body;

    // Validation
    if (!symbol || !message) {
      return res.status(400).json({
        error: 'Missing required fields: symbol, message'
      });
    }

    console.log(`🔔 Alarm triggered: ${symbol} - ${message}${alarmKey ? ` (key: ${alarmKey})` : ''}`);

    // Get ALL active devices (no subscription needed)
    const devices = await getAllActiveDevices();

    if (devices.length === 0) {
      console.log('📱 No active devices found');
      return res.json({ 
        success: true, 
        message: 'No active devices',
        sent: 0,
      });
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

    console.log(`📱 Sending alarm notification to ${tokens.length} device(s): ${symbol}`);

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

