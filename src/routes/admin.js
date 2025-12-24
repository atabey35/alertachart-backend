/**
 * Admin routes - Manual broadcast notifications
 */

import express from 'express';
import { getAllActiveDevices } from '../lib/push/db.js';
import { sendPushNotifications } from '../lib/push/unified-push.js';
import { getSql } from '../lib/auth/db.js';

const router = express.Router();

/**
 * POST /api/admin/broadcast
 * Admin panelinden tüm kullanıcılara manuel bildirim gönder
 */
router.post('/broadcast', async (req, res) => {
  try {
    // 🔥 MULTILINGUAL: targetLang: 'all', 'tr', 'en' (en = non-tr, Global)
    const { title, message, targetLang = 'all' } = req.body;

    // Validation
    if (!title || !message) {
      return res.status(400).json({
        error: 'Başlık ve mesaj gerekli!'
      });
    }

    console.log(`📢 Admin broadcast request: "${title}" (target: ${targetLang})`);

    // Get ALL active devices
    const devices = await getAllActiveDevices();

    // 🔥 MULTILINGUAL: Filtreleme mantığı
    const filteredDevices = devices.filter(d => {
      const deviceLang = d.language ? d.language.toLowerCase() : 'tr';
      const isTr = deviceLang.startsWith('tr');

      if (targetLang === 'tr') {
        // Sadece Türkçe cihazlar
        return isTr;
      } else if (targetLang === 'en') {
        // Türkçe OLMAYAN cihazlar (Global)
        return !isTr;
      } else {
        // 'all' seçilirse herkese
        return true;
      }
    });

    console.log(`📊 Filtered devices: ${filteredDevices.length} / ${devices.length} (target: ${targetLang})`);

    if (filteredDevices.length === 0) {
      console.log(`📱 No active devices found for target: ${targetLang}`);
      return res.json({
        success: true,
        message: `No active devices for target: ${targetLang}`,
        sent: 0,
        totalDevices: devices.length,
        filteredDevices: 0,
      });
    }

    // Collect valid push tokens with device info (exclude test tokens and placeholders)
    // Support both Expo tokens and FCM tokens
    const deviceTokens = filteredDevices
      .map(d => ({
        token: d.expo_push_token,
        platform: d.platform,
        deviceId: d.device_id,
      }))
      .filter(({ token }) => {
        if (!token) return false;
        // Exclude any test tokens, placeholders, or invalid tokens (case-insensitive)
        const lowerToken = token.toLowerCase();
        if (lowerToken.includes('test') ||
          lowerToken.includes('placeholder') ||
          lowerToken === 'unknown' ||
          lowerToken.includes('invalid')) {
          return false;
        }
        // FCM tokens only - validate length and format
        // FCM tokens are typically 50+ characters long
        if (token.length < 50) return false;
        // FCM tokens should not contain brackets (Expo format)
        if (token.includes('[') || token.includes(']')) return false;
        return true;
      });

    if (deviceTokens.length === 0) {
      console.log(`📱 No valid push tokens found for target: ${targetLang}`);
      return res.json({
        success: true,
        message: `No valid tokens for target: ${targetLang}`,
        sent: 0,
        totalDevices: devices.length,
        filteredDevices: filteredDevices.length,
      });
    }

    // Log platform breakdown
    const iosDevices = deviceTokens.filter(d => d.platform === 'ios');
    const androidDevices = deviceTokens.filter(d => d.platform === 'android');
    console.log(`📤 Broadcasting to ${deviceTokens.length} device(s) (target: ${targetLang})...`);
    console.log(`   iOS devices: ${iosDevices.length}`);
    console.log(`   Android devices: ${androidDevices.length}`);
    console.log(`   First token example: ${deviceTokens[0].token.substring(0, 50)}...`);

    // Log iOS device tokens for debugging
    if (iosDevices.length > 0) {
      console.log(`   iOS token examples:`);
      iosDevices.slice(0, 3).forEach((d, idx) => {
        const tokenPreview = d.token.substring(0, 40);
        const isValid = d.token.length >= 50 && !d.token.toLowerCase().includes('placeholder') && !d.token.includes('[');
        console.log(`     ${idx + 1}. FCM token: ${tokenPreview}... (device: ${d.deviceId}) ${isValid ? '✅' : '❌ INVALID'}`);
      });
    }

    const tokens = deviceTokens.map(d => d.token);

    // Prepare payloads for each token (FCM only)
    const payloads = tokens.map(token => ({
      to: token,
      title: title,
      body: message,
      data: {
        type: 'admin_broadcast',
        timestamp: Date.now().toString(),
        channelId: 'admin-notifications',
      },
      sound: 'default',
      priority: 'high',
    }));

    // Send push notifications via FCM
    const success = await sendPushNotifications(payloads);

    if (success) {
      console.log(`✅ Broadcast sent to ${tokens.length} devices`);
      console.log(`   Title: ${title}`);
      console.log(`   Message: ${message}`);

      // 🔥 CRITICAL: Save notification to database so it appears in Settings notification list
      try {
        const sql = getSql();

        // Map targetLang to database format ('all', 'tr', or 'en')
        const dbTargetLang = targetLang === 'all' ? 'all' : targetLang;

        // Insert as global notification (user_id = NULL means broadcast to all)
        await sql`
          INSERT INTO notifications (title, message, user_id, is_read, target_lang, created_at)
          VALUES (${title}, ${message}, NULL, false, ${dbTargetLang}, NOW())
        `;
        console.log(`💾 Broadcast notification saved to database (target_lang: ${dbTargetLang})`);
      } catch (dbError) {
        // Log error but don't fail the broadcast - push was already sent
        console.error('⚠️ Failed to save notification to database:', dbError.message);
        console.error('   This means notification won\'t appear in Settings notification list');
      }

      res.json({
        success: true,
        sent: tokens.length,
        totalDevices: devices.length,
        filteredDevices: filteredDevices.length,
        targetLang: targetLang,
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

