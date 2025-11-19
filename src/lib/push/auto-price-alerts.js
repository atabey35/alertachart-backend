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
    this.lastNotifications = new Map(); // Symbol + level için son bildirim zamanı
    this.triggeredLevels = new Map(); // Trigger edilmiş seviyeler (tekrar etmemek için)
    this.customAlertsCache = new Map(); // Custom alert'ler için cache (symbol -> alerts[])
    this.isRunning = false;
    this.customAlertsCheckInterval = null; // Custom alert'leri kontrol etmek için interval
    
    // COOLDOWN: Aynı seviye için 5 dakika bekle (15 dakikaydı, çok uzundu)
    this.NOTIFICATION_COOLDOWN = 5 * 60 * 1000; // 5 dakika
    
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

    // Zona muerta hesapla (proximity delta'ya göre)
    const deadZoneUp = this.calculateDeadZone(nextLevelUp, proximityDeltaUp, symbol);
    const deadZoneDown = this.calculateDeadZone(nextLevelDown, proximityDeltaDown, symbol);

    // YUKARIYA YAKLAŞMA KONTROLÜ
    const distanceToLevelUp = nextLevelUp - currentPrice;
    if (distanceToLevelUp > 0 && distanceToLevelUp <= proximityDeltaUp) {
      const key = `${symbol}_${nextLevelUp}_up`;
      
      // Cooldown ve trigger kontrolü
      if (this.shouldNotify(key) && !this.isTriggered(key)) {
        // ZONA MUERTA KONTROLÜ: Fiyat yukarıya doğru hareket ediyor mu?
        const isMovingUp = currentPrice > prevPrice;
        
        // ÖNEMLİ: Eğer önceki fiyat seviyenin ÜSTÜNDEYSE, şimdi ALTINA inmiş demektir
        // Bu durumda "yaklaşıyor" bildirimi GÖNDERMEMELİYİZ (yeni aşağı indi, spam olur)
        const justCrossedBelow = prevPrice > nextLevelUp && currentPrice < nextLevelUp;
        
        // Fiyat yuvarlak sayıya çok yakınsa (zona muerta içinde) VE hareket aşağı yönlüyse bildirim GÖNDERME
        const tooCloseToTarget = currentPrice >= deadZoneUp.lower && currentPrice <= deadZoneUp.upper;
        
        // Bildirim gönder: Cooldown OK + Triggered değil + Zona muerta dışında VEYA yukarı hareket + Yeni aşağı geçiş DEĞİL
        if ((!tooCloseToTarget || isMovingUp) && !justCrossedBelow) {
          // 🔥 CRITICAL FIX: Trigger'ı ÖNCE işaretle (bildirim gönderilirken yeni kontrolleri engelle)
          this.markTriggered(key);
          this.markNotified(key);
          
          console.log(`📈 ${name} ${nextLevelUp.toLocaleString()}$ seviyesine yaklaşıyor (şu an: ${currentPrice.toFixed(2)}$, mesafe: ${distanceToLevelUp.toFixed(2)}$)`);
          console.log(`   💡 Zona muerta: ${deadZoneUp.lower.toFixed(2)} - ${deadZoneUp.upper.toFixed(2)}, Hareket: ${isMovingUp ? '⬆️' : '⬇️'}`);
          
          try {
            await this.sendNotificationToAll(
              symbol,
              name,
              emoji,
              currentPrice,
              nextLevelUp,
              'up'
            );
          } catch (error) {
            console.error(`❌ Error sending notification for ${symbol} ${nextLevelUp}$:`, error);
            // Hata durumunda trigger'ı geri al (bir sonraki denemede tekrar gönderilebilir)
            this.clearTriggered(key);
          }
        } else if (justCrossedBelow) {
          console.log(`⏸️  ${name} seviyeyi yeni aşağı geçti (${currentPrice.toFixed(2)}$), "yaklaşıyor" bildirimi gönderilmedi`);
        } else {
          console.log(`⏸️  ${name} zona muerta içinde (${currentPrice.toFixed(2)}$), bildirim bekleniyor...`);
        }
      }
    } else if (currentPrice >= nextLevelUp) {
      // Seviye geçildi, trigger'ı sıfırla
      const key = `${symbol}_${nextLevelUp}_up`;
      this.clearTriggered(key);
    }

    // AŞAĞIYA YAKLAŞMA KONTROLÜ
    const distanceToLevelDown = currentPrice - nextLevelDown;
    if (distanceToLevelDown > 0 && distanceToLevelDown <= proximityDeltaDown) {
      const key = `${symbol}_${nextLevelDown}_down`;
      
      // Cooldown ve trigger kontrolü
      if (this.shouldNotify(key) && !this.isTriggered(key)) {
        // ZONA MUERTA KONTROLÜ: Fiyat aşağıya doğru hareket ediyor mu?
        const isMovingDown = currentPrice < prevPrice;
        
        // ÖNEMLİ: Eğer önceki fiyat seviyenin ALTINDAYSA, şimdi ÜSTÜNE çıkmış demektir
        // Bu durumda "iniyor" bildirimi GÖNDERMEMELİYİZ (yeni yukarı çıktı, spam olur)
        const justCrossedAbove = prevPrice < nextLevelDown && currentPrice > nextLevelDown;
        
        // Fiyat yuvarlak sayıya çok yakınsa (zona muerta içinde) VE hareket yukarı yönlüyse bildirim GÖNDERME
        const tooCloseToTarget = currentPrice >= deadZoneDown.lower && currentPrice <= deadZoneDown.upper;
        
        // Bildirim gönder: Cooldown OK + Triggered değil + Zona muerta dışında VEYA aşağı hareket + Yeni yukarı geçiş DEĞİL
        if ((!tooCloseToTarget || isMovingDown) && !justCrossedAbove) {
          // 🔥 CRITICAL FIX: Trigger'ı ÖNCE işaretle (bildirim gönderilirken yeni kontrolleri engelle)
          this.markTriggered(key);
          this.markNotified(key);
          
          console.log(`📉 ${name} ${nextLevelDown.toLocaleString()}$ seviyesine iniyor (şu an: ${currentPrice.toFixed(2)}$, mesafe: ${distanceToLevelDown.toFixed(2)}$)`);
          console.log(`   💡 Zona muerta: ${deadZoneDown.lower.toFixed(2)} - ${deadZoneDown.upper.toFixed(2)}, Hareket: ${isMovingDown ? '⬇️' : '⬆️'}`);
          
          try {
            await this.sendNotificationToAll(
              symbol,
              name,
              emoji,
              currentPrice,
              nextLevelDown,
              'down'
            );
          } catch (error) {
            console.error(`❌ Error sending notification for ${symbol} ${nextLevelDown}$:`, error);
            // Hata durumunda trigger'ı geri al (bir sonraki denemede tekrar gönderilebilir)
            this.clearTriggered(key);
          }
        } else if (justCrossedAbove) {
          console.log(`⏸️  ${name} seviyeyi yeni yukarı geçti (${currentPrice.toFixed(2)}$), "iniyor" bildirimi gönderilmedi`);
        } else {
          console.log(`⏸️  ${name} zona muerta içinde (${currentPrice.toFixed(2)}$), bildirim bekleniyor...`);
        }
      }
    } else if (currentPrice <= nextLevelDown) {
      // Seviye geçildi, trigger'ı sıfırla
      const key = `${symbol}_${nextLevelDown}_down`;
      this.clearTriggered(key);
    }
  }

  /**
   * Bildirim gönderilmeli mi? (Debouncing)
   */
  shouldNotify(key) {
    const lastNotification = this.lastNotifications.get(key);
    
    if (!lastNotification) return true;
    
    const timeSince = Date.now() - lastNotification;
    return timeSince >= this.NOTIFICATION_COOLDOWN;
  }

  /**
   * Bildirim gönderildi olarak işaretle
   */
  markNotified(key) {
    this.lastNotifications.set(key, Date.now());
  }

  /**
   * Seviye tetiklenmiş mi kontrol et
   */
  isTriggered(key) {
    return this.triggeredLevels.has(key);
  }

  /**
   * Seviyeyi tetiklenmiş olarak işaretle
   */
  markTriggered(key) {
    this.triggeredLevels.set(key, true);
  }

  /**
   * Seviye tetiklenmesini temizle
   */
  clearTriggered(key) {
    this.triggeredLevels.delete(key);
  }

  /**
   * SADECE PREMIUM/TRIAL kullanıcıların cihazlarına bildirim gönder
   * Bu otomatik price tracking bildirimi - premium özellik!
   * 
   * OPTIMIZED: Tek bir SQL sorgusu ile premium/trial kullanıcıların cihazlarını çekiyor
   * Artık her cihaz için ayrı getUserById çağrısı yapmıyor - çok daha hızlı!
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
      
      // DEBUG: Log all devices found
      if (devices.length > 0) {
        console.log(`📋 Devices breakdown:`);
        devices.forEach((device, index) => {
          console.log(`   ${index + 1}. ${device.email} (ID: ${device.user_id}) - Device: ${device.device_id}, Plan: ${device.plan}, Expiry: ${device.expiry_date || 'LIFETIME'}`);
        });
      }

      // Push token'ları topla
      // Support both Expo tokens and FCM tokens
      const uniqueTokens = new Set();
      let validDevicesCount = 0;
      let invalidTokensSkipped = 0;
      const userEmails = new Set(); // Debug için: kaç farklı kullanıcı var

      // Her cihaz için token kontrolü yap (premium kontrolü zaten SQL'de yapıldı)
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

        // Token geçerli - ekle
        uniqueTokens.add(token);
        validDevicesCount++;
        if (device.email) {
          userEmails.add(device.email);
        }
      }

      const tokens = Array.from(uniqueTokens);

      console.log(`🔒 Premium check results:`);
      console.log(`   ✅ Premium/Trial devices: ${validDevicesCount}`);
      console.log(`   👥 Unique premium/trial users: ${userEmails.size}`);
      console.log(`   🚫 Invalid tokens skipped: ${invalidTokensSkipped}`);
      console.log(`   📋 User emails: ${Array.from(userEmails).join(', ')}`);

      if (tokens.length === 0) {
        console.log('📱 No valid premium/trial device tokens found - notification not sent');
        return;
      }

      console.log(`📤 Sending notification to ${tokens.length} premium/trial device(s)...`);

      // Bildirim mesajı
      const directionEmoji = direction === 'up' ? '📈' : '📉';
      const directionText = direction === 'up' ? 'yaklaşıyor' : 'iniyor';
      const title = `${symbol} ${directionEmoji}`;
      const body = `${symbol} ${targetPrice.toLocaleString()} $ seviyesine ${directionText}! Şu anki fiyat: ${currentPrice.toFixed(2)}`;

      // Push notification gönder
      const success = await sendPriceAlertNotification(
        tokens,
        symbol,
        currentPrice,
        targetPrice,
        direction
      );

      if (success) {
        console.log(`✅ Notification sent to ${tokens.length} premium/trial device(s) from ${userEmails.size} user(s): ${title} - ${body}`);
      } else {
        console.log(`❌ Failed to send notification`);
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
      
      // Cooldown kontrolü (5 dakika)
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
        // Bildirim gönder
        try {
          const success = await sendPriceAlertNotification(
            [expo_push_token],
            symbol,
            currentPrice,
            target_price,
            direction
          );
          
          if (success) {
            // Database'i güncelle
            await updatePriceAlertNotification(id, currentPrice);
            console.log(`✅ Custom alert triggered: ${symbol} @ ${target_price} (${direction}) for user ${alert.user_id}`);
          }
        } catch (error) {
          console.error(`❌ Error sending custom alert notification:`, error);
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


