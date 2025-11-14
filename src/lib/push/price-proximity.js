import WebSocket from 'ws';
import {
  getActivePriceAlertsBySymbol,
  updatePriceAlertNotification,
} from './db';
import { sendPriceAlertNotification } from './unified-push.js';

interface PriceUpdate {
  symbol: string;
  price: number;
  timestamp: number;
}

interface AlertCheck {
  id: number;
  deviceId: string;
  symbol: string;
  targetPrice: number;
  proximityDelta: number;
  direction: 'up' | 'down';
  lastNotifiedAt: Date | null;
  lastPrice: number | null;
  expoPushToken: string;
}

/**
 * Fiyat yaklaşma kontrolü ve bildirim servisi
 * WebSocket üzerinden canlı fiyat güncellemelerini dinler
 */
export class PriceProximityService {
  private wsConnections: Map<string, WebSocket> = new Map();
  private priceCache: Map<string, number> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  // Debouncing için son bildirim zamanları
  private readonly NOTIFICATION_COOLDOWN = 30 * 60 * 1000; // 30 dakika

  /**
   * Servisi başlat
   */
  public start(): void {
    if (this.isRunning) {
      console.warn('Price proximity service already running');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Price proximity service started');

    // Periyodik kontrol (her 10 saniyede bir)
    this.checkInterval = setInterval(() => {
      this.checkAllAlerts();
    }, 10000);

    // İlk kontrolü hemen yap
    this.checkAllAlerts();
  }

  /**
   * Servisi durdur
   */
  public stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    // Interval'i temizle
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // WebSocket bağlantılarını kapat
    this.wsConnections.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
    this.wsConnections.clear();

    console.log('🛑 Price proximity service stopped');
  }

