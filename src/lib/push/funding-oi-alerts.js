/**
 * Funding Rate & Open Interest Bildirimleri (PREMIUM ÖZELLİK)
 * Binance Futures API kullanarak funding rate ve OI değişimlerini takip eder
 */

import { getPremiumTrialDevices } from './db.js';
import { sendPushNotifications } from './unified-push.js';

/**
 * Funding Rate & Open Interest Alert Service
 */
export class FundingOIAlertService {
    constructor() {
        this.isRunning = false;
        this.checkInterval = null;

        // Cache'ler
        this.fundingRateCache = new Map(); // symbol -> { rate, timestamp }
        this.openInterestCache = new Map(); // symbol -> { oi, timestamp }
        this.openInterestHistory = new Map(); // symbol -> [{ oi, timestamp }]

        // Günlük threshold tracking (spam önleme)
        this.dailyFundingAlerts = new Map(); // symbol -> { alertedHigh, alertedLow, date }
        this.dailyOIAlerts = new Map(); // symbol -> { lastAlertedOI, date }

        // Ayarlar
        this.FUNDING_CHECK_INTERVAL = 5 * 60 * 1000; // 5 dakika
        this.OI_HISTORY_DURATION = 60 * 60 * 1000; // 1 saat

        // Thresholds
        this.FUNDING_THRESHOLD = 0.05; // ±0.05% (aşırı funding rate)
        this.OI_CHANGE_THRESHOLD = 10; // %10 değişim

        // İzlenecek coin'ler
        this.watchList = {
            'BTCUSDT': { name: 'Bitcoin', emoji: '₿' },
            'ETHUSDT': { name: 'Ethereum', emoji: 'Ξ' },
        };
    }

    /**
     * Servisi başlat
     */
    start() {
        if (this.isRunning) {
            console.warn('⚠️  Funding/OI alert service already running');
            return;
        }

        this.isRunning = true;
        console.log('🚀 Funding Rate & Open Interest Alert Service started');
        console.log(`📊 Watching: ${Object.keys(this.watchList).join(', ')}`);

        // İlk veriyi çek
        this.fetchAllData();

        // Periyodik kontrol
        this.checkInterval = setInterval(() => {
            if (this.isRunning) {
                this.fetchAllData();
            }
        }, this.FUNDING_CHECK_INTERVAL);
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

        console.log('🛑 Funding/OI alert service stopped');
    }

    /**
     * Tüm verileri çek ve kontrol et
     */
    async fetchAllData() {
        for (const symbol of Object.keys(this.watchList)) {
            try {
                await Promise.all([
                    this.fetchFundingRate(symbol),
                    this.fetchOpenInterest(symbol),
                ]);
            } catch (error) {
                console.error(`[FundingOI] Error fetching data for ${symbol}:`, error.message);
            }
        }

        // Kontrolleri yap
        await this.checkFundingRates();
        await this.checkOpenInterest();
    }

