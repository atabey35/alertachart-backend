/**
 * Scheduled Summary Bildirimleri (PREMIUM ÖZELLİK)
 * Her gün sabah 09:00 ve akşam 21:00'de piyasa özeti gönderir
 */

import cron from 'node-cron';
import { getPremiumTrialDevices } from './db.js';
import { sendPushNotifications } from './unified-push.js';

/**
 * Zamanlanmış piyasa özeti servisi
 * Sabah günaydın, akşam iyi akşamlar mesajları ile piyasa durumu
 */
export class ScheduledSummaryService {
    constructor() {
        this.isRunning = false;
        this.morningJob = null;
        this.eveningJob = null;
        this.priceCache = new Map(); // Son fiyatlar
        this.change24hCache = new Map(); // 24 saatlik değişimler

        // İzlenecek coin'ler
        this.watchList = {
            'BTCUSDT': { name: 'BTC', emoji: '₿', fullName: 'Bitcoin' },
            'ETHUSDT': { name: 'ETH', emoji: 'Ξ', fullName: 'Ethereum' },
            'SOLUSDT': { name: 'SOL', emoji: '◎', fullName: 'Solana' },
            'BNBUSDT': { name: 'BNB', emoji: '🔶', fullName: 'BNB' },
        };

        // Cron schedule (Türkiye saati - UTC+3)
        // Server UTC kullanıyorsa, 09:00 TR = 06:00 UTC, 21:00 TR = 18:00 UTC
        // Railway genelde UTC kullanır
        this.schedules = {
            morning: '0 6 * * *', // 06:00 UTC = 09:00 TR
            evening: '0 18 * * *', // 18:00 UTC = 21:00 TR
        };
    }

    /**
     * Servisi başlat
     */
    start() {
        if (this.isRunning) {
            console.warn('⚠️  Scheduled summary service already running');
            return;
        }

        this.isRunning = true;
        console.log('🚀 Scheduled Summary Service started');
        console.log('📅 Morning summary: 09:00 TR (06:00 UTC)');
        console.log('📅 Evening summary: 21:00 TR (18:00 UTC)');

        // Sabah özeti (09:00 TR)
        this.morningJob = cron.schedule(this.schedules.morning, async () => {
            console.log('🌅 [ScheduledSummary] Running morning summary job...');
            await this.sendSummary('morning');
        }, {
            timezone: 'UTC'
        });

        // Akşam özeti (21:00 TR)
        this.eveningJob = cron.schedule(this.schedules.evening, async () => {
            console.log('🌙 [ScheduledSummary] Running evening summary job...');
            await this.sendSummary('evening');
        }, {
            timezone: 'UTC'
        });

        console.log('✅ Cron jobs scheduled');
    }

    /**
     * Servisi durdur
     */
    stop() {
        if (!this.isRunning) return;

        this.isRunning = false;

        if (this.morningJob) {
            this.morningJob.stop();
            this.morningJob = null;
        }

        if (this.eveningJob) {
            this.eveningJob.stop();
            this.eveningJob = null;
        }

        console.log('🛑 Scheduled summary service stopped');
    }

    /**
     * Binance API'den fiyat ve 24h değişim verilerini al
     */
    async fetchMarketData() {
        try {
            const symbols = Object.keys(this.watchList);
            const results = {};

            for (const symbol of symbols) {
                try {
                    const response = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
                    const data = await response.json();

                    results[symbol] = {
                        price: parseFloat(data.lastPrice),
                        change24h: parseFloat(data.priceChangePercent),
                        volume: parseFloat(data.quoteVolume),
                    };
                } catch (error) {
                    console.error(`[ScheduledSummary] Error fetching ${symbol}:`, error);
                }
            }

            return results;
        } catch (error) {
            console.error('[ScheduledSummary] Error fetching market data:', error);
            return null;
        }
    }

    /**
     * En çok değişen coin'i bul
     */
    findTopMover(marketData) {
        let topSymbol = null;
        let topChange = -Infinity;
        let isPositive = true;

        for (const [symbol, data] of Object.entries(marketData)) {
            const absChange = Math.abs(data.change24h);
            if (absChange > Math.abs(topChange)) {
                topChange = data.change24h;
                topSymbol = symbol;
                isPositive = data.change24h >= 0;
            }
        }

        if (!topSymbol) return null;

        const config = this.watchList[topSymbol];
        return {
            symbol: topSymbol,
            name: config.name,
            emoji: config.emoji,
            change: topChange,
            isPositive,
        };
    }

    /**
     * Özet bildirimi gönder
     */
    async sendSummary(timeOfDay) {
        try {
            // Market verilerini al
            const marketData = await this.fetchMarketData();
            if (!marketData || Object.keys(marketData).length === 0) {
                console.error('[ScheduledSummary] No market data available');
                return;
            }

            // Premium cihazları al
            const devices = await getPremiumTrialDevices();
            if (devices.length === 0) {
                console.log('[ScheduledSummary] No premium/trial devices found');
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
                console.log('[ScheduledSummary] No valid tokens');
                return;
            }

            // En çok değişen coin'i bul
            const topMover = this.findTopMover(marketData);

            // Mesajları oluştur
            const btcData = marketData['BTCUSDT'];
            const ethData = marketData['ETHUSDT'];

            // Fiyatları formatla
            const formatPrice = (price) => {
                if (price >= 1000) {
                    return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 0 });
                }
                return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            };

