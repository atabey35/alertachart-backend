/**
 * Otomatik Fiyat Yaklaşma Bildirimleri (PREMIUM ÖZELLİK)
 * Önemli fiyat seviyelerine yaklaşınca SADECE PREMIUM/TRIAL kullanıcılara bildirim gönderir
 */

import WebSocket from 'ws';
import { getPremiumTrialDevices, getActivePriceAlertsBySymbol, getAllActiveCustomAlerts, updatePriceAlertNotification } from './db.js';
import { sendPriceAlertNotification } from './unified-push.js';

/**
 * Otomatik fiyat uyarı servisi (PREMIUM ÖZELLİK)
 * BTC 106k, ETH 4k gibi önemli seviyelere yaklaşınca SADECE premium/trial kullanıcılara bildirim
 */
export class AutoPriceAlertService {
  constructor() {
    this.wsConnections = new Map();
    this.priceCache = new Map();
    this.prevPriceCache = new Map(); // Önceki fiyatları sakla (zona muerta için)
    this.lastNotifications = new Map(); // Symbol + level için son bildirim zamanı (UNIFIED: no direction)
    this.triggeredLevels = new Map(); // Trigger edilmiş seviyeler (tekrar etmemek için)
    this.lastTriggeredLevel = new Map(); // Hysteresis: Son bildirim gönderilen seviye (symbol -> {level, timestamp, direction})
    this.customAlertsCache = new Map(); // Custom alert'ler için cache (symbol -> alerts[])
    this.triggeredCustomAlerts = new Map(); // Trigger edilmiş custom alert'ler (alert_id -> timestamp)
    this.isRunning = false;
    this.customAlertsCheckInterval = null; // Custom alert'leri kontrol etmek için interval
    
    // COOLDOWN: Aynı seviye için 5 dakika bekle (UNIFIED: applies to both UP and DOWN for same level)
    this.NOTIFICATION_COOLDOWN = 5 * 60 * 1000; // 5 dakika
    
    // HYSTERESIS: "Close Range" - Price must move this far from last triggered level before new alert
    // Prevents flickering when price wobbles around a recently notified level
    this.HYSTERESIS_CLOSE_RANGE_PERCENT = 0.5; // %0.5 of the level (e.g., 93,000 * 0.005 = 465$ range)
    
    // ZONA MUERTA: Her coin için tolerans yüzdeleri
    this.TOLERANCE_PERCENTAGES = {
      'BTCUSDT': 0.15,  // %0.15 (104K'da ±156 USD zona muerta)
      'ETHUSDT': 0.20,  // %0.20 
      'SOLUSDT': 0.25,  // %0.25
      'BNBUSDT': 0.20,  // %0.20
    };
    
    // İzlenecek coin'ler ve önemli seviyeleri
    this.watchList = {
      'BTCUSDT': {
        name: 'Bitcoin',
        emoji: '₿',
        roundTo: 1000, // Her 1000$ bir seviye
        proximityDeltaUp: 100, // Yukarı yaklaşırken $100
        proximityDeltaDown: 50, // Aşağı yaklaşırken $50
      },
      'ETHUSDT': {
        name: 'Ethereum',
        emoji: 'Ξ',
        roundTo: 100, // Her 100$ bir seviye
        proximityDeltaUp: 20, // Yukarı yaklaşırken $20
        proximityDeltaDown: 10, // Aşağı yaklaşırken $10
      },
      'SOLUSDT': {
        name: 'Solana',
        emoji: '◎',
        roundTo: 10, // Her 10$ bir seviye
        proximityDeltaUp: 2, // Yukarı yaklaşırken $2
        proximityDeltaDown: 1, // Aşağı yaklaşırken $1
      },
      'BNBUSDT': {
        name: 'BNB',
        emoji: '🔶',
        roundTo: 50, // Her 50$ bir seviye
        proximityDeltaUp: 5, // Yukarı yaklaşırken $5
        proximityDeltaDown: 3, // Aşağı yaklaşırken $3
      },
    };
  }

