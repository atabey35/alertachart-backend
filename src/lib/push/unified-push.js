/**
 * Unified Push Notification Service
 * FCM-only implementation (Expo support removed)
 */

import { sendFCMNotification, sendFCMNotifications } from './fcm-push.js';

/**
 * Send push notification to single device (FCM only)
 */
export async function sendPushNotification(token, title, body, data) {
  console.log('[UnifiedPush] Using FCM for token:', token.substring(0, 20) + '...');
  return sendFCMNotification(token, title, body, data);
}

/**
 * Send push notifications to multiple devices (FCM only)
 */
export async function sendPushNotifications(payloads) {
  // Convert all payloads to FCM format
  const fcmPayloads = [];

  for (const payload of payloads) {
    const tokens = Array.isArray(payload.to) ? payload.to : [payload.to];
    
    // Filter out invalid tokens (placeholders, test tokens, etc.)
    const validTokens = tokens.filter(token => {
      if (!token || typeof token !== 'string') return false;
      const lowerToken = token.toLowerCase();
      // Reject placeholders, test tokens, and invalid tokens
      if (lowerToken.includes('placeholder') || 
          lowerToken.includes('test') || 
          lowerToken === 'unknown' ||
          token.length < 50) { // FCM tokens are typically longer
        return false;
      }
      return true;
    });

    if (validTokens.length > 0) {
      fcmPayloads.push({
        ...payload,
        token: validTokens,
      });
    }
  }

  if (fcmPayloads.length === 0) {
    console.warn('[UnifiedPush] No valid FCM tokens to send');
    return false;
  }

  const fcmTokenCount = fcmPayloads.reduce((sum, p) => sum + (Array.isArray(p.token) ? p.token.length : 1), 0);
  console.log(`[UnifiedPush] Sending ${fcmPayloads.length} payloads via FCM (${fcmTokenCount} tokens)`);
  
  return await sendFCMNotifications(fcmPayloads);
}

/**
 * Send price alert notification (unified)
 * 🔥 MULTILINGUAL: Supports custom title/body for different languages
 * @param {string|string[]} tokens - Device push tokens
 * @param {string} symbol - Trading symbol (e.g., BTCUSDT)
 * @param {number} currentPrice - Current price
 * @param {number} targetPrice - Target price
 * @param {string} direction - 'up' or 'down'
 * @param {string} [customTitle] - Optional custom title (for multilingual support)
 * @param {string} [customBody] - Optional custom body (for multilingual support)
 */
export async function sendPriceAlertNotification(tokens, symbol, currentPrice, targetPrice, direction, customTitle = null, customBody = null) {
  const emoji = direction === 'up' ? '📈' : '📉';
  
  // If custom title/body provided, use them (for multilingual support)
  if (customTitle && customBody) {
    return sendPushNotifications([{
      to: tokens,
      title: customTitle,
      body: customBody,
      data: {
        type: 'price_alert',
        symbol: symbol,
        price: currentPrice.toString(),
        targetPrice: targetPrice.toString(),
        direction: direction,
      },
      sound: 'default',
      channelId: 'price-alerts-v2',
      priority: 'high',
    }]);
  }
  
  // Default Turkish message (backward compatibility)
  const actionText = direction === 'up' ? 'yaklaşıyor' : 'iniyor';
  
  // Format prices nicely
  const formattedTarget = targetPrice.toLocaleString('en-US');
  const formattedCurrent = currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  return sendPushNotifications([{
    to: tokens,
    title: `${symbol} ${emoji}`,
    body: `${symbol} ${formattedTarget} $ seviyesine ${actionText}! Şu anki fiyat: ${formattedCurrent}`,
    data: {
      type: 'price_alert',
      symbol: symbol,
      price: currentPrice.toString(),
      targetPrice: targetPrice.toString(),
      direction: direction,
    },
    sound: 'default',
    channelId: 'price-alerts-v2',
    priority: 'high',
  }]);
}

/**
 * Send alarm notification (unified)
 */
export async function sendAlarmNotification(tokens, symbol, message, alarmData) {
  // Ensure symbol is uppercase
  const upperSymbol = symbol.toUpperCase();
  
  return sendPushNotifications([{
    to: tokens,
    title: `Alarm: ${upperSymbol}`,
    body: message,
    data: {
      type: 'alarm',
      symbol: upperSymbol,
      message: message,
      ...alarmData,
    },
    sound: 'default',
    channelId: 'alarms-v2',
    priority: 'high',
    icon: 'notification_icon',
  }]);
}

/**
 * Send test notification (unified)
 * 🔥 MULTILINGUAL: Supports custom title/body for different languages
 * @param {string} token - Device push token
 * @param {string} [customTitle] - Optional custom title (for multilingual support)
 * @param {string} [customBody] - Optional custom body (for multilingual support)
 */
export async function sendTestNotification(token, customTitle = null, customBody = null) {
  // If custom title/body provided, use them (for multilingual support)
  if (customTitle && customBody) {
    return sendPushNotification(
      token,
      customTitle,
      customBody,
      { test: true, timestamp: Date.now() }
    );
  }
  
  // Default Turkish message (backward compatibility)
  return sendPushNotification(
    token,
    'Test Bildirimi 🎉',
    'Push notification sistemi başarıyla çalışıyor!',
    { test: true, timestamp: Date.now() }
  );
}