            const formatChange = (change) => {
                const sign = change >= 0 ? '+' : '';
                return `${sign}${change.toFixed(1)}%`;
            };

            // TR Mesajı
            const greetingTr = timeOfDay === 'morning' ? '🌅 Günaydın!' : '🌙 İyi Akşamlar!';
            const topMoverTextTr = topMover
                ? `Günün En Çok ${topMover.isPositive ? 'Yükseleni' : 'Düşeni'}: ${topMover.name} (${formatChange(topMover.change)})`
                : '';

            const titleTr = `${greetingTr} Piyasa Özeti`;
            const bodyTr = `• BTC: ${formatPrice(btcData.price)} (${formatChange(btcData.change24h)})\n• ETH: ${formatPrice(ethData.price)} (${formatChange(ethData.change24h)})\n• ${topMoverTextTr}`;

            // EN Mesajı
            const greetingEn = timeOfDay === 'morning' ? '🌅 Good Morning!' : '🌙 Good Evening!';
            const topMoverTextEn = topMover
                ? `Top ${topMover.isPositive ? 'Gainer' : 'Loser'}: ${topMover.name} (${formatChange(topMover.change)})`
                : '';

            const titleEn = `${greetingEn} Market Summary`;
            const bodyEn = `• BTC: ${formatPrice(btcData.price)} (${formatChange(btcData.change24h)})\n• ETH: ${formatPrice(ethData.price)} (${formatChange(ethData.change24h)})\n• ${topMoverTextEn}`;

            console.log(`📊 [ScheduledSummary] Sending ${timeOfDay} summary...`);
            console.log(`   BTC: ${formatPrice(btcData.price)} (${formatChange(btcData.change24h)})`);
            console.log(`   ETH: ${formatPrice(ethData.price)} (${formatChange(ethData.change24h)})`);
            if (topMover) {
                console.log(`   Top Mover: ${topMover.name} (${formatChange(topMover.change)})`);
            }

            // Bildirimleri gönder
            const promises = [];

            if (trTokens.length > 0) {
                console.log(`   🇹🇷 Sending to ${trTokens.length} TR device(s)`);
                promises.push(
                    sendPushNotifications([{
                        to: trTokens,
                        title: titleTr,
                        body: bodyTr,
                        data: {
                            type: 'market_summary',
                            timeOfDay: timeOfDay,
                            btcPrice: btcData.price.toString(),
                            btcChange: btcData.change24h.toString(),
                            ethPrice: ethData.price.toString(),
                            ethChange: ethData.change24h.toString(),
                        },
                        sound: 'default',
                        channelId: 'market-summary',
                        priority: 'normal', // Normal priority for scheduled notifications
                    }])
                );
            }

            if (enTokens.length > 0) {
                console.log(`   🌍 Sending to ${enTokens.length} EN device(s)`);
                promises.push(
                    sendPushNotifications([{
                        to: enTokens,
                        title: titleEn,
                        body: bodyEn,
                        data: {
                            type: 'market_summary',
                            timeOfDay: timeOfDay,
                            btcPrice: btcData.price.toString(),
                            btcChange: btcData.change24h.toString(),
                            ethPrice: ethData.price.toString(),
                            ethChange: ethData.change24h.toString(),
                        },
                        sound: 'default',
                        channelId: 'market-summary',
                        priority: 'normal',
                    }])
                );
            }

            await Promise.all(promises);
            console.log(`   ✅ ${timeOfDay} summary sent successfully`);
        } catch (error) {
            console.error('[ScheduledSummary] Error sending summary:', error);
        }
    }

    /**
     * Manuel özet gönder (test için)
     */
    async sendManualSummary(timeOfDay = 'morning') {
        console.log(`📊 [ScheduledSummary] Sending manual ${timeOfDay} summary...`);
        await this.sendSummary(timeOfDay);
    }

    /**
     * Servis durumunu al
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            schedules: {
                morning: {
                    cron: this.schedules.morning,
                    description: '09:00 TR (06:00 UTC)',
                    active: this.morningJob !== null,
                },
                evening: {
                    cron: this.schedules.evening,
                    description: '21:00 TR (18:00 UTC)',
                    active: this.eveningJob !== null,
                },
            },
            watchedSymbols: Object.keys(this.watchList),
        };
    }
}

// Singleton instance
let scheduledSummaryService = null;

export function getScheduledSummaryService() {
    if (!scheduledSummaryService) {
        scheduledSummaryService = new ScheduledSummaryService();
    }
    return scheduledSummaryService;
}
