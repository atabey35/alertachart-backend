/**
 * Volume Spike Bildirimleri (PREMIUM ÖZELLİK)
 * Anormal hacim artışlarında bildirim gönderir
 */

import WebSocket from 'ws';
import { getPremiumTrialDevices } from './db.js';
import { sendPriceAlertNotification } from './unified-push.js';

/**
 * Hacim patlaması takip servisi
 * Normal hacmin 2x, 3x üzerinde işlem hacmi tespit edildiğinde bildirim
 */
export class VolumeAlertService {
    constructor() {
        this.wsConnections = new Map();
        this.volumeCache = new Map(); // Güncel 24h hacim
        this.priceCache = new Map(); // Güncel fiyat
        this.volumeHistory = new Map(); // Hacim geçmişi (rolling average için)
        this.lastNotifications = new Map(); // Son bildirim zamanları
        this.isRunning = false;
        this.checkInterval = null;

        // Bildirim cooldown - Aynı symbol+multiplier için 60 dakika bekle
        this.NOTIFICATION_COOLDOWN = 60 * 60 * 1000; // 60 dakika

        // Hacim kontrol aralığı
        this.CHECK_INTERVAL = 60 * 1000; // 1 dakika

        // Rolling average için geçmiş tutma süresi
        this.HISTORY_DURATION = 24 * 60 * 60 * 1000; // 24 saat

        // İzlenecek coin'ler ve yapılandırmaları
        this.watchList = {
            'BTCUSDT': {
                name: 'Bitcoin',
                emoji: '₿',
                spikeMultipliers: [2, 3, 5], // 2x, 3x, 5x normal hacim
                minVolume: 1000000000, // Minimum $1B (yanlış alarmları önle)
            },
            'ETHUSDT': {
                name: 'Ethereum',
                emoji: 'Ξ',
                spikeMultipliers: [2, 3, 5],
                minVolume: 500000000, // Minimum $500M
            },
            'SOLUSDT': {
                name: 'Solana',
                emoji: '◎',
                spikeMultipliers: [2, 3, 5],
                minVolume: 100000000, // Minimum $100M
            },
            'BNBUSDT': {
                name: 'BNB',
                emoji: '🔶',
                spikeMultipliers: [2, 3, 5],
                minVolume: 100000000, // Minimum $100M
            },
        };

        // Her symbol için history yapısını başlat
        Object.keys(this.watchList).forEach(symbol => {
            this.volumeHistory.set(symbol, {
                records: [], // [{volume, timestamp}]
                baselineVolume: null, // Hesaplanan ortalama hacim
            });
        });
    }

    /**
     * Servisi başlat
     */
    start() {
        if (this.isRunning) {
            console.warn('⚠️  Volume alert service already running');
            return;
        }

        this.isRunning = true;
        console.log('🚀 Volume Alert Service started');
        console.log(`📊 Watching ${Object.keys(this.watchList).length} symbols for volume spikes`);

        Object.entries(this.watchList).forEach(([symbol, config]) => {
            console.log(`   ${config.emoji} ${config.name}: ${config.spikeMultipliers.join('x, ')}x spike detection`);
        });

        // Her symbol için WebSocket bağlantısı kur
        Object.keys(this.watchList).forEach(symbol => {
            this.connectToSymbol(symbol);
        });

        // Periyodik hacim kontrolü
        this.checkInterval = setInterval(() => {
            if (this.isRunning) {
                this.recordVolumes();
                this.checkVolumeSpikes();
            }
        }, this.CHECK_INTERVAL);
    }

    /**
     * Servisi durdur
     */
    stop() {
        if (!this.isRunning) return;

        this.isRunning = false;

        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }

        this.wsConnections.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        });
        this.wsConnections.clear();

        console.log('🛑 Volume alert service stopped');
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
                console.log(`✅ [VolumeAlerts] Connected to ${symbol} feed`);
            });

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());

                    // Binance ticker data:
                    // 'c' = current price
                    // 'q' = quote volume (24h volume in USDT)
                    // 'v' = base volume (24h volume in base currency)

                    const price = parseFloat(message.c);
                    const quoteVolume = parseFloat(message.q); // USDT cinsinden hacim

                    if (price) {
                        this.priceCache.set(symbol, price);
                    }

                    if (quoteVolume) {
                        this.volumeCache.set(symbol, quoteVolume);
                    }
                } catch (error) {
                    console.error(`[VolumeAlerts] Error parsing ${symbol}:`, error);
                }
            });

            ws.on('error', (error) => {
                console.error(`[VolumeAlerts] WebSocket error for ${symbol}:`, error.message);
            });

            ws.on('close', () => {
                console.log(`❌ [VolumeAlerts] Disconnected from ${symbol}`);
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
            console.error(`[VolumeAlerts] Failed to connect to ${symbol}:`, error);
        }
    }

    /**
     * Güncel hacimleri history'ye kaydet
     */
    recordVolumes() {
        const now = Date.now();

        this.volumeCache.forEach((volume, symbol) => {
            const history = this.volumeHistory.get(symbol);
            if (!history) return;

            // Yeni hacim kaydı ekle
            history.records.push({ volume, timestamp: now });

            // Eski kayıtları temizle (24 saatten eski)
            const cutoff = now - this.HISTORY_DURATION;
            history.records = history.records.filter(r => r.timestamp > cutoff);

            // Ortalama hacmi güncelle (en az 30 kayıt gerekli - ~30 dakika)
            if (history.records.length >= 30) {
                const avgVolume = history.records.reduce((sum, r) => sum + r.volume, 0) / history.records.length;
                history.baselineVolume = avgVolume;
            }
        });
    }

    /**
     * Hacim spike'larını kontrol et
     */
    async checkVolumeSpikes() {
        for (const [symbol, config] of Object.entries(this.watchList)) {
            const currentVolume = this.volumeCache.get(symbol);
            const currentPrice = this.priceCache.get(symbol);
            const history = this.volumeHistory.get(symbol);

            if (!currentVolume || !currentPrice || !history || !history.baselineVolume) continue;

            // Minimum hacim kontrolü
            if (currentVolume < config.minVolume) continue;

            // Spike oranını hesapla
            const spikeRatio = currentVolume / history.baselineVolume;

            // Multiplier'ları kontrol et (büyükten küçüğe)
            const sortedMultipliers = [...config.spikeMultipliers].sort((a, b) => b - a);

            for (const multiplier of sortedMultipliers) {
                if (spikeRatio >= multiplier) {
                    // Cooldown kontrolü
                    const cooldownKey = `${symbol}_${multiplier}x`;

                    if (this.shouldNotify(cooldownKey)) {
                        // Bildirim gönder
                        await this.sendNotificationToAll(
                            symbol,
                            config.name,
                            config.emoji,
                            currentPrice,
                            currentVolume,
                            history.baselineVolume,
                            spikeRatio,
                            multiplier
                        );

                        this.markNotified(cooldownKey);

                        // En büyük multiplier'ı bulduk, diğerlerini kontrol etme
                        break;
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
     * Hacmi okunabilir formata çevir
     */
    formatVolume(volume) {
        if (volume >= 1e12) {
            return `$${(volume / 1e12).toFixed(1)}T`;
        } else if (volume >= 1e9) {
            return `$${(volume / 1e9).toFixed(1)}B`;
        } else if (volume >= 1e6) {
            return `$${(volume / 1e6).toFixed(0)}M`;
        } else {
            return `$${volume.toLocaleString('en-US')}`;
        }
    }

    /**
     * Premium/Trial kullanıcılara bildirim gönder
     */
    async sendNotificationToAll(symbol, name, emoji, currentPrice, currentVolume, baselineVolume, spikeRatio, multiplier) {
        try {
            const devices = await getPremiumTrialDevices();

            if (devices.length === 0) {
                console.log('[VolumeAlerts] No premium/trial devices found');
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
                console.log('[VolumeAlerts] No valid tokens');
                return;
            }

            // Mesajları hazırla
            const formattedCurrent = this.formatVolume(currentVolume);
            const formattedBaseline = this.formatVolume(baselineVolume);
            const formattedPrice = currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const spikePercent = ((spikeRatio - 1) * 100).toFixed(0);

            // TR Mesajı
            const titleTr = `🔥 ${emoji} ${name} Hacim Patlaması!`;
            const bodyTr = `${multiplier}x normal hacim! (${formattedBaseline} → ${formattedCurrent}) | Fiyat: $${formattedPrice}`;

            // EN Mesajı
            const titleEn = `🔥 ${emoji} ${name} Volume Spike!`;
            const bodyEn = `${multiplier}x normal volume! (${formattedBaseline} → ${formattedCurrent}) | Price: $${formattedPrice}`;

            console.log(`🔥 [VolumeAlerts] ${name} ${multiplier}x volume spike detected!`);
            console.log(`   📊 Volume: ${formattedBaseline} → ${formattedCurrent} (+${spikePercent}%)`);
            console.log(`   💰 Price: $${formattedPrice}`);

            // Bildirimleri gönder
            const promises = [];

            if (trTokens.length > 0) {
                console.log(`   🇹🇷 Sending to ${trTokens.length} TR device(s)`);
                promises.push(
                    sendPriceAlertNotification(trTokens, symbol, currentPrice, baselineVolume, 'up', titleTr, bodyTr)
                );
            }

            if (enTokens.length > 0) {
                console.log(`   🌍 Sending to ${enTokens.length} EN device(s)`);
                promises.push(
                    sendPriceAlertNotification(enTokens, symbol, currentPrice, baselineVolume, 'up', titleEn, bodyEn)
                );
            }

            await Promise.all(promises);
            console.log(`   ✅ Volume spike notification sent`);
        } catch (error) {
            console.error('[VolumeAlerts] Error sending notification:', error);
        }
    }

    /**
     * Servis durumunu al
     */
    getStatus() {
        const status = {
            isRunning: this.isRunning,
            symbols: {},
        };

        Object.keys(this.watchList).forEach(symbol => {
            const volume = this.volumeCache.get(symbol);
            const price = this.priceCache.get(symbol);
            const history = this.volumeHistory.get(symbol);

            status.symbols[symbol] = {
                connected: this.wsConnections.has(symbol),
                currentPrice: price || null,
                currentVolume: volume ? this.formatVolume(volume) : null,
                baselineVolume: history?.baselineVolume ? this.formatVolume(history.baselineVolume) : null,
                spikeRatio: (volume && history?.baselineVolume)
                    ? (volume / history.baselineVolume).toFixed(2) + 'x'
                    : null,
                historyCount: history ? history.records.length : 0,
            };
        });

        return status;
    }
}

// Singleton instance
let volumeAlertService = null;

export function getVolumeAlertService() {
    if (!volumeAlertService) {
        volumeAlertService = new VolumeAlertService();
    }
    return volumeAlertService;
}