    /**
     * Funding Rate'i çek
     */
    async fetchFundingRate(symbol) {
        try {
            const response = await fetch(
                `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (data && data.length > 0) {
                const rate = parseFloat(data[0].fundingRate) * 100; // Yüzdeye çevir
                this.fundingRateCache.set(symbol, {
                    rate,
                    timestamp: Date.now(),
                    fundingTime: data[0].fundingTime,
                });
            }
        } catch (error) {
            console.error(`[FundingOI] Error fetching funding rate for ${symbol}:`, error.message);
        }
    }

    /**
     * Open Interest'i çek
     */
    async fetchOpenInterest(symbol) {
        try {
            const response = await fetch(
                `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (data && data.openInterest) {
                const oi = parseFloat(data.openInterest);
                const now = Date.now();

                // Cache'e kaydet
                this.openInterestCache.set(symbol, { oi, timestamp: now });

                // History'ye ekle
                if (!this.openInterestHistory.has(symbol)) {
                    this.openInterestHistory.set(symbol, []);
                }

                const history = this.openInterestHistory.get(symbol);
                history.push({ oi, timestamp: now });

                // Eski kayıtları temizle (1 saatten eski)
                const cutoff = now - this.OI_HISTORY_DURATION;
                this.openInterestHistory.set(
                    symbol,
                    history.filter(r => r.timestamp > cutoff)
                );
            }
        } catch (error) {
            console.error(`[FundingOI] Error fetching OI for ${symbol}:`, error.message);
        }
    }

    /**
     * Funding Rate kontrolü
     */
    async checkFundingRates() {
        const today = new Date().toISOString().split('T')[0];

        for (const [symbol, config] of Object.entries(this.watchList)) {
            const fundingData = this.fundingRateCache.get(symbol);
            if (!fundingData) continue;

            const { rate } = fundingData;
            const absRate = Math.abs(rate);

            // Threshold kontrolü
            if (absRate < this.FUNDING_THRESHOLD) continue;

            // Günlük alert kontrolü
            let dailyData = this.dailyFundingAlerts.get(symbol);
            if (!dailyData || dailyData.date !== today) {
                dailyData = { alertedHigh: false, alertedLow: false, date: today };
                this.dailyFundingAlerts.set(symbol, dailyData);
            }

            const isHigh = rate > 0;
            const alreadyAlerted = isHigh ? dailyData.alertedHigh : dailyData.alertedLow;

            if (alreadyAlerted) continue;

            // Bildirim gönder
            await this.sendFundingNotification(symbol, config, rate);

            // İşaretle
            if (isHigh) {
                dailyData.alertedHigh = true;
            } else {
                dailyData.alertedLow = true;
            }
            this.dailyFundingAlerts.set(symbol, dailyData);
        }
    }

    /**
     * Open Interest kontrolü
     */
    async checkOpenInterest() {
        const today = new Date().toISOString().split('T')[0];

        for (const [symbol, config] of Object.entries(this.watchList)) {
            const history = this.openInterestHistory.get(symbol);
            if (!history || history.length < 2) continue;

            const current = history[history.length - 1];
            const oldest = history[0];

            // En az 30 dakikalık veri olsun
            if (current.timestamp - oldest.timestamp < 30 * 60 * 1000) continue;

            // Değişim yüzdesi
            const changePercent = ((current.oi - oldest.oi) / oldest.oi) * 100;
            const absChange = Math.abs(changePercent);

            if (absChange < this.OI_CHANGE_THRESHOLD) continue;

            // Günlük alert kontrolü
            let dailyData = this.dailyOIAlerts.get(symbol);
            if (!dailyData || dailyData.date !== today) {
                dailyData = { lastAlertLevel: 0, date: today };
                this.dailyOIAlerts.set(symbol, dailyData);
            }

            // Progressive threshold: 10%, 20%, 30%...
            const alertLevel = Math.floor(absChange / 10) * 10;
            if (alertLevel <= dailyData.lastAlertLevel) continue;

            // Bildirim gönder
            await this.sendOINotification(symbol, config, oldest.oi, current.oi, changePercent);

            // İşaretle
            dailyData.lastAlertLevel = alertLevel;
            this.dailyOIAlerts.set(symbol, dailyData);
        }
    }

    /**
     * Funding Rate bildirimi gönder
     */
    async sendFundingNotification(symbol, config, rate) {
        try {
            const devices = await getPremiumTrialDevices();
            if (devices.length === 0) return;

            const isHigh = rate > 0;
            const direction = isHigh ? 'Long' : 'Short';
            const formattedRate = rate.toFixed(4);

            // Tokenları dile göre ayır
            const trTokens = [];
            const enTokens = [];

            for (const device of devices) {
                const token = device.expo_push_token;
                if (!token || token.length <= 10) continue;
                if (token.toLowerCase().includes('test')) continue;

                const lang = (device.language || 'tr').toLowerCase();
                if (lang.startsWith('tr')) {
                    trTokens.push(token);
                } else {
                    enTokens.push(token);
                }
            }

            // TR bildirimi
            const titleTr = `📊 ${config.emoji} ${config.name} Funding Rate`;
            const bodyTr = `${formattedRate}% - ${direction} pozisyonlar 8 saatte %${Math.abs(rate).toFixed(2)} ödüyor.`;

            // EN bildirimi
            const titleEn = `📊 ${config.emoji} ${config.name} Funding Rate`;
            const bodyEn = `${formattedRate}% - ${direction} positions pay ${Math.abs(rate).toFixed(2)}% every 8h.`;

            console.log(`📊 [FundingOI] ${config.name} Funding Alert: ${formattedRate}%`);

            const promises = [];

            if (trTokens.length > 0) {
                promises.push(sendPushNotifications([{
                    to: trTokens,
                    title: titleTr,
                    body: bodyTr,
                    data: { type: 'funding_rate', symbol },
                    sound: 'default',
                    channelId: 'market-alerts',
                    priority: 'high',
                }]));
            }

            if (enTokens.length > 0) {
                promises.push(sendPushNotifications([{
                    to: enTokens,
                    title: titleEn,
                    body: bodyEn,
                    data: { type: 'funding_rate', symbol },
                    sound: 'default',
                    channelId: 'market-alerts',
                    priority: 'high',
                }]));
            }

            await Promise.all(promises);
            console.log(`   ✅ Funding notification sent to ${trTokens.length + enTokens.length} devices`);
        } catch (error) {
            console.error('[FundingOI] Error sending funding notification:', error);
        }
    }

    /**
     * Open Interest bildirimi gönder
     */
    async sendOINotification(symbol, config, oldOI, newOI, changePercent) {
        try {
            const devices = await getPremiumTrialDevices();
            if (devices.length === 0) return;

            const direction = changePercent > 0 ? '+' : '';
            const arrow = changePercent > 0 ? '📈' : '📉';
            const oldFormatted = this.formatOI(oldOI, symbol);
            const newFormatted = this.formatOI(newOI, symbol);

            // Tokenları dile göre ayır
            const trTokens = [];
            const enTokens = [];

            for (const device of devices) {
                const token = device.expo_push_token;
                if (!token || token.length <= 10) continue;
                if (token.toLowerCase().includes('test')) continue;

                const lang = (device.language || 'tr').toLowerCase();
                if (lang.startsWith('tr')) {
                    trTokens.push(token);
                } else {
                    enTokens.push(token);
                }
            }

            // TR bildirimi
            const titleTr = `${arrow} ${config.emoji} ${config.name} Open Interest`;
            const bodyTr = `${direction}${changePercent.toFixed(1)}% (1s) - Açık pozisyonlar: ${oldFormatted} → ${newFormatted}`;

            // EN bildirimi
            const titleEn = `${arrow} ${config.emoji} ${config.name} Open Interest`;
            const bodyEn = `${direction}${changePercent.toFixed(1)}% (1h) - Open positions: ${oldFormatted} → ${newFormatted}`;

            console.log(`${arrow} [FundingOI] ${config.name} OI Alert: ${direction}${changePercent.toFixed(1)}%`);

            const promises = [];

            if (trTokens.length > 0) {
                promises.push(sendPushNotifications([{
                    to: trTokens,
                    title: titleTr,
                    body: bodyTr,
                    data: { type: 'open_interest', symbol },
                    sound: 'default',
                    channelId: 'market-alerts',
                    priority: 'high',
                }]));
            }

            if (enTokens.length > 0) {
                promises.push(sendPushNotifications([{
                    to: enTokens,
                    title: titleEn,
                    body: bodyEn,
                    data: { type: 'open_interest', symbol },
                    sound: 'default',
                    channelId: 'market-alerts',
                    priority: 'high',
                }]));
            }

            await Promise.all(promises);
            console.log(`   ✅ OI notification sent to ${trTokens.length + enTokens.length} devices`);
        } catch (error) {
            console.error('[FundingOI] Error sending OI notification:', error);
        }
    }

    /**
     * OI'yi okunabilir formata çevir
     */
    formatOI(oi, symbol) {
        // BTC/ETH miktarını USD'ye çevirme (yaklaşık)
        // Gerçek implementasyonda fiyat cache'den alınabilir
        if (oi >= 1000000) {
            return `${(oi / 1000000).toFixed(1)}M`;
        } else if (oi >= 1000) {
            return `${(oi / 1000).toFixed(1)}K`;
        }
        return oi.toFixed(2);
    }

    /**
     * Servis durumunu al
     */
    getStatus() {
        const status = {
            isRunning: this.isRunning,
            symbols: {},
        };

        for (const symbol of Object.keys(this.watchList)) {
            const funding = this.fundingRateCache.get(symbol);
            const oi = this.openInterestCache.get(symbol);
            const oiHistory = this.openInterestHistory.get(symbol);

            status.symbols[symbol] = {
                fundingRate: funding ? `${funding.rate.toFixed(4)}%` : null,
                openInterest: oi ? this.formatOI(oi.oi, symbol) : null,
                oiHistoryCount: oiHistory ? oiHistory.length : 0,
            };
        }

        return status;
    }
}

// Singleton instance
let fundingOIService = null;

export function getFundingOIAlertService() {
    if (!fundingOIService) {
        fundingOIService = new FundingOIAlertService();
    }
    return fundingOIService;
}
