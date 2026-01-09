/**
 * Market Cap Index Service
 * 
 * Binance fiyat verilerini ve sabit circulating supply kullanarak
 * TOTAL, TOTAL2, OTHERS market cap indexlerini hesaplar.
 * 
 * - TOTAL: Tüm coinlerin toplam market cap
 * - TOTAL2: BTC hariç toplam market cap  
 * - OTHERS: Top 10 hariç coinlerin market cap
 */

import { CIRCULATING_SUPPLY, STABLECOINS, TOP_10_SYMBOLS, INDEX_MULTIPLIERS } from '../data/circulating-supply.js';

class MarketCapService {
    constructor(binanceRelayService, io) {
        this.binanceRelay = binanceRelayService;
        this.io = io;

        // Hesaplanan index değerleri
        this.indices = {
            TOTAL: { value: 0, change24h: 0, previousValue: 0 },
            TOTAL2: { value: 0, change24h: 0, previousValue: 0 },
            OTHERS: { value: 0, change24h: 0, previousValue: 0 },
        };

        // Market cap verileri (coin bazında)
        this.marketCaps = new Map();

        // Son hesaplama zamanı
        this.lastUpdate = null;

        // Güncelleme interval (ms)
        this.updateInterval = 5000; // 5 saniye

        this.intervalId = null;
    }

    /**
     * Servisi başlat
     */
    start() {
        console.log('📊 [MarketCap] Starting Market Cap Index Service...');

        // İlk hesaplama
        setTimeout(() => {
            this.calculateIndices();
        }, 3000); // Binance relay'in veri toplaması için bekle

        // Periyodik güncelleme
        this.intervalId = setInterval(() => {
            this.calculateIndices();
        }, this.updateInterval);

        console.log('📊 [MarketCap] Service started. Updating every', this.updateInterval / 1000, 'seconds');
    }

