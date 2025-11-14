/**
 * Admin routes - Manual broadcast notifications
 */

import express from 'express';
import { getAllActiveDevices } from '../lib/push/db.js';
import { sendPushNotifications } from '../lib/push/unified-push.js';

const router = express.Router();

/**
 * POST /api/admin/broadcast
 * Admin panelinden tüm kullanıcılara manuel bildirim gönder
 */
router.post('/broadcast', async (req, res) => {
  try {
    const { title, message } = req.body;

    // Validation
    if (!title || !message) {
      return res.status(400).json({
        error: 'Başlık ve mesaj gerekli!'
      });
    }

    console.log(`📢 Admin broadcast request: "${title}"`);

    // Get ALL active devices
    const devices = await getAllActiveDevices();

    if (devices.length === 0) {
      console.log('📱 No active devices found');
      return res.json({ 
        success: true, 
        message: 'No active devices',
        sent: 0,
        totalDevices: 0,
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
        totalDevices: devices.length,
      });
    }

    console.log(`📤 Broadcasting to ${tokens.length} device(s)...`);

    // Send push notification to all
    const success = await sendPushNotifications([{
      to: tokens,
      title: title,
      body: message,
      data: {
        type: 'admin_broadcast',
        timestamp: Date.now(),
      },
      sound: 'default',
      priority: 'high',
      channelId: 'default',  // Android notification channel
    }]);

    if (success) {
      console.log(`✅ Broadcast sent to ${tokens.length} devices`);
      console.log(`   Title: ${title}`);
      console.log(`   Message: ${message}`);

      res.json({ 
        success: true,
        sent: tokens.length,
        totalDevices: devices.length,
        title,
        message,
      });
    } else {
      res.status(500).json({
        error: 'Failed to send broadcast notification'
      });
    }
  } catch (error) {
    console.error('❌ Error broadcasting notification:', error);
    res.status(500).json({
      error: error.message || 'Failed to broadcast notification'
    });
  }
});

/**
 * GET /api/admin/stats
 * Admin istatistikleri
 */
router.get('/stats', async (req, res) => {
  try {
    const devices = await getAllActiveDevices();
    
    const validTokens = devices.filter(d => 
      d.expo_push_token && !d.expo_push_token.includes('test-token')
    ).length;

    res.json({
      totalDevices: devices.length,
      validTokens: validTokens,
      platforms: {
        ios: devices.filter(d => d.platform === 'ios').length,
        android: devices.filter(d => d.platform === 'android').length,
      },
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

export default router;

