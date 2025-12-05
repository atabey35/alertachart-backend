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
        // 🔒 PREMIUM CHECK: Sadece otomatik price tracking bildirimleri için kontrol yap
        // Local alarmlar (isLocalAlarm: true) için premium kontrolü yapma - free kullanıcılar da alabilmeli
        const isLocalAlarm = req.body.isLocalAlarm === true;
        
        if (!isLocalAlarm) {
          // Otomatik price tracking bildirimi - premium kontrolü yap
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
          // Use the same logic as frontend utils/premium.ts for consistency
          
          // Premium: plan === 'premium' AND (no expiry_date OR expiry_date is in the future)
          let isPremium = false;
          if (user.plan === 'premium') {
            if (user.expiry_date) {
              const expiry = new Date(user.expiry_date);
              const now = new Date();
              isPremium = expiry > now;
            } else {
              // No expiry_date means lifetime premium or new premium user
              isPremium = true;
            }
          }
          
          // Trial: plan === 'free' AND trial is active (between trial_started_at and trial_ended_at)
          let isTrial = false;
          if (user.plan === 'free' && user.trial_started_at) {
            const trialStart = new Date(user.trial_started_at);
            let trialEnd;
            
            if (user.trial_ended_at) {
              trialEnd = new Date(user.trial_ended_at);
            } else {
              // Calculate trial end (3 days from start)
              trialEnd = new Date(trialStart);
              trialEnd.setDate(trialEnd.getDate() + 3);
            }
            
            const now = new Date();
            isTrial = now >= trialStart && now < trialEnd;
          }
          
          const hasPremiumAccess = isPremium || isTrial;
          
          // 🔍 DEBUG: Log premium status check
          console.log(`🔍 Premium check for user ${targetDevice.user_id} (${user.email}):`, {
            plan: user.plan,
            expiry_date: user.expiry_date,
            expiry_date_parsed: user.expiry_date ? new Date(user.expiry_date).toISOString() : null,
            expiry_date_valid: user.expiry_date ? (new Date(user.expiry_date) > new Date()) : 'N/A (lifetime)',
            trial_started_at: user.trial_started_at,
            trial_ended_at: user.trial_ended_at,
            trial_started_parsed: user.trial_started_at ? new Date(user.trial_started_at).toISOString() : null,
            trial_ended_parsed: user.trial_ended_at ? new Date(user.trial_ended_at).toISOString() : null,
            now: new Date().toISOString(),
            isPremium,
            isTrial,
            hasPremiumAccess,
          });
          
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
        } else {
          // Local alarm - premium kontrolü yok, tüm kullanıcılar alabilir
          console.log(`📱 Local alarm notification - Premium check skipped (free users can receive)`);
        }
        
        devices = [targetDevice];
        targetDeviceInfo = `Device ${targetDevice.device_id} (by deviceId)`;
        console.log(`✅ Found device by deviceId: ${deviceId} - Sending notification`);
        const userInfo = targetDevice.user_id ? `user_id=${targetDevice.user_id}` : 'user_id=NULL';
        console.log(`   Device details: platform=${targetDevice.platform}, ${userInfo}, token=${targetDevice.expo_push_token.substring(0, 30)}...`);
      } else {
        console.log(`❌ Device ${deviceId} not found or has no push token`);
        
        // 🔥 FALLBACK: If deviceId not found, try to find devices by userId (from cookies)
        if (userId) {
          console.log(`🔍 Fallback: Looking up devices by userId: ${userId}`);
          const userDevices = await getUserDevices(userId);
          
          if (userDevices.length > 0) {
            console.log(`✅ Found ${userDevices.length} device(s) for user ${userId} - Using fallback method`);
            
            // Check if this is a local alarm (premium check skip)
            const isLocalAlarm = req.body.isLocalAlarm === true;
            
            if (!isLocalAlarm) {
              // Otomatik price tracking - premium kontrolü yap
              const user = await getUserById(userId);
              if (user) {
                // Premium check (same logic as above)
                let isPremium = false;
                if (user.plan === 'premium') {
                  if (user.expiry_date) {
                    const expiry = new Date(user.expiry_date);
                    const now = new Date();
                    isPremium = expiry > now;
                  } else {
                    isPremium = true;
                  }
                }
                
                let isTrial = false;
                if (user.plan === 'free' && user.trial_started_at) {
                  const trialStart = new Date(user.trial_started_at);
                  let trialEnd;
                  if (user.trial_ended_at) {
                    trialEnd = new Date(user.trial_ended_at);
                  } else {
                    trialEnd = new Date(trialStart);
                    trialEnd.setDate(trialEnd.getDate() + 3);
                  }
                  const now = new Date();
                  isTrial = now >= trialStart && now < trialEnd;
                }
                
                const hasPremiumAccess = isPremium || isTrial;
                
                if (!hasPremiumAccess) {
                  console.log(`🚫 Free user ${userId} (${user.email}) - Skipping automatic price tracking notification`);
                  return res.json({ 
                    success: true, 
                    message: 'Free user - automatic notifications disabled',
                    sent: 0,
                    skipped: true,
                    reason: 'free_user',
                  });
                }
                
                console.log(`✅ Premium/Trial user ${userId} (${user.email}) - Sending notification to ${userDevices.length} device(s)`);
              } else {
                console.log(`⚠️ User ${userId} not found in fallback`);
                return res.json({ 
                  success: true, 
                  message: 'Device not found and user not found',
                  sent: 0,
                });
              }
            } else {
              // Local alarm - premium kontrolü yok
              console.log(`📱 Local alarm notification (fallback) - Premium check skipped (free users can receive)`);
            }
            
            devices = userDevices;
            targetDeviceInfo = `All user devices (${userDevices.length} device(s)) via userId fallback`;
          } else {
            console.log(`❌ No devices found for user ${userId} in fallback`);
            return res.json({ 
              success: true, 
              message: 'Device not found and no devices for user',
              sent: 0,
            });
          }
        } else {
          return res.json({ 
            success: true, 
            message: 'Device not found or has no push token',
            sent: 0,
          });
        }
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

    // 🔥 MULTILINGUAL: Tokenları dile göre ayır ve mesajları çevir
    const trTokens = [];
    const enTokens = [];
    const trDevices = [];
    const enDevices = [];

    for (const device of devices) {
      const token = device.expo_push_token;
      if (!token) continue;
      
      // Exclude test tokens
      const lowerToken = token.toLowerCase();
      if (lowerToken.includes('test') || lowerToken === 'unknown') continue;
      if (token.length <= 10) continue;

      // 🔥 MULTILINGUAL: Dil kontrolü
      const lang = device.language ? device.language.toLowerCase() : 'tr';
      const isTurkish = lang.startsWith('tr');

      if (isTurkish) {
        trTokens.push(token);
        trDevices.push(device);
      } else {
        enTokens.push(token);
        enDevices.push(device);
      }
    }

    if (trTokens.length === 0 && enTokens.length === 0) {
      console.log('📱 No valid push tokens found');
      return res.json({ 
        success: true, 
        message: 'No valid tokens',
        sent: 0,
      });
    }

    console.log(`📱 Sending alarm notification: ${trTokens.length} TR device(s), ${enTokens.length} EN device(s)`);

    // 🔥 MULTILINGUAL: Mesajları çevir
    const upperSymbol = symbol.toUpperCase();
    
    // TR Mesajı (orijinal mesaj)
    const titleTr = `Fiyat Alarmı: ${upperSymbol}`;
    const bodyTr = message; // Frontend'den gelen mesaj zaten Türkçe

    // EN Mesajı (çeviri)
    // Frontend'den gelen mesaj formatı: "BTCUSDT fiyatı 89446.50 seviyesine ulaştı!" veya "düştü!"
    // İngilizce: "BTCUSDT price reached 89446.50 level!" veya "dropped to"
    let bodyEn = message;
    
    // Regex ile fiyat ve yönü çıkar
    const priceMatch = message.match(/([\d,]+\.?\d*)/);
    const price = priceMatch ? priceMatch[1].replace(/,/g, '') : '';
    
    if (message.includes('ulaştı')) {
      // "BTCUSDT fiyatı 89446.50 seviyesine ulaştı!" -> "BTCUSDT price reached 89446.50 level!"
      bodyEn = `${upperSymbol} price reached ${price} level!`;
    } else if (message.includes('düştü')) {
      // "BTCUSDT fiyatı 89446.50 seviyesine düştü!" -> "BTCUSDT price dropped to 89446.50 level!"
      bodyEn = `${upperSymbol} price dropped to ${price} level!`;
    } else {
      // Fallback: Basit çeviri
      bodyEn = `${upperSymbol} price alert triggered!`;
    }
    
    const titleEn = `Price Alert: ${upperSymbol}`;

    // 🔥 MULTILINGUAL: Paralel gönderim
    const promises = [];
    
    if (trTokens.length > 0) {
      console.log(`🇹🇷 Sending TR alarm to ${trTokens.length} device(s)`);
      promises.push(
        sendAlarmNotification(trTokens, symbol, bodyTr, data, titleTr, bodyTr)
      );
    }

    if (enTokens.length > 0) {
      console.log(`🌍 Sending EN alarm to ${enTokens.length} device(s)`);
      promises.push(
        sendAlarmNotification(enTokens, symbol, bodyEn, data, titleEn, bodyEn)
      );
    }

    // Tüm bildirimleri paralel gönder
    const results = await Promise.all(promises);
    const allSuccess = results.every(r => r === true);
    const totalSent = trTokens.length + enTokens.length;

    if (allSuccess) {
      console.log(`✅ Alarm notifications sent successfully: ${totalSent} device(s)`);
      if (trTokens.length > 0) {
        console.log(`   🇹🇷 TR: ${trTokens.length} device(s)`);
      }
      if (enTokens.length > 0) {
        console.log(`   🌍 EN: ${enTokens.length} device(s)`);
      }

      res.json({ 
        success: true,
        sent: totalSent,
        totalDevices: devices.length,
        trSent: trTokens.length,
        enSent: enTokens.length,
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

