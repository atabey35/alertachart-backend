/**
 * Unified Push Notification Service
 * Automatically detects and uses the correct push service (Expo or FCM)
 */

import { Expo } from 'expo-server-sdk';
import { sendFCMNotification, sendFCMNotifications } from './fcm-push.js';
import { 
  sendPushNotification as sendExpoNotification,
  sendPushNotifications as sendExpoNotifications 
} from './expo-push.js';

/**
 * Detect if token is Expo Push Token or FCM token
 */
function isExpoPushToken(token) {
  return token && (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['));
}

/**
 * Send push notification to single device (auto-detect token type)
 */
export async function sendPushNotification(token, title, body, data) {
  if (isExpoPushToken(token)) {
    console.log('[UnifiedPush] Using Expo for token:', token.substring(0, 20) + '...');
    return sendExpoNotification(token, title, body, data);
  } else {
    console.log('[UnifiedPush] Using FCM for token:', token.substring(0, 20) + '...');
    return sendFCMNotification(token, title, body, data);
  }
}

/**
 * Send push notifications to multiple devices (auto-detect token types)
 */
export async function sendPushNotifications(payloads) {
  // Separate Expo and FCM payloads
  const expoPayloads = [];
  const fcmPayloads = [];

  for (const payload of payloads) {
    const tokens = Array.isArray(payload.to) ? payload.to : [payload.to];
    const expoTokens = [];
    const fcmTokens = [];

    for (const token of tokens) {
      if (isExpoPushToken(token)) {
        expoTokens.push(token);
      } else {
        fcmTokens.push(token);
      }
    }

    if (expoTokens.length > 0) {
      expoPayloads.push({
        ...payload,
        to: expoTokens,
      });
    }

    if (fcmTokens.length > 0) {
      fcmPayloads.push({
        ...payload,
        token: fcmTokens,
      });
    }
  }

  // Send to both services
  const results = [];

  if (expoPayloads.length > 0) {
    console.log(`[UnifiedPush] Sending ${expoPayloads.length} payloads via Expo`);
    results.push(await sendExpoNotifications(expoPayloads));
  }

  if (fcmPayloads.length > 0) {
    console.log(`[UnifiedPush] Sending ${fcmPayloads.length} payloads via FCM`);
    results.push(await sendFCMNotifications(fcmPayloads));
  }

  // Return true if any service succeeded
  return results.some(result => result === true);
}

/**
 * Send price alert notification (unified)
 */
export async function sendPriceAlertNotification(tokens, symbol, currentPrice, targetPrice, direction) {
  const emoji = direction === 'up' ? '📈' : '📉';
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
 */
export async function sendTestNotification(token) {
  return sendPushNotification(
    token,
    'Test Bildirimi 🎉',
    'Push notification sistemi başarıyla çalışıyor!',
    { test: true, timestamp: Date.now() }
  );
}

