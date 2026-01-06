/**
 * Yüzde Değişim Bildirimleri (PREMIUM ÖZELLİK)
 * Fiyat belirli sürelerde belirli yüzde değiştiğinde bildirim gönderir
 */

import WebSocket from 'ws';
import { getPremiumTrialDevices, getCustomAlertsByType, updateCustomAlertNotification } from './db.js';
import { sendPriceAlertNotification, sendPushNotifications, formatPriceString } from './unified-push.js';

/**
 * Yüzde değişim takip servisi
 * BTC %5 düştü, ETH %10 yükseldi gibi bildirimleri yönetir
 */
export class PercentageAlertService {
    constructor() {
        this.wsConnections = new Map();
        this.priceCache = new Map(); // Güncel fiyatlar
        this.priceHistory = new Map(); // Geçmiş fiyatlar (symbol -> {timeframe: [prices]})
        this.lastNotifications = new Map(); // Son bildirim zamanları (spam önleme)
        this.isRunning = false;
        this.historyInterval = null;

        // Bildirim cooldown - Aynı symbol+timeframe+direction için 30 dakika bekle
        this.NOTIFICATION_COOLDOWN = 30 * 60 * 1000; // 30 dakika

        // Geçmiş kayıt aralığı - Her 1 dakikada bir fiyat kaydet
        this.HISTORY_RECORD_INTERVAL = 60 * 1000; // 1 dakika

        // İzlenecek coin'ler ve yapılandırmaları
        this.watchList = {
            'BTCUSDT': {
                name: 'Bitcoin',
                emoji: '₿',
                thresholds: [3, 5, 7, 10], // Bildirim gönderilecek yüzde değişimler
                timeframes: {
                    60: '1 saat',      // 60 dakika
                    240: '4 saat',     // 240 dakika
                    1440: '24 saat',   // 1440 dakika (1 gün)
                },
            },
            'ETHUSDT': {
                name: 'Ethereum',
                emoji: 'Ξ',
                thresholds: [4, 7, 10, 15],
                timeframes: {
                    60: '1 saat',
                    240: '4 saat',
                    1440: '24 saat',
                },
            },
            'SOLUSDT': {
                name: 'Solana',
                emoji: '◎',
                thresholds: [5, 10, 15, 20],
                timeframes: {
                    60: '1 saat',
                    240: '4 saat',
                    1440: '24 saat',
                },
            },
            'BNBUSDT': {
                name: 'BNB',
                emoji: '🔶',
                thresholds: [4, 7, 10, 15],
                timeframes: {
                    60: '1 saat',
                    240: '4 saat',
                    1440: '24 saat',
                },
            },
        };

        // Her symbol için history yapısını başlat
        Object.keys(this.watchList).forEach(symbol => {
            this.priceHistory.set(symbol, {
                prices: [], // [{price, timestamp}]
                maxAge: 1440 * 60 * 1000, // 24 saat tutulacak
            });
        });

        // Custom alert'ler için cache
        this.customAlertsCache = new Map(); // symbol -> [alerts]
        this.customAlertsCheckInterval = null;
    }

    /**
     * Servisi başlat
     */
    start() {
        if (this.isRunning) {
            console.warn('⚠️  Percentage alert service already running');
            return;
        }

        this.isRunning = true;
        console.log('🚀 Percentage Alert Service started');
        console.log(`📊 Watching ${Object.keys(this.watchList).length} symbols for percentage changes`);

        Object.entries(this.watchList).forEach(([symbol, config]) => {
            console.log(`   ${config.emoji} ${config.name}: ${config.thresholds.join('%, ')}% thresholds`);
        });

        // Her symbol için WebSocket bağlantısı kur
        Object.keys(this.watchList).forEach(symbol => {
            this.connectToSymbol(symbol);
        });

        // Custom alert'leri yükle
        this.loadCustomAlerts();

        // Her 30 saniyede custom alert'leri yeniden yükle
        this.customAlertsCheckInterval = setInterval(() => {
            if (this.isRunning) {
                this.loadCustomAlerts();
            }
        }, 30000);

        // Periyodik fiyat kaydı ve kontrol
        this.historyInterval = setInterval(() => {
            if (this.isRunning) {
                this.recordPrices();
                this.checkPercentageChanges();
                this.checkCustomPercentageAlerts();
            }
        }, this.HISTORY_RECORD_INTERVAL);
    }