    /**
     * Servisi durdur
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        console.log('📊 [MarketCap] Service stopped');
    }

    /**
     * Tüm indexleri hesapla
     */
    calculateIndices() {
        const spotCache = this.binanceRelay.getSpotCache();

        // spotCache is an Object (not Map), check if it has data
        if (!spotCache || Object.keys(spotCache).length === 0) {
            console.log('📊 [MarketCap] No spot data available yet');
            return;
        }

        let total = 0;
        let total2 = 0; // BTC hariç
        let others = 0; // Top 10 hariç

        let coinsProcessed = 0;
        let coinsWithSupply = 0;

        // Her coin için market cap hesapla (Object.entries kullan, Map değil)
        for (const [symbol, ticker] of Object.entries(spotCache)) {
            // USDT pair'leri filtrele (symbol lowercase: btcusdt)
            if (!symbol.endsWith('usdt')) continue;

            // Base symbol'u al (btcusdt -> BTC)
            const baseSymbol = symbol.replace('usdt', '').toUpperCase();

            // Stablecoin'leri atla
            if (STABLECOINS.includes(baseSymbol)) continue;

            // Circulating supply'ı kontrol et
            const supply = CIRCULATING_SUPPLY[baseSymbol];
            if (!supply) continue;

            // Fiyatı al (BinanceRelay zaten parse ediyor: ticker.price)
            const price = ticker.price || 0;
            if (price <= 0) continue;

            // Market cap hesapla
            const marketCap = price * supply;

            // Sakla
            this.marketCaps.set(baseSymbol, {
                symbol: baseSymbol,
                price,
                supply,
                marketCap,
                change24h: ticker.change24h || 0,
            });

            // Toplama ekle
            total += marketCap;

            // BTC hariç toplam
            if (baseSymbol !== 'BTC') {
                total2 += marketCap;
            }

            // Top 10 hariç toplam (Disabled)
            /*
            if (!TOP_10_SYMBOLS.includes(baseSymbol)) {
                others += marketCap;
            }
            */

            coinsWithSupply++;
            coinsProcessed++;
        }

        // 24h değişim hesapla (basit weighted average)
        let totalChange = 0;
        let total2Change = 0;
        let othersChange = 0;

        for (const [symbol, data] of this.marketCaps.entries()) {
            const weight = data.marketCap / total;
            totalChange += data.change24h * weight;

            if (symbol !== 'BTC') {
                const weight2 = data.marketCap / total2;
                total2Change += data.change24h * weight2;
            }

            /*
            if (!TOP_10_SYMBOLS.includes(symbol)) {
                const weightOthers = data.marketCap / (others || 1);
                othersChange += data.change24h * weightOthers;
            }
            */
        }

        // Indexleri güncelle
        // Indexleri güncelle
        // Indexleri güncelle (Multiplier Calibration Applied)
        const totalCalibrated = total * INDEX_MULTIPLIERS.TOTAL;
        const total2Calibrated = total2 * INDEX_MULTIPLIERS.TOTAL2;
        // OTHERS disabled
        // const othersCalibrated = others * INDEX_MULTIPLIERS.OTHERS;

        this.indices.TOTAL = {
            value: totalCalibrated,
            change24h: totalChange,
            formattedValue: this.formatMarketCap(totalCalibrated),
        };

        this.indices.TOTAL2 = {
            value: total2Calibrated,
            change24h: total2Change,
            formattedValue: this.formatMarketCap(total2Calibrated),
        };

        // OTHERS disabled until further notice
        /*
        this.indices.OTHERS = {
            value: othersCalibrated,
            change24h: othersChange,
            formattedValue: this.formatMarketCap(othersCalibrated),
        };
        */

        this.lastUpdate = new Date();

        // Debug log (ilk hesaplama veya her 60 saniyede bir)
        if (!this._lastLog || Date.now() - this._lastLog > 60000) {
            console.log(`📊 [MarketCap] Updated indices (${coinsWithSupply} coins):`);
            console.log(`   TOTAL:  ${this.indices.TOTAL.formattedValue} (${totalChange.toFixed(2)}%)`);
            console.log(`   TOTAL2: ${this.indices.TOTAL2.formattedValue} (${total2Change.toFixed(2)}%)`);
            console.log(`   OTHERS: ${this.indices.OTHERS.formattedValue} (${othersChange.toFixed(2)}%)`);
            this._lastLog = Date.now();
        }

        // WebSocket üzerinden broadcast
        this.broadcastIndices();
    }

    /**
     * Market cap formatla (T/B/M)
     */
    formatMarketCap(value) {
        if (value >= 1_000_000_000_000) {
            return (value / 1_000_000_000_000).toFixed(2) + 'T';
        }
        if (value >= 1_000_000_000) {
            return (value / 1_000_000_000).toFixed(2) + 'B';
        }
        if (value >= 1_000_000) {
            return (value / 1_000_000).toFixed(2) + 'M';
        }
        return value.toFixed(2);
    }

    /**
     * Socket.io üzerinden broadcast
     */
    broadcastIndices() {
        if (!this.io) return;

        this.io.emit('marketcap:indices', {
            indices: this.indices,
            timestamp: this.lastUpdate?.toISOString(),
        });
    }

    /**
     * Güncel index değerlerini al (REST API için)
     */
    getIndices() {
        return {
            indices: this.indices,
            coinsTracked: this.marketCaps.size,
            lastUpdate: this.lastUpdate?.toISOString(),
        };
    }

    /**
     * Belirli bir coin'in market cap bilgisini al
     */
    getCoinMarketCap(symbol) {
        return this.marketCaps.get(symbol.toUpperCase()) || null;
    }

    /**
     * Tüm coin market cap'lerini sıralı olarak al
     */
    getAllMarketCaps(limit = 100) {
        const sorted = Array.from(this.marketCaps.values())
            .sort((a, b) => b.marketCap - a.marketCap)
            .slice(0, limit);

        return sorted;
    }

    /**
     * Top N coin listesini al
     */
    getTopCoins(n = 10) {
        return this.getAllMarketCaps(n);
    }
}

export default MarketCapService;
