/**
 * Otomatik Fiyat Yaklaşma Bildirimleri
 * Önemli fiyat seviyelerine yaklaşınca TÜM kullanıcılara bildirim gönderir
 */

import WebSocket from 'ws';
import { getAllActiveDevices } from './db.js';
import { sendPriceAlertNotification } from './expo-push.js';

/**
 * Otomatik fiyat uyarı servisi
 * BTC 106k, ETH 4k gibi önemli seviyelere yaklaşınca herkese bildirim
 */
export class AutoPriceAlertService {
  constructor() {
    this.wsConnections = new Map();
    this.priceCache = new Map();
    this.lastNotifications = new Map(); // Symbol + level için son bildirim zamanı
    this.isRunning = false;
    
    // Debouncing: Aynı seviye için 1 saat bekle
    this.NOTIFICATION_COOLDOWN = 60 * 60 * 1000; // 1 saat
    
    // İzlenecek coin'ler ve önemli seviyeleri
    this.watchList = {
      'BTCUSDT': {
        name: 'Bitcoin',
        emoji: '₿',
        roundTo: 1000, // Her 1000$ bir seviye
        proximityDelta: 200, // $200 yaklaştığında bildir
      },
      'ETHUSDT': {
        name: 'Ethereum',
        emoji: 'Ξ',
        roundTo: 100, // Her 100$ bir seviye
        proximityDelta: 20, // $20 yaklaştığında bildir
      },
      'SOLUSDT': {
        name: 'Solana',
        emoji: '◎',
        roundTo: 10, // Her 10$ bir seviye
        proximityDelta: 2, // $2 yaklaştığında bildir
      },
      'BNBUSDT': {
        name: 'BNB',
        emoji: '🔶',
        roundTo: 50, // Her 50$ bir seviye
        proximityDelta: 5, // $5 yaklaştığında bildir
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
  }

  /**
   * Servisi durdur
   */
  stop() {
    if (!this.isRunning) return;

    this.isRunning = false;

    // WebSocket bağlantılarını kapat
    this.wsConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
    this.wsConnections.clear();

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
            this.priceCache.set(symbol, price);
            
            // Fiyat değiştiğinde kontrol et
            if (oldPrice !== price) {
              this.checkPriceLevel(symbol, price);
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
   * Fiyat seviyesini kontrol et ve gerekirse bildirim gönder
   */
  async checkPriceLevel(symbol, currentPrice) {
    const config = this.watchList[symbol];
    if (!config) return;

    const { roundTo, proximityDelta, name, emoji } = config;

    // Bir sonraki yuvarlak sayıyı bul (yukarı)
    const nextLevelUp = Math.ceil(currentPrice / roundTo) * roundTo;
    // Bir önceki yuvarlak sayıyı bul (aşağı)
    const nextLevelDown = Math.floor(currentPrice / roundTo) * roundTo;

    // Yukarı yaklaşma kontrolü
    if (nextLevelUp - currentPrice <= proximityDelta && currentPrice < nextLevelUp) {
      const key = `${symbol}_${nextLevelUp}_up`;
      
      if (this.shouldNotify(key)) {
        console.log(`📈 ${name} approaching $${nextLevelUp.toLocaleString()} (current: $${currentPrice.toFixed(2)})`);
        await this.sendNotificationToAll(
          symbol,
          name,
          emoji,
          currentPrice,
          nextLevelUp,
          'up'
        );
        this.markNotified(key);
      }
    }

    // Aşağı yaklaşma kontrolü
    if (currentPrice - nextLevelDown <= proximityDelta && currentPrice > nextLevelDown) {
      const key = `${symbol}_${nextLevelDown}_down`;
      
      if (this.shouldNotify(key)) {
        console.log(`📉 ${name} approaching $${nextLevelDown.toLocaleString()} (current: $${currentPrice.toFixed(2)})`);
        await this.sendNotificationToAll(
          symbol,
          name,
          emoji,
          currentPrice,
          nextLevelDown,
          'down'
        );
        this.markNotified(key);
      }
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
   * TÜM aktif cihazlara bildirim gönder
   */
  async sendNotificationToAll(symbol, name, emoji, currentPrice, targetPrice, direction) {
    try {
      // TÜM aktif cihazları al
      const devices = await getAllActiveDevices();
      
      if (devices.length === 0) {
        console.log('📱 No active devices found');
        return;
      }

      // Push token'ları topla (sadece geçerli olanlar)
      const tokens = devices
        .map(d => d.expo_push_token)
        .filter(token => token && !token.includes('test-token'));

      if (tokens.length === 0) {
        console.log('📱 No valid push tokens found');
        return;
      }

      console.log(`📤 Sending notification to ${tokens.length} device(s)...`);

      // Bildirim mesajı
      const directionEmoji = direction === 'up' ? '📈' : '📉';
      const directionText = direction === 'up' ? 'yaklaşıyor' : 'iniyor';
      const title = `${emoji} ${name} Fiyat Uyarısı`;
      const body = `${directionEmoji} $${targetPrice.toLocaleString()} seviyesine ${directionText}! Şu an: $${currentPrice.toFixed(2)}`;

      // Push notification gönder
      const success = await sendPriceAlertNotification(
        tokens,
        symbol,
        currentPrice,
        targetPrice,
        direction
      );

      if (success) {
        console.log(`✅ Notification sent: ${title} - ${body}`);
      } else {
        console.log(`❌ Failed to send notification`);
      }
    } catch (error) {
      console.error('❌ Error sending notification to all:', error);
    }
  }

  /**
   * Aktif bağlantılar ve fiyatlar
   */
  getStatus() {
    const status = {};
    
    Object.keys(this.watchList).forEach(symbol => {
      const price = this.priceCache.get(symbol);
      const connected = this.wsConnections.has(symbol);
      
      status[symbol] = {
        price: price || null,
        connected: connected,
        config: this.watchList[symbol],
      };
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