  /**
   * Servisi başlat
   */
  start() {
    if (this.isRunning) {
      console.warn('⚠️  Auto price alert service already running');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Auto Price Alert Service started');
    console.log(`📊 Watching ${Object.keys(this.watchList).length} symbols:`);
    
    Object.entries(this.watchList).forEach(([symbol, config]) => {
      console.log(`   ${config.emoji} ${config.name} (${symbol})`);
    });

    // Her symbol için WebSocket bağlantısı kur
    Object.keys(this.watchList).forEach(symbol => {
      this.connectToSymbol(symbol);
    });
    
    // Custom alert'leri yükle ve dinlemeye başla
    this.loadCustomAlerts();
    
    // Her 30 saniyede bir custom alert'leri yeniden yükle (yeni alert'ler için)
    this.customAlertsCheckInterval = setInterval(() => {
      if (this.isRunning) {
        this.loadCustomAlerts();
      }
    }, 30000); // 30 saniye
  }

  /**
   * Servisi durdur
   */
  stop() {
    if (!this.isRunning) return;

    this.isRunning = false;

    // Custom alert check interval'ı temizle
    if (this.customAlertsCheckInterval) {
      clearInterval(this.customAlertsCheckInterval);
      this.customAlertsCheckInterval = null;
    }

    // WebSocket bağlantılarını kapat
    this.wsConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
    this.wsConnections.clear();
    this.customAlertsCache.clear();

    console.log('🛑 Auto price alert service stopped');
  }

  /**
   * Symbol için WebSocket bağlantısı kur
   */
  connectToSymbol(symbol) {
    if (this.wsConnections.has(symbol)) return;

    const wsUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        console.log(`✅ Connected to ${symbol} price feed`);
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          const price = parseFloat(message.c); // 'c' = current price
          
          if (price) {
            const oldPrice = this.priceCache.get(symbol);
            
            // Önceki fiyatı sakla (zona muerta kontrolü için)
            if (oldPrice !== undefined) {
              this.prevPriceCache.set(symbol, oldPrice);
            }
            
            this.priceCache.set(symbol, price);
            
            // Fiyat değiştiğinde kontrol et
            if (oldPrice !== price) {
              this.checkPriceLevel(symbol, price);
              // Custom alert'leri de kontrol et
              this.checkCustomAlerts(symbol, price);
            }
          }
        } catch (error) {
          console.error(`Error parsing price data for ${symbol}:`, error);
        }
      });

      ws.on('error', (error) => {
        console.error(`WebSocket error for ${symbol}:`, error.message);
      });

      ws.on('close', () => {
        console.log(`❌ Disconnected from ${symbol} price feed`);
        this.wsConnections.delete(symbol);
        
        // Yeniden bağlan (5 saniye sonra)
        if (this.isRunning) {
          setTimeout(() => {
            if (this.isRunning) {
              this.connectToSymbol(symbol);
            }
          }, 5000);
        }
      });

      this.wsConnections.set(symbol, ws);
    } catch (error) {
      console.error(`Failed to connect to ${symbol}:`, error);
    }
  }

  /**
   * Zona muerta (dead-zone) hesapla
   * Proximity delta'nın %yüzdeliği kadar ek tolerans ekle
   * Böylece fiyat seviyeye ÇOK yakınken bildirim gönderilmez
   */
  calculateDeadZone(targetPrice, proximityDelta, symbol) {
    const tolerance = this.TOLERANCE_PERCENTAGES[symbol] || 0.25;
    
    // Zona muerta = proximityDelta + (proximityDelta * tolerance%)
    // Örnek BNB: proximityDelta=5, tolerance=20% → deadZone = 5 + (5*0.20) = 6$
    const deadZoneAmount = proximityDelta * (1 + (tolerance / 100));
    
    return {
      lower: targetPrice - deadZoneAmount,
      upper: targetPrice + deadZoneAmount
    };
  }

  /**
   * Fiyat seviyesini kontrol et ve gerekirse bildirim gönder
   * REFACTORED: Unified cooldown keys and hysteresis to prevent flickering
   */
  async checkPriceLevel(symbol, currentPrice) {
    const config = this.watchList[symbol];
    if (!config) return;

    const { roundTo, proximityDeltaUp, proximityDeltaDown, name, emoji } = config;
    const prevPrice = this.prevPriceCache.get(symbol);

    // Önceki fiyat yoksa, henüz kontrol yapma (ilk tick)
    if (prevPrice === undefined) {
      return;
    }

    // Bir sonraki yuvarlak sayıyı bul (yukarı)
    const nextLevelUp = Math.ceil(currentPrice / roundTo) * roundTo;
    // Bir önceki yuvarlak sayıyı bul (aşağı)
    const nextLevelDown = Math.floor(currentPrice / roundTo) * roundTo;

    // 🔥 UNIFIED COOLDOWN CHECK: Check cooldown by level only (not direction)
    // If we notified about 93,000 (UP), we must NOT notify about 93,000 (DOWN) for cooldown duration
    const levelUpKey = `${symbol}_${nextLevelUp}`;
    const levelDownKey = `${symbol}_${nextLevelDown}`;
      
    // HYSTERESIS CHECK: If price is still within "Close Range" of last triggered level, suppress ALL alerts
    const lastTriggered = this.lastTriggeredLevel.get(symbol);
    if (lastTriggered) {
      const { level: lastLevel, timestamp } = lastTriggered;
      const timeSince = Date.now() - timestamp;
      const closeRange = lastLevel * (this.HYSTERESIS_CLOSE_RANGE_PERCENT / 100);
      const distanceFromLastLevel = Math.abs(currentPrice - lastLevel);
        
      // If still within cooldown AND within close range, suppress all alerts for this symbol
      if (timeSince < this.NOTIFICATION_COOLDOWN && distanceFromLastLevel <= closeRange) {
        // Price is still wobbling around the last notified level - suppress
        return;
      }
    }

    // Clear triggers if price moved significantly away from levels
    // This allows new alerts when price returns to the level after moving away
    if (currentPrice >= nextLevelUp) {
      // Price moved above UP level - clear trigger (allows new alert if price comes back down)
      this.clearTriggered(levelUpKey);
    }
    
    if (currentPrice <= nextLevelDown) {
      // Price moved below DOWN level - clear trigger (allows new alert if price comes back up)
      this.clearTriggered(levelDownKey);
    }

    // Check unified cooldown for UP level
    if (this.shouldNotify(levelUpKey)) {
      await this.checkLevelApproach(symbol, currentPrice, prevPrice, nextLevelUp, proximityDeltaUp, 'up', name, emoji, config);
    }

    // Check unified cooldown for DOWN level
    if (this.shouldNotify(levelDownKey)) {
      await this.checkLevelApproach(symbol, currentPrice, prevPrice, nextLevelDown, proximityDeltaDown, 'down', name, emoji, config);
          }
  }

  /**
   * Check if price is approaching a specific level and send notification if conditions are met
   * REFACTORED: Unified logic for both UP and DOWN directions
   */
  async checkLevelApproach(symbol, currentPrice, prevPrice, targetLevel, proximityDelta, direction, name, emoji, config) {
    const distance = direction === 'up' 
      ? targetLevel - currentPrice  // Distance to level above
      : currentPrice - targetLevel;  // Distance to level below

    // Must be within proximity delta
    if (distance <= 0 || distance > proximityDelta) {
      return;
    }

    // 🔥 UNIFIED LEVEL KEY: No direction in key - prevents UP/DOWN flickering
    const levelKey = `${symbol}_${targetLevel}`;
      
    // Check if already triggered (in-memory check)
    if (this.isTriggered(levelKey)) {
      return;
    }

    // Zona muerta hesapla
    const deadZone = this.calculateDeadZone(targetLevel, proximityDelta, symbol);

    // Movement detection: Is price effectively moving TOWARDS the target from outside triggered zone?
    const isMovingTowards = direction === 'up' 
      ? currentPrice > prevPrice && prevPrice < targetLevel
      : currentPrice < prevPrice && prevPrice > targetLevel;

    // Check if price just crossed the level (prevent spam)
    const justCrossed = direction === 'up'
      ? prevPrice > targetLevel && currentPrice < targetLevel  // Was above, now below
      : prevPrice < targetLevel && currentPrice > targetLevel; // Was below, now above

    if (justCrossed) {
      // Price just crossed the level - don't send notification (spam prevention)
      return;
    }
        
    // Fiyat yuvarlak sayıya çok yakınsa (zona muerta içinde) VE hareket hedefe doğru değilse bildirim GÖNDERME
    const tooCloseToTarget = currentPrice >= deadZone.lower && currentPrice <= deadZone.upper;
        
    // Bildirim gönder: Zona muerta dışında VEYA hedefe doğru hareket
    if (!tooCloseToTarget || isMovingTowards) {
      // 🔥 CRITICAL: Mark as triggered BEFORE sending (prevents race condition)
      this.markTriggered(levelKey);
      this.markNotified(levelKey); // Unified cooldown
      
      // 🔥 HYSTERESIS: Record last triggered level
      this.lastTriggeredLevel.set(symbol, {
        level: targetLevel,
        timestamp: Date.now(),
        direction: direction
      });

      const directionEmoji = direction === 'up' ? '📈' : '📉';
      const directionText = direction === 'up' ? 'yaklaşıyor' : 'iniyor';
          
      console.log(`${directionEmoji} ${name} ${targetLevel.toLocaleString()}$ seviyesine ${directionText} (şu an: ${currentPrice.toFixed(2)}$, mesafe: ${distance.toFixed(2)}$)`);
      console.log(`   💡 Zona muerta: ${deadZone.lower.toFixed(2)} - ${deadZone.upper.toFixed(2)}, Hareket: ${isMovingTowards ? '✅ Hedefe doğru' : '❌ Hedefe doğru değil'}`);
      console.log(`   🔒 Unified cooldown key: ${levelKey} (applies to both UP and DOWN)`);
          
          try {
            await this.sendNotificationToAll(
              symbol,
              name,
              emoji,
              currentPrice,
          targetLevel,
          direction
            );
          } catch (error) {
        console.error(`❌ Error sending notification for ${symbol} ${targetLevel}$:`, error);
            // Hata durumunda trigger'ı geri al (bir sonraki denemede tekrar gönderilebilir)
        this.clearTriggered(levelKey);
        this.lastTriggeredLevel.delete(symbol);
          }
        } else {
          console.log(`⏸️  ${name} zona muerta içinde (${currentPrice.toFixed(2)}$), bildirim bekleniyor...`);
    }
  }

  /**
   * Bildirim gönderilmeli mi? (Debouncing)
   * REFACTORED: Uses unified level keys (no direction suffix)
   * If we notified about 93,000 (UP), we must NOT notify about 93,000 (DOWN) for cooldown duration
   */
  shouldNotify(levelKey) {
    const lastNotification = this.lastNotifications.get(levelKey);
    
    if (!lastNotification) return true;
    
    const timeSince = Date.now() - lastNotification;
    return timeSince >= this.NOTIFICATION_COOLDOWN;
  }

  /**
   * Bildirim gönderildi olarak işaretle
   * REFACTORED: Unified level key (no direction) - prevents UP/DOWN flickering
   */
  markNotified(levelKey) {
    this.lastNotifications.set(levelKey, Date.now());
  }

  /**
   * Seviye tetiklenmiş mi kontrol et
   * REFACTORED: Uses unified level keys (no direction suffix)
   */
  isTriggered(levelKey) {
    return this.triggeredLevels.has(levelKey);
  }

  /**
   * Seviyeyi tetiklenmiş olarak işaretle
   * REFACTORED: Unified level key (no direction) - prevents UP/DOWN flickering
   */
  markTriggered(levelKey) {
    this.triggeredLevels.set(levelKey, true);
  }

  /**
   * Seviye tetiklenmesini temizle
   * REFACTORED: Unified level key (no direction)
   */
  clearTriggered(levelKey) {
    this.triggeredLevels.delete(levelKey);
  }

  /**
   * SADECE PREMIUM/TRIAL kullanıcıların cihazlarına bildirim gönder
   * Bu otomatik price tracking bildirimi - premium özellik!
   * 
   * OPTIMIZED: Tek bir SQL sorgusu ile premium/trial kullanıcıların cihazlarını çekiyor
   * Artık her cihaz için ayrı getUserById çağrısı yapmıyor - çok daha hızlı!
   */
  /**
   * 🔥 MULTILINGUAL: Send notifications grouped by language
   * Turkish devices get Turkish messages, others get English (Global)
   */
  async sendNotificationToAll(symbol, name, emoji, currentPrice, targetPrice, direction) {
    try {
      // 🔥 OPTIMIZED: Tek sorguda premium/trial kullanıcıların TÜM cihazlarını al
      // Bu sorgu sadece premium/trial kullanıcıların cihazlarını döndürür
      const devices = await getPremiumTrialDevices();
      
      if (devices.length === 0) {
        console.log('📱 No premium/trial devices found');
        return;
      }

      console.log(`🔍 Found ${devices.length} premium/trial device(s) from database query`);
      
      // 🔥 MULTILINGUAL: Tokenları dile göre ayır
      const trTokens = [];
      const enTokens = []; // Türkçe olmayan herkes buraya (Global)
      let trCount = 0;
      let enCount = 0;
      let invalidTokensSkipped = 0;
      const userEmails = new Set();
      const normalUserEmails = new Set();
      const guestUserEmails = new Set();

      // Her cihaz için token kontrolü yap ve dile göre grupla
      for (const device of devices) {
        const token = device.expo_push_token;
        if (!token) {
          invalidTokensSkipped++;
          continue;
        }
        
        // Exclude test tokens
        const lowerToken = token.toLowerCase();
        if (lowerToken.includes('test') || lowerToken === 'unknown') {
          invalidTokensSkipped++;
          continue;
        }
        
        // Accept both Expo and FCM tokens (length validation)
        if (token.length <= 10) {
          invalidTokensSkipped++;
          continue;
        }

        // 🔥 MULTILINGUAL: Dil kontrolü (veritabanından 'language' alanı)
        // Varsayılan olarak 'tr' kabul ediyoruz (backward compatibility)
        const lang = device.language ? device.language.toLowerCase() : 'tr';
        const isTurkish = lang.startsWith('tr');
        
        // 🔥 DEBUG: Log ALL non-Turkish devices for troubleshooting (production'da da çalışmalı)
        if (!isTurkish) {
          console.log(`   📱 Device ${device.device_id?.substring(0, 20)}... - Language: ${device.language || 'NULL (default: tr)'}, IsTurkish: ${isTurkish}, Email: ${device.email || 'N/A'}, Platform: ${device.platform || 'N/A'}`);
        }

        if (isTurkish) {
          trTokens.push(token);
          trCount++;
        } else {
          enTokens.push(token);
          enCount++;
        }

        if (device.email) {
          userEmails.add(device.email);
          if (device.user_provider === 'guest') {
            guestUserEmails.add(device.email);
          } else {
            normalUserEmails.add(device.email);
          }
        }
      }

      console.log(`🔒 Premium check results:`);
      console.log(`   🇹🇷 Turkish devices: ${trCount}`);
      console.log(`   🌍 Global (non-Turkish) devices: ${enCount}`);
      console.log(`   👥 Unique premium/trial users: ${userEmails.size} (normal: ${normalUserEmails.size}, guest: ${guestUserEmails.size})`);
      console.log(`   🚫 Invalid tokens skipped: ${invalidTokensSkipped}`);
      
      // 🔥 DEBUG: Log sample of EN devices for troubleshooting
      if (enCount === 0 && devices.length > 0) {
        console.log(`   ⚠️ WARNING: No EN devices found but ${devices.length} total devices exist`);
        console.log(`   📋 Sample device languages (first 10):`);
        devices.slice(0, 10).forEach((device, idx) => {
          console.log(`      ${idx + 1}. Device ${device.device_id?.substring(0, 20)}... - Language: ${device.language || 'NULL'}, Email: ${device.email || 'N/A'}`);
        });
      }

      if (trTokens.length === 0 && enTokens.length === 0) {
        console.log('📱 No valid premium/trial device tokens found - notification not sent');
        return;
      }

      // 🔥 MULTILINGUAL: Mesajları hazırla
      const directionEmoji = direction === 'up' ? '📈' : '📉';
      
      // TR Mesajı
      const actionTextTr = direction === 'up' ? 'yaklaşıyor' : 'iniyor';
      const titleTr = `${symbol} ${directionEmoji}`;
      const formattedTargetTr = targetPrice.toLocaleString('en-US');
      const formattedCurrentTr = currentPrice.toFixed(2);
      const bodyTr = `${symbol} ${formattedTargetTr} $ seviyesine ${actionTextTr}! Şu anki fiyat: ${formattedCurrentTr}`;

      // EN Mesajı (Global - diğer herkes için)
      const actionTextEn = direction === 'up' ? 'is approaching' : 'is dropping to';
      const titleEn = `${symbol} ${directionEmoji}`;
      const formattedTargetEn = targetPrice.toLocaleString('en-US');
      const formattedCurrentEn = currentPrice.toFixed(2);
      const bodyEn = `${symbol} ${actionTextEn} ${formattedTargetEn} $ level! Current price: ${formattedCurrentEn}`;

      // 🔥 MULTILINGUAL: Paralel gönderim
      const promises = [];
      
      if (trTokens.length > 0) {
        console.log(`🇹🇷 Sending TR notification to ${trTokens.length} device(s)`);
        promises.push(
          sendPriceAlertNotification(trTokens, symbol, currentPrice, targetPrice, direction, titleTr, bodyTr)
        );
      }

      if (enTokens.length > 0) {
        console.log(`🌍 Sending EN (Global) notification to ${enTokens.length} device(s)`);
        promises.push(
          sendPriceAlertNotification(enTokens, symbol, currentPrice, targetPrice, direction, titleEn, bodyEn)
        );
      }

      // Tüm bildirimleri paralel gönder
      const results = await Promise.all(promises);
      const allSuccess = results.every(r => r === true);

      if (allSuccess) {
        console.log(`✅ Notifications sent successfully:`);
        if (trTokens.length > 0) {
          console.log(`   🇹🇷 TR: ${trTokens.length} device(s) - ${titleTr} - ${bodyTr}`);
        }
        if (enTokens.length > 0) {
          console.log(`   🌍 EN: ${enTokens.length} device(s) - ${titleEn} - ${bodyEn}`);
        }
      } else {
        console.log(`❌ Some notifications failed to send`);
      }
    } catch (error) {
      console.error('❌ Error sending notification to all:', error);
      console.error('Error details:', error.stack);
    }
  }

  /**
   * Custom alert'leri yükle ve WebSocket bağlantılarını kur
   */
  async loadCustomAlerts() {
    try {
      const alerts = await getAllActiveCustomAlerts();
      
      // Symbol bazında grupla
      const alertsBySymbol = new Map();
      alerts.forEach(alert => {
        const symbol = alert.symbol.toUpperCase();
        if (!alertsBySymbol.has(symbol)) {
          alertsBySymbol.set(symbol, []);
        }
        alertsBySymbol.get(symbol).push(alert);
      });
      
      // Cache'i güncelle
      this.customAlertsCache = alertsBySymbol;
      
      // Yeni symbol'ler için WebSocket bağlantısı kur
      alertsBySymbol.forEach((alerts, symbol) => {
        if (!this.wsConnections.has(symbol)) {
          console.log(`🔔 Connecting to custom alert symbol: ${symbol} (${alerts.length} alert(s))`);
          this.connectToSymbol(symbol);
        }
      });
      
      // Kullanılmayan symbol'leri temizle (alert yoksa bağlantıyı kapatma - mevcut sistem için)
      // Not: Mevcut sistem coin'leri (BTC, ETH, SOL, BNB) her zaman açık kalmalı
      
      const customSymbolCount = alertsBySymbol.size;
      if (customSymbolCount > 0) {
        console.log(`📊 Loaded ${alerts.length} custom alert(s) for ${customSymbolCount} symbol(s)`);
      }
    } catch (error) {
      console.error('❌ Error loading custom alerts:', error);
    }
  }

  /**
   * Custom alert'leri kontrol et ve bildirim gönder
   */
  async checkCustomAlerts(symbol, currentPrice) {
    const alerts = this.customAlertsCache.get(symbol.toUpperCase());
    if (!alerts || alerts.length === 0) return;
    
    for (const alert of alerts) {
      const { id, target_price, proximity_delta, direction, expo_push_token, last_notified_at, last_price } = alert;
      
      // 🔥 CRITICAL: Check if this alert was already triggered recently (in-memory check)
      const triggerKey = `custom_${id}`;
      const lastTriggered = this.triggeredCustomAlerts.get(triggerKey);
      if (lastTriggered) {
        const timeSince = Date.now() - lastTriggered;
        if (timeSince < this.NOTIFICATION_COOLDOWN) {
          continue; // Already triggered recently, skip
        }
      }
      
      // Cooldown kontrolü (5 dakika) - database check
      if (last_notified_at) {
        const timeSince = Date.now() - new Date(last_notified_at).getTime();
        if (timeSince < this.NOTIFICATION_COOLDOWN) {
          continue;
        }
      }
      
      // Yaklaşma kontrolü
      let shouldNotify = false;
      
      if (direction === 'up') {
        // Yukarı yönlü: Fiyat hedefin altında ama yaklaşıyor
        const distance = target_price - currentPrice;
        if (distance > 0 && distance <= proximity_delta) {
          // Önceki fiyat kontrolü (spam önleme)
          if (last_price && last_price >= target_price - proximity_delta && last_price < target_price) {
            continue; // Zaten bildirim gönderilmiş
          }
          shouldNotify = true;
        }
      } else {
        // Aşağı yönlü: Fiyat hedefin üstünde ama yaklaşıyor
        const distance = currentPrice - target_price;
        if (distance > 0 && distance <= proximity_delta) {
          // Önceki fiyat kontrolü (spam önleme)
          if (last_price && last_price <= target_price + proximity_delta && last_price > target_price) {
            continue; // Zaten bildirim gönderilmiş
          }
          shouldNotify = true;
        }
      }
      
      if (shouldNotify) {
        // 🔥 CRITICAL: Validate token BEFORE sending notification (prevents "No valid FCM tokens" spam)
        if (!expo_push_token) {
          console.log(`⏸️  Custom alert ${id} skipped: No push token for user ${alert.user_id}`);
          continue;
        }
        
        // Validate token format (same logic as unified-push.js)
        const lowerToken = expo_push_token.toLowerCase();
        if (lowerToken.includes('placeholder') || 
            lowerToken.includes('test') || 
            lowerToken === 'unknown' ||
            expo_push_token.length < 50) { // FCM tokens are typically longer
          console.log(`⏸️  Custom alert ${id} skipped: Invalid token format for user ${alert.user_id}`);
          continue;
        }
        
        // 🔥 CRITICAL: Mark as triggered BEFORE sending notification (prevent race condition)
        this.triggeredCustomAlerts.set(triggerKey, Date.now());
        
        // 🔥 MULTILINGUAL: Device language bilgisini al
        const deviceLang = alert.language ? alert.language.toLowerCase() : 'tr';
        const isTurkish = deviceLang.startsWith('tr');
        
        // 🔥 MULTILINGUAL: Mesajları hazırla
        const directionEmoji = direction === 'up' ? '📈' : '📉';
        
        let title, body;
        if (isTurkish) {
          // TR Mesajı
          const actionTextTr = direction === 'up' ? 'yaklaşıyor' : 'iniyor';
          title = `${symbol} ${directionEmoji}`;
          const formattedTargetTr = target_price.toLocaleString('en-US');
          const formattedCurrentTr = currentPrice.toFixed(2);
          body = `${symbol} ${formattedTargetTr} $ seviyesine ${actionTextTr}! Şu anki fiyat: ${formattedCurrentTr}`;
        } else {
          // EN Mesajı (Global)
          const actionTextEn = direction === 'up' ? 'is approaching' : 'is dropping to';
          title = `${symbol} ${directionEmoji}`;
          const formattedTargetEn = target_price.toLocaleString('en-US');
          const formattedCurrentEn = currentPrice.toFixed(2);
          body = `${symbol} ${actionTextEn} ${formattedTargetEn} $ level! Current price: ${formattedCurrentEn}`;
        }
        
        // Bildirim gönder
        try {
          const success = await sendPriceAlertNotification(
            [expo_push_token],
            symbol,
            currentPrice,
            target_price,
            direction,
            title,
            body // 🔥 MULTILINGUAL: Custom title/body gönder
          );
          
          if (success) {
            // Database'i güncelle
            await updatePriceAlertNotification(id, currentPrice);
            console.log(`✅ Custom alert triggered: ${symbol} @ ${target_price} (${direction}) for user ${alert.user_id} [${isTurkish ? 'TR' : 'EN'}]`);
          } else {
            // If notification failed, clear trigger to allow retry
            this.triggeredCustomAlerts.delete(triggerKey);
          }
        } catch (error) {
          console.error(`❌ Error sending custom alert notification:`, error);
          // If notification failed, clear trigger to allow retry
          this.triggeredCustomAlerts.delete(triggerKey);
        }
      }
    }
  }

  /**
   * Aktif bağlantılar ve fiyatlar
   */
  getStatus() {
    const status = {};
    
    // Mevcut sistem coin'leri
    Object.keys(this.watchList).forEach(symbol => {
      const price = this.priceCache.get(symbol);
      const connected = this.wsConnections.has(symbol);
      
      status[symbol] = {
        price: price || null,
        connected: connected,
        config: this.watchList[symbol],
        type: 'auto',
      };
    });
    
    // Custom alert coin'leri
    this.customAlertsCache.forEach((alerts, symbol) => {
      if (!status[symbol]) {
        const price = this.priceCache.get(symbol);
        const connected = this.wsConnections.has(symbol);
        
        status[symbol] = {
          price: price || null,
          connected: connected,
          alertCount: alerts.length,
          type: 'custom',
        };
      } else {
        status[symbol].alertCount = alerts.length;
        status[symbol].type = 'both';
      }
    });
    
    return status;
  }
}

// Singleton instance
let autoPriceAlertService = null;

export function getAutoPriceAlertService() {
  if (!autoPriceAlertService) {
    autoPriceAlertService = new AutoPriceAlertService();
  }
  return autoPriceAlertService;
}