  /**
   * Belirli bir symbol için WebSocket bağlantısı kur
   */
  private connectToSymbol(symbol: string): void {
    if (this.wsConnections.has(symbol)) return;

    const exchange = this.getExchangeForSymbol(symbol);
    const wsUrl = this.getWebSocketUrl(exchange, symbol);

    try {
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        console.log(`✅ Connected to ${symbol} price feed`);
        this.subscribeToSymbol(ws, exchange, symbol);
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          const price = this.extractPrice(message, exchange);
          
          if (price) {
            this.priceCache.set(symbol, price);
          }
        } catch (error) {
          console.error(`Error parsing price data for ${symbol}:`, error);
        }
      });

      ws.on('error', (error) => {
        console.error(`WebSocket error for ${symbol}:`, error);
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
   * Symbol için hangi exchange'i kullanacağımızı belirle
   */
  private getExchangeForSymbol(symbol: string): string {
    // USDT pair'leri için Binance
    if (symbol.endsWith('USDT')) return 'BINANCE';
    // TRY pair'leri için Binance TR veya Bybit
    if (symbol.endsWith('TRY')) return 'BINANCE';
    // Default
    return 'BINANCE';
  }

  /**
   * Exchange ve symbol için WebSocket URL'i oluştur
   */
  private getWebSocketUrl(exchange: string, symbol: string): string {
    const lowerSymbol = symbol.toLowerCase();

    switch (exchange) {
      case 'BINANCE':
        return `wss://stream.binance.com:9443/ws/${lowerSymbol}@ticker`;
      case 'BYBIT':
        return `wss://stream.bybit.com/v5/public/spot`;
      default:
        return `wss://stream.binance.com:9443/ws/${lowerSymbol}@ticker`;
    }
  }

  /**
   * WebSocket'e subscribe mesajı gönder
   */
  private subscribeToSymbol(ws: WebSocket, exchange: string, symbol: string): void {
    if (exchange === 'BYBIT') {
      ws.send(JSON.stringify({
        op: 'subscribe',
        args: [`tickers.${symbol}`],
      }));
    }
    // Binance otomatik subscribe oluyor
  }

  /**
   * Exchange'den gelen mesajdan fiyatı çıkar
   */
  private extractPrice(message: any, exchange: string): number | null {
    try {
      switch (exchange) {
        case 'BINANCE':
          return message.c ? parseFloat(message.c) : null; // 'c' = current price
        case 'BYBIT':
          return message.data?.lastPrice ? parseFloat(message.data.lastPrice) : null;
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Tüm aktif alert'leri kontrol et
   */
  private async checkAllAlerts(): Promise<void> {
    try {
      // Unique symbol'leri bul ve WebSocket bağlantılarını kur
      const symbols = Array.from(new Set(
        Array.from(this.priceCache.keys())
      ));

      // Her symbol için alert'leri kontrol et
      for (const symbol of symbols) {
        const currentPrice = this.priceCache.get(symbol);
        if (!currentPrice) continue;

        await this.checkAlertsForSymbol(symbol, currentPrice);
      }

      // Yeni symbol'ler için WebSocket bağlantısı kur
      await this.connectNewSymbols();
    } catch (error) {
      console.error('Error checking alerts:', error);
    }
  }

  /**
   * Yeni symbol'ler için bağlantı kur
   */
  private async connectNewSymbols(): Promise<void> {
    try {
      // DB'den tüm aktif symbol'leri al
      // Bu basit implementasyonda, bilinen symbol'leri manuel ekleyebiliriz
      const commonSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
      
      for (const symbol of commonSymbols) {
        if (!this.wsConnections.has(symbol)) {
          this.connectToSymbol(symbol);
        }
      }
    } catch (error) {
      console.error('Error connecting new symbols:', error);
    }
  }

  /**
   * Belirli bir symbol için alert'leri kontrol et
   */
  private async checkAlertsForSymbol(symbol: string, currentPrice: number): Promise<void> {
    try {
      const alerts = await getActivePriceAlertsBySymbol(symbol) as AlertCheck[];

      for (const alert of alerts) {
        const shouldNotify = this.shouldSendNotification(alert, currentPrice);

        if (shouldNotify) {
          await this.sendNotification(alert, currentPrice);
        }
      }
    } catch (error) {
      console.error(`Error checking alerts for ${symbol}:`, error);
    }
  }

  /**
   * Bildirim gönderilmeli mi?
   */
  private shouldSendNotification(alert: AlertCheck, currentPrice: number): boolean {
    const { targetPrice, proximityDelta, direction, lastNotifiedAt, lastPrice } = alert;

    // Debouncing: Son bildirimden 30 dk geçmemiş ise gönderme
    if (lastNotifiedAt) {
      const timeSinceLastNotification = Date.now() - new Date(lastNotifiedAt).getTime();
      if (timeSinceLastNotification < this.NOTIFICATION_COOLDOWN) {
        return false;
      }
    }

    // Yaklaşma aralığı
    const proximityMin = targetPrice - proximityDelta;
    const proximityMax = targetPrice + proximityDelta;

    if (direction === 'up') {
      // Yukarı yönlü: Fiyat hedefin altında ama yaklaşıyor
      const inProximity = currentPrice >= proximityMin && currentPrice < targetPrice;
      
      // Eğer daha önce bildirim gönderilmiş ve fiyat aralığın dışına çıkmamışsa, tekrar gönderme
      if (lastPrice && inProximity) {
        const wasInProximity = lastPrice >= proximityMin && lastPrice < targetPrice;
        if (wasInProximity) return false;
      }

      return inProximity;
    } else {
      // Aşağı yönlü: Fiyat hedefin üstünde ama yaklaşıyor
      const inProximity = currentPrice <= proximityMax && currentPrice > targetPrice;
      
      if (lastPrice && inProximity) {
        const wasInProximity = lastPrice <= proximityMax && lastPrice > targetPrice;
        if (wasInProximity) return false;
      }

      return inProximity;
    }
  }

  /**
   * Bildirim gönder
   */
  private async sendNotification(alert: AlertCheck, currentPrice: number): Promise<void> {
    try {
      const success = await sendPriceAlertNotification(
        [alert.expoPushToken],
        alert.symbol,
        currentPrice,
        alert.targetPrice,
        alert.direction
      );

      if (success) {
        // DB'yi güncelle
        await updatePriceAlertNotification(alert.id, currentPrice);
        console.log(`✅ Sent proximity notification: ${alert.symbol} @ ${currentPrice}`);
      }
    } catch (error) {
      console.error('Error sending notification:', error);
    }
  }

  /**
   * Manuel fiyat güncelleme (test için)
   */
  public updatePrice(symbol: string, price: number): void {
    this.priceCache.set(symbol, price);
    console.log(`💰 Price updated: ${symbol} = ${price}`);
  }

  /**
   * Aktif bağlantılar
   */
  public getConnections(): string[] {
    return Array.from(this.wsConnections.keys());
  }
}

// Singleton instance
let priceProximityService: PriceProximityService | null = null;

export function getPriceProximityService(): PriceProximityService {
  if (!priceProximityService) {
    priceProximityService = new PriceProximityService();
  }
  return priceProximityService;
}

