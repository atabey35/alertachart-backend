/**
 * Expo Push Notification Service
 */

import { Expo } from 'expo-server-sdk';

// Create Expo SDK client
const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN,
  useFcmV1: true,
});

/**
 * Send push notification to single device
 */
export async function sendPushNotification(token, title, body, data) {
  return sendPushNotifications([{
    to: token,
    title,
    body,
    data,
  }]);
}

/**
 * Send push notifications to multiple devices
 */
export async function sendPushNotifications(payloads) {
  try {
    const messages = [];

    for (const payload of payloads) {
      const tokens = Array.isArray(payload.to) ? payload.to : [payload.to];

      for (const token of tokens) {
        if (!Expo.isExpoPushToken(token)) {
          console.error(`Invalid Expo push token: ${token}`);
          continue;
        }

        messages.push({
          to: token,
          title: payload.title,
          body: payload.body,
          data: payload.data || {},
          sound: payload.sound || 'default',
          badge: payload.badge,
          channelId: payload.channelId || 'default',
          priority: payload.priority || 'high',
          ttl: payload.ttl || 86400,
        });
      }
    }

    if (messages.length === 0) {
      console.warn('No valid push tokens to send');
      return false;
    }

    // Send in chunks (Expo max 100 per request)
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending push notification chunk:', error);
      }
    }

    // Check for errors
    let hasErrors = false;
    for (const ticket of tickets) {
      if (ticket.status === 'error') {
        hasErrors = true;
        console.error('Push notification error:', {
          message: ticket.message,
          details: ticket.details,
        });
      }
    }

    console.log(`✅ Sent ${messages.length} push notifications, ${tickets.length} tickets received`);
    return !hasErrors;
  } catch (error) {
    console.error('Failed to send push notifications:', error);
    return false;
  }
}

/**
 * Send price alert notification
 */
export async function sendPriceAlertNotification(tokens, symbol, currentPrice, targetPrice, direction) {
  const emoji = direction === 'up' ? '📈' : '📉';
  const actionText = direction === 'up' ? 'yaklaşıyor' : 'iniyor';
  
  return sendPushNotifications([{
    to: tokens,
    title: `${symbol} ${emoji}`,
    body: `${symbol} ${targetPrice} ${direction === 'up' ? '$' : ''} seviyesine ${actionText}! Şu anki fiyat: ${currentPrice}`,
    data: {
      type: 'price_alert',
      symbol: symbol,
      price: currentPrice.toString(),
      targetPrice: targetPrice.toString(),
      direction: direction,
    },
    sound: 'default',
    channelId: 'price-alerts',
    priority: 'high',
  }]);
}

/**
 * Send alarm notification
 */
export async function sendAlarmNotification(tokens, symbol, message, alarmData) {
  return sendPushNotifications([{
    to: tokens,
    title: `🔔 Alarm: ${symbol}`,
    body: message,
    data: {
      type: 'alarm',
      symbol: symbol,
      message: message,
      ...alarmData,
    },
    sound: 'default',
    channelId: 'alarms',
    priority: 'high',
  }]);
}

/**
 * Send test notification
 */
export async function sendTestNotification(token) {
  return sendPushNotification(
    token,
    'Test Bildirimi 🎉',
    'Push notification sistemi başarıyla çalışıyor!',
    { test: true, timestamp: Date.now() }
  );
}
