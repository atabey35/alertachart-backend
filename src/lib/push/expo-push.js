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

        const message = {
          to: token,
          title: payload.title,
          body: payload.body,
          data: payload.data || {},
          sound: payload.sound || 'default',
          badge: payload.badge,
          channelId: payload.channelId || 'default',
          priority: payload.priority || 'high',
          ttl: payload.ttl || 86400,
        };
        
        // Only add optional fields if they have valid values
        if (payload.color && /^#[0-9A-Fa-f]{6}$/.test(payload.color)) {
          message.color = payload.color;
        }
        if (payload.icon) {
          message.icon = payload.icon;
        }
        if (payload.image) {
          message.image = payload.image;
        }
        if (payload.subtitle) {
          message.subtitle = payload.subtitle;
        }
        if (payload.categoryId) {
          message.categoryId = payload.categoryId;
        }
        if (payload.collapseId) {
          message.collapseId = payload.collapseId;
        }
        
        messages.push(message);
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
        console.log('Expo ticket chunk:', JSON.stringify(ticketChunk, null, 2));
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending push notification chunk:', error);
      }
    }

    console.log('Expo tickets aggregated:', JSON.stringify(tickets, null, 2));

    // Check for errors and log detailed information
    let hasErrors = false;
    let errorCount = 0;
    let successCount = 0;
    
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const message = messages[i];
      
      if (ticket.status === 'error') {
        hasErrors = true;
        errorCount++;
        console.error(`❌ Expo push notification error (message ${i + 1}):`, {
          token: message.to ? message.to.substring(0, 40) + '...' : 'unknown',
          message: ticket.message,
          details: ticket.details,
          errorCode: ticket.details?.errorCode,
        });
        
        // Log specific error types
        if (ticket.details?.errorCode === 'DeviceNotRegistered') {
          console.error(`   ⚠️  Device not registered - token may be invalid or expired`);
        } else if (ticket.details?.errorCode === 'MessageTooBig') {
          console.error(`   ⚠️  Message too big - payload size exceeded`);
        } else if (ticket.details?.errorCode === 'MessageRateExceeded') {
          console.error(`   ⚠️  Message rate exceeded - too many notifications sent`);
        }
      } else if (ticket.status === 'ok') {
        successCount++;
      }
    }

    console.log(`✅ Sent ${messages.length} push notifications, ${tickets.length} tickets received`);
    console.log(`   Success: ${successCount}, Errors: ${errorCount}`);
    
    // If there are errors, log a summary
    if (hasErrors) {
      console.warn(`⚠️  ${errorCount} Expo push notification(s) failed. Check error details above.`);
    }
    
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
 * Send alarm notification
 */
export async function sendAlarmNotification(tokens, symbol, message, alarmData) {
  // Ensure symbol is uppercase
  const upperSymbol = symbol.toUpperCase();
  const brandColor = '#0a84ff';
  
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
 * Format price for display
 * - Prices < 1: 4 decimals
 * - Prices >= 1: 2 decimals
 */
export function formatPrice(price) {
  if (price < 1) {
    return parseFloat(price.toFixed(4));
  }
  return parseFloat(price.toFixed(2));
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