    /**
     * Servisi durdur
     */
    stop() {
        if (!this.isRunning) return;

        this.isRunning = false;

        if (this.historyInterval) {
            clearInterval(this.historyInterval);
            this.historyInterval = null;
        }

        if (this.customAlertsCheckInterval) {
            clearInterval(this.customAlertsCheckInterval);
            this.customAlertsCheckInterval = null;
        }

        this.wsConnections.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        });
        this.wsConnections.clear();
        this.customAlertsCache.clear();

        console.log('🛑 Percentage alert service stopped');
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
                console.log(`✅ [PercentageAlerts] Connected to ${symbol} price feed`);
            });

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    const price = parseFloat(message.c); // 'c' = current price

                    if (price) {
                        this.priceCache.set(symbol, price);
                    }
                } catch (error) {
                    console.error(`[PercentageAlerts] Error parsing ${symbol}:`, error);
                }
            });

            ws.on('error', (error) => {
                console.error(`[PercentageAlerts] WebSocket error for ${symbol}:`, error.message);
            });

            ws.on('close', () => {
                console.log(`❌ [PercentageAlerts] Disconnected from ${symbol}`);
                this.wsConnections.delete(symbol);

                // Yeniden bağlan
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
            console.error(`[PercentageAlerts] Failed to connect to ${symbol}:`, error);
        }
    }

    /**
     * Güncel fiyatları history'ye kaydet
     */
    recordPrices() {
        const now = Date.now();

        this.priceCache.forEach((price, symbol) => {
            const history = this.priceHistory.get(symbol);
            if (!history) return;

            // Yeni fiyat kaydı ekle
            history.prices.push({ price, timestamp: now });

            // Eski kayıtları temizle (24 saatten eski)
            const cutoff = now - history.maxAge;
            history.prices = history.prices.filter(p => p.timestamp > cutoff);
        });
    }

    /**
     * Yüzde değişimlerini kontrol et
     */
    async checkPercentageChanges() {
        const now = Date.now();

        for (const [symbol, config] of Object.entries(this.watchList)) {
            const currentPrice = this.priceCache.get(symbol);
            const history = this.priceHistory.get(symbol);

            if (!currentPrice || !history || history.prices.length === 0) continue;

            // Her timeframe için kontrol et
            for (const [minutes, label] of Object.entries(config.timeframes)) {
                const timeframeMs = parseInt(minutes) * 60 * 1000;
                const cutoff = now - timeframeMs;

                // Bu timeframe için en eski fiyatı bul
                const oldPrices = history.prices.filter(p => p.timestamp <= cutoff + 60000); // 1 dakika tolerans
                if (oldPrices.length === 0) continue;

                // En eski fiyatı al (timeframe başlangıcına en yakın)
                const oldestPrice = oldPrices.reduce((closest, p) => {
                    const closestDiff = Math.abs(closest.timestamp - cutoff);
                    const pDiff = Math.abs(p.timestamp - cutoff);
                    return pDiff < closestDiff ? p : closest;
                });

                // Yüzde değişimi hesapla
                const percentChange = ((currentPrice - oldestPrice.price) / oldestPrice.price) * 100;
                const absChange = Math.abs(percentChange);
                const direction = percentChange > 0 ? 'up' : 'down';

                // Threshold'ları kontrol et (büyükten küçüğe)
                const sortedThresholds = [...config.thresholds].sort((a, b) => b - a);

                for (const threshold of sortedThresholds) {
                    if (absChange >= threshold) {
                        // Cooldown kontrolü
                        const cooldownKey = `${symbol}_${minutes}_${threshold}_${direction}`;

                        if (this.shouldNotify(cooldownKey)) {
                            // Bildirim gönder
                            await this.sendNotificationToAll(
                                symbol,
                                config.name,
                                config.emoji,
                                currentPrice,
                                oldestPrice.price,
                                percentChange,
                                label,
                                threshold
                            );

                            this.markNotified(cooldownKey);

                            // En büyük threshold'u bulduk, diğerlerini kontrol etme
                            break;
                        }
                    }
                }
            }
        }
    }

    /**
     * Bildirim gönderilmeli mi? (Cooldown kontrolü)
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
     * Premium/Trial kullanıcılara bildirim gönder
     */
    async sendNotificationToAll(symbol, name, emoji, currentPrice, oldPrice, percentChange, timeframeLabel, threshold) {
        try {
            const devices = await getPremiumTrialDevices();

            if (devices.length === 0) {
                console.log('[PercentageAlerts] No premium/trial devices found');
                return;
            }

            // Tokenları dile göre ayır
            const trTokens = [];
            const enTokens = [];

            for (const device of devices) {
                const token = device.expo_push_token;
                if (!token || token.length <= 10) continue;

                const lowerToken = token.toLowerCase();
                if (lowerToken.includes('test') || lowerToken === 'unknown') continue;

                const lang = device.language ? device.language.toLowerCase() : 'tr';
                const isTurkish = lang.startsWith('tr');

                if (isTurkish) {
                    trTokens.push(token);
                } else {
                    enTokens.push(token);
                }
            }

            if (trTokens.length === 0 && enTokens.length === 0) {
                console.log('[PercentageAlerts] No valid tokens');
                return;
            }

            // Mesajları hazırla
            const direction = percentChange > 0 ? 'up' : 'down';
            const directionEmoji = direction === 'up' ? '📈' : '📉';
            const absChange = Math.abs(percentChange).toFixed(1);
            const formattedCurrent = formatPriceString(currentPrice);
            const formattedOld = formatPriceString(oldPrice);

            // TR Mesajı
            const actionTr = direction === 'up' ? 'yükseldi' : 'düştü';
            const titleTr = `${emoji} ${name} %${absChange} ${actionTr}! ${directionEmoji}`;
            const bodyTr = `Son ${timeframeLabel}de: $${formattedOld} → $${formattedCurrent}`;

            // EN Mesajı
            const actionEn = direction === 'up' ? 'up' : 'down';
            const titleEn = `${emoji} ${name} ${absChange}% ${actionEn}! ${directionEmoji}`;
            const bodyEn = `Last ${timeframeLabel}: $${formattedOld} → $${formattedCurrent}`;

            console.log(`${directionEmoji} [PercentageAlerts] ${name} %${absChange} ${actionTr} (${timeframeLabel})`);
            console.log(`   💰 $${formattedOld} → $${formattedCurrent}`);

            // Bildirimleri gönder
            const promises = [];

            if (trTokens.length > 0) {
                console.log(`   🇹🇷 Sending to ${trTokens.length} TR device(s)`);
                promises.push(
                    sendPriceAlertNotification(trTokens, symbol, currentPrice, oldPrice, direction, titleTr, bodyTr)
                );
            }

            if (enTokens.length > 0) {
                console.log(`   🌍 Sending to ${enTokens.length} EN device(s)`);
                promises.push(
                    sendPriceAlertNotification(enTokens, symbol, currentPrice, oldPrice, direction, titleEn, bodyEn)
                );
            }

            await Promise.all(promises);
            console.log(`   ✅ Percentage change notification sent`);
        } catch (error) {
            console.error('[PercentageAlerts] Error sending notification:', error);
        }
    }

    /**
     * Servis durumunu al
     */
    getStatus() {
        const status = {
            isRunning: this.isRunning,
            connections: {},
            history: {},
        };

        Object.keys(this.watchList).forEach(symbol => {
            const price = this.priceCache.get(symbol);
            const history = this.priceHistory.get(symbol);

            status.connections[symbol] = {
                connected: this.wsConnections.has(symbol),
                currentPrice: price || null,
                historyCount: history ? history.prices.length : 0,
            };
        });

        status.customAlertsCount = Array.from(this.customAlertsCache.values()).reduce((sum, arr) => sum + arr.length, 0);

        return status;
    }

    /**
     * Custom percentage alert'leri yükle
     */
    async loadCustomAlerts() {
        try {
            const alerts = await getCustomAlertsByType('percentage_change');

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
                    console.log(`🔔 [PercentageAlerts] Connecting to custom symbol: ${symbol}`);
                    this.connectToSymbol(symbol);

                    // History yapısını başlat
                    if (!this.priceHistory.has(symbol)) {
                        this.priceHistory.set(symbol, {
                            prices: [],
                            maxAge: 1440 * 60 * 1000,
                        });
                    }
                }
            });

            const customCount = alerts.length;
            if (customCount > 0) {
                console.log(`📊 [PercentageAlerts] Loaded ${customCount} custom percentage alert(s)`);
            }
        } catch (error) {
            console.error('[PercentageAlerts] Error loading custom alerts:', error);
        }
    }

    /**
     * Custom percentage alert'leri kontrol et
     */
    async checkCustomPercentageAlerts() {
        const now = Date.now();

        for (const [symbol, alerts] of this.customAlertsCache) {
            const currentPrice = this.priceCache.get(symbol);
            const history = this.priceHistory.get(symbol);

            if (!currentPrice || !history || history.prices.length === 0) continue;

            for (const alert of alerts) {
                const {
                    id,
                    percentage_threshold,
                    timeframe_minutes,
                    direction: alertDirection,
                    last_notified_at,
                    cooldown_minutes,
                    expo_push_token,
                    language
                } = alert;

                // Geçmiş fiyatı hesapla
                const timeframeMs = parseInt(timeframe_minutes) * 60 * 1000;
                const cutoff = now - timeframeMs;

                const oldPrices = history.prices.filter(p => p.timestamp <= cutoff + 60000);
                if (oldPrices.length === 0) continue;

                const oldestPrice = oldPrices.reduce((closest, p) => {
                    const closestDiff = Math.abs(closest.timestamp - cutoff);
                    const pDiff = Math.abs(p.timestamp - cutoff);
                    return pDiff < closestDiff ? p : closest;
                });

                // Yüzde değişimi hesapla
                const percentChange = ((currentPrice - oldestPrice.price) / oldestPrice.price) * 100;
                const absChange = Math.abs(percentChange);
                const direction = percentChange > 0 ? 'up' : 'down';

                // Direction kontrolü
                if (alertDirection !== 'both' && alertDirection !== direction) continue;

                // Threshold kontrolü
                if (absChange < parseFloat(percentage_threshold)) continue;

                // Cooldown kontrolü
                if (last_notified_at) {
                    const cooldownMs = (cooldown_minutes || 30) * 60 * 1000;
                    const timeSince = Date.now() - new Date(last_notified_at).getTime();
                    if (timeSince < cooldownMs) continue;
                }

                // Token kontrolü
                if (!expo_push_token || expo_push_token.length <= 10) continue;

                const lowerToken = expo_push_token.toLowerCase();
                if (lowerToken.includes('test') || lowerToken === 'unknown') continue;

                // Bildirim gönder
                const lang = language ? language.toLowerCase() : 'tr';
                const isTurkish = lang.startsWith('tr');

                const directionEmoji = direction === 'up' ? '📈' : '📉';

                // Dynamic precision for low-value coins (e.g., 0.007889 should show as 0.007889, not 0.01)
                const getPrecision = (price) => {
                    if (price >= 100) return 2;
                    if (price >= 1) return 4;
                    if (price >= 0.01) return 6;
                    return 8; // Very low value coins
                };
                const precision = Math.max(getPrecision(currentPrice), getPrecision(oldestPrice.price));
                const formattedCurrent = currentPrice.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
                const formattedOld = oldestPrice.price.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
                const timeframeLabel = timeframe_minutes == 60 ? '1h' : timeframe_minutes == 240 ? '4h' : '24h';

                let title, body;
                if (isTurkish) {
                    const actionTr = direction === 'up' ? 'yükseldi' : 'düştü';
                    title = `${symbol} %${absChange.toFixed(1)} ${actionTr}! ${directionEmoji}`;
                    body = `Son ${timeframeLabel}'de: $${formattedOld} → $${formattedCurrent}`;
                } else {
                    title = `${symbol} ${absChange.toFixed(1)}% ${direction}! ${directionEmoji}`;
                    body = `Last ${timeframeLabel}: $${formattedOld} → $${formattedCurrent}`;
                }

                try {
                    await sendPushNotifications([{
                        to: [expo_push_token],
                        title: title,
                        body: body,
                        data: {
                            type: 'custom_percentage_change',
                            symbol: symbol,
                            percentChange: percentChange.toString(),
                            timeframe: timeframe_minutes.toString(),
                        },
                        sound: 'default',
                        channelId: 'percentage-alerts',
                        priority: 'high',
                    }]);

                    await updateCustomAlertNotification(id, percentChange);
                    console.log(`✅ [PercentageAlerts] Custom alert triggered: ${symbol} ${absChange.toFixed(1)}% [${isTurkish ? 'TR' : 'EN'}]`);
                } catch (error) {
                    console.error('[PercentageAlerts] Error sending custom alert:', error);
                }
            }
        }
    }
}

// Singleton instance
let percentageAlertService = null;

export function getPercentageAlertService() {
    if (!percentageAlertService) {
        percentageAlertService = new PercentageAlertService();
    }
    return percentageAlertService;
}
