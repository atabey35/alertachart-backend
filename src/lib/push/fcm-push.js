/**
 * Firebase Cloud Messaging (FCM) Push Notification Service
 * For Capacitor/Native apps
 */

import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deleteDeviceByToken } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let firebaseApp = null;

// Initialize Firebase Admin SDK
function initFirebase() {
  if (firebaseApp) return firebaseApp;

  try {
    // Try environment variable first (for production)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('✅ Firebase Admin SDK initialized (from env)');
      return firebaseApp;
    }

    // Fall back to local file (for development)
    const serviceAccountPath = join(__dirname, '../../../firebase-admin-key.json');
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log('✅ Firebase Admin SDK initialized (from file)');
    return firebaseApp;
  } catch (error) {
    console.error('❌ Failed to initialize Firebase Admin SDK:', error);
    return null;
  }
}

/**
 * Send FCM push notification to single device
 */
export async function sendFCMNotification(token, title, body, data) {
  return sendFCMNotifications([{
    token,
    title,
    body,
    data,
  }]);
}

/**
 * Send FCM push notifications to multiple devices
 */
export async function sendFCMNotifications(payloads) {
  try {
    const app = initFirebase();
    if (!app) {
      console.error('Firebase not initialized');
      return false;
    }

    const messages = [];

    for (const payload of payloads) {
      const tokens = Array.isArray(payload.token) ? payload.token : [payload.token];

      for (const token of tokens) {
        if (!token || typeof token !== 'string') {
          console.error(`Invalid FCM token: ${token}`);
          continue;
        }

        // FCM requires all data values to be strings
        const fcmData = {};
        if (payload.data) {
          for (const [key, value] of Object.entries(payload.data)) {
            fcmData[key] = String(value);
          }
        }

        const message = {
          token: token,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data: fcmData,
          android: {
            priority: 'high',
            notification: {
              channelId: payload.data?.channelId || payload.channelId || 'default',
              sound: 'default',
              priority: 'high',
            },
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                badge: payload.badge || 0,
              },
            },
          },
        };

        // Add optional fields
        if (payload.color && /^#[0-9A-Fa-f]{6}$/.test(payload.color)) {
          message.android.notification.color = payload.color;
        }
        if (payload.icon) {
          message.android.notification.icon = payload.icon;
        }
        if (payload.image) {
          message.android.notification.imageUrl = payload.image;
        }

        messages.push(message);
      }
    }

    if (messages.length === 0) {
      console.warn('No valid FCM tokens to send');
      return false;
    }

    // Send messages
    const responses = await admin.messaging().sendEach(messages);
    
    console.log(`✅ Sent ${messages.length} FCM notifications`);
    console.log(`Success: ${responses.successCount}, Failures: ${responses.failureCount}`);

    // Log errors and clean up invalid tokens
    if (responses.failureCount > 0) {
      for (let idx = 0; idx < responses.responses.length; idx++) {
        const resp = responses.responses[idx];
        if (!resp.success) {
          const errorCode = resp.error?.code;
          const errorMessage = resp.error?.message;
          const invalidToken = messages[idx].token;
          
          console.error(`❌ FCM Error for message ${idx}:`, {
            token: invalidToken.substring(0, 40) + '...',
            code: errorCode,
            message: errorMessage,
          });
          
          // Clean up invalid tokens from database
          if (errorCode === 'messaging/registration-token-not-registered' || 
              errorCode === 'messaging/invalid-registration-token' ||
              errorCode === 'messaging/invalid-argument') {
            console.log(`🗑️  Removing invalid FCM token: ${invalidToken.substring(0, 30)}...`);
            try {
              await deleteDeviceByToken(invalidToken);
              console.log(`✅ Invalid token removed from database`);
            } catch (deleteError) {
              console.error(`Failed to delete invalid token:`, deleteError);
            }
          } else {
            // Log other error types for debugging
            console.error(`   ⚠️  FCM error code: ${errorCode} - ${errorMessage}`);
            if (errorCode === 'messaging/authentication-error') {
              console.error(`   ⚠️  Firebase authentication error - check service account credentials`);
            } else if (errorCode === 'messaging/server-unavailable') {
              console.error(`   ⚠️  FCM server unavailable - retry may be needed`);
            }
          }
        }
      }
    }

    return responses.failureCount === 0;
  } catch (error) {
    console.error('Failed to send FCM notifications:', error);
    return false;
  }
}

/**
 * Send price alert notification via FCM
 */
export async function sendFCMPriceAlertNotification(tokens, symbol, currentPrice, targetPrice, direction) {
  const emoji = direction === 'up' ? '📈' : '📉';
  const actionText = direction === 'up' ? 'yaklaşıyor' : 'iniyor';
  
  // Format prices nicely
  const formattedTarget = targetPrice.toLocaleString('en-US');
  const formattedCurrent = currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  return sendFCMNotifications([{
    token: tokens,
    title: `${symbol} ${emoji}`,
    body: `${symbol} ${formattedTarget} $ seviyesine ${actionText}! Şu anki fiyat: ${formattedCurrent}`,
    data: {
      type: 'price_alert',
      symbol: symbol,
      price: currentPrice.toString(),
      targetPrice: targetPrice.toString(),
      direction: direction,
    },
    channelId: 'price-alerts-v2',
  }]);
}

/**
 * Send alarm notification via FCM
 */
export async function sendFCMAlarmNotification(tokens, symbol, message, alarmData) {
  // Ensure symbol is uppercase
  const upperSymbol = symbol.toUpperCase();
  
  return sendFCMNotifications([{
    token: tokens,
    title: `Alarm: ${upperSymbol}`,
    body: message,
    data: {
      type: 'alarm',
      symbol: upperSymbol,
      message: message,
      ...alarmData,
    },
    channelId: 'alarms-v2',
    icon: 'notification_icon',
  }]);
}

/**
 * Send test notification via FCM
 */
export async function sendFCMTestNotification(token) {
  return sendFCMNotification(
    token,
    'Test Bildirimi 🎉',
    'Push notification sistemi başarıyla çalışıyor!',
    { test: 'true', timestamp: Date.now().toString() }
  );
}

