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

import { CIRCULATING_SUPPLY, STABLECOINS, TOP_10_SYMBOLS, INDEX_MULTIPLIERS, DOMINANCE_MULTIPLIERS } from '../data/circulating-supply.js';
import { getHistoricalMarketCapService } from './historical-marketcap-service.js';

class MarketCapService {
    constructor(binanceRelayService, io) {
        this.binanceRelay = binanceRelayService;
        this.io = io;

        // Hesaplanan index değerleri
        this.indices = {
            TOTAL: { value: 0, change24h: 0, previousValue: 0 },
            TOTAL2: { value: 0, change24h: 0, previousValue: 0 },
            OTHERS: { value: 0, change24h: 0, previousValue: 0 },
            'BTC.D': { value: 0, change24h: 0, previousValue: 0 },
            'ETH.D': { value: 0, change24h: 0, previousValue: 0 },
            'USDT.D': { value: 0, change24h: 0, previousValue: 0 },
        };

        // Market cap verileri (coin bazında)
        this.marketCaps = new Map();

        // 24 saat önceki referans değerler (Gerçek 24h değişimi için)
        this.referenceValues = {
            TOTAL: null,
            TOTAL2: null,
            'BTC.D': null,
            'ETH.D': null,
            'USDT.D': null
        };

        // Son hesaplama zamanı
        this.lastUpdate = null;

        // Güncelleme interval (ms)
        this.updateInterval = 5000; // 5 saniye
        this.updateReferenceInterval = 5 * 60 * 1000; // 5 dakika

        this.intervalId = null;
        this.referenceIntervalId = null;
    }

    /**
     * Servisi başlat
     */
    start() {
        console.log('📊 [MarketCap] Starting Market Cap Index Service...');

        // Referans değerlerini güncelle (24 saat önceki snapshot)
        this.updateReferenceValues();

        // İlk hesaplama
        setTimeout(() => {
            this.calculateIndices();
        }, 3000); // Binance relay'in veri toplaması için bekle

        // Periyodik market cap güncelleme
        this.intervalId = setInterval(() => {
            this.calculateIndices();
        }, this.updateInterval);

        // Periyodik referans değer güncelleme (her 5 dakikada bir 24 saat öncesini kaydır)
        this.referenceIntervalId = setInterval(() => {
            this.updateReferenceValues();
        }, this.updateReferenceInterval);

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
        if (this.referenceIntervalId) {
            clearInterval(this.referenceIntervalId);
            this.referenceIntervalId = null;
        }
        console.log('📊 [MarketCap] Service stopped');
    }

    /**
     * 24 saat önceki referans değerlerini getir
     * Bu sayede anlık değişim yerine gerçek 24h değişimi hesaplayabiliriz
     */
    async updateReferenceValues() {
        try {
            const historicalService = getHistoricalMarketCapService();
            // 24 saat önce (tam 1440 dakika)
            const timestamp24hAgo = Date.now() - (24 * 60 * 60 * 1000);

            // O ana en yakın 5 dakikalık mumu al
            // limit=1, endTime=timestamp24hAgo
            // calculateHistoricalIndices normalde dize döner, ama tek bir değer istiyoruz

            // endTime parametresi ile o andan ÖNCEKİ en son mumu alırız
            // Bu tam olarak 24 saat önceki kapanışa denk gelir
            const data = await historicalService.calculateHistoricalIndices('5m', 1, timestamp24hAgo);

            if (data && data.length > 0) {
                const snapshot = data[0];

                // Değerleri kaydet (Total ve Total2 için value, Dominance için close/value)
                // Historical servisten gelen veriler ham verilerdir, multiplier burada calculateIndices içinde uygulanır
                // ANCAK: Historical service artık multiplier'ı içinde uyguluyor (calculateIndicesInternal L634 ff)
                // Bu yüzden direkt kullanabiliriz.

                this.referenceValues.TOTAL = snapshot.total.close; // close değeri value ile aynıdır (total için)
                this.referenceValues.TOTAL2 = snapshot.total2.close;
                this.referenceValues['BTC.D'] = snapshot['btc.d'].close;
                this.referenceValues['ETH.D'] = snapshot['eth.d'].close;
                this.referenceValues['USDT.D'] = snapshot['usdt.d'].close;

                console.log(`📊 [MarketCap] Updated 24h reference values from ${new Date(snapshot.time * 1000).toISOString()}`);
                console.log(`   Ref TOTAL: ${this.formatMarketCap(this.referenceValues.TOTAL)}`);
                console.log(`   Ref BTC.D: ${this.referenceValues['BTC.D'].toFixed(2)}%`);
            } else {
                console.warn('⚠️ [MarketCap] Could not fetch 24h reference values, will use fallback calculation');
            }
        } catch (error) {
            console.error('❌ [MarketCap] Failed to update reference values:', error.message);
        }
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

        // Individual coin market caps for dominance calculation
        let btcMarketCap = 0;
        let ethMarketCap = 0;

        // Calculate USDT market cap BEFORE the loop (USDT has no trading pair, always $1)
        const usdtSupply = CIRCULATING_SUPPLY['USDT'];
        let usdtMarketCap = usdtSupply ? usdtSupply * 1.0 : 0;

        let coinsProcessed = 0;
        let coinsWithSupply = 0;

        // Her coin için market cap hesapla (Object.entries kullan, Map değil)
        for (const [symbol, ticker] of Object.entries(spotCache)) {
            // USDT pair'leri filtrele (symbol lowercase: btcusdt)
            if (!symbol.endsWith('usdt')) continue;

            // Base symbol'u al (btcusdt -> BTC)
            const baseSymbol = symbol.replace('usdt', '').toUpperCase();

            // Stablecoin'leri atla (USDT already calculated before loop)
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

            // Track individual coins for dominance
            if (baseSymbol === 'BTC') btcMarketCap = marketCap;
            if (baseSymbol === 'ETH') ethMarketCap = marketCap;
            if (baseSymbol === 'USDT') usdtMarketCap = marketCap;

            // Top 10 hariç toplam (Disabled)
            /*
            if (!TOP_10_SYMBOLS.includes(baseSymbol)) {
                others += marketCap;
            }
            */

            coinsWithSupply++;
            coinsProcessed++;
        }

        // Calculate total including stablecoins for dominance calculation
        const totalWithStablecoins = total + usdtMarketCap; // Add other stablecoins if needed

        // 24h değişim hesapla (FALLBACK: Eğer referans değer yoksa ağırlıklı ortalama kullan)
        let totalChange = 0;
        let total2Change = 0;

        // Eğer referans değer yoksa eski yöntemle hesapla (Fallback)
        if (!this.referenceValues.TOTAL) {
            for (const [symbol, data] of this.marketCaps.entries()) {
                const weight = data.marketCap / total;
                totalChange += data.change24h * weight;

                if (symbol !== 'BTC') {
                    const weight2 = data.marketCap / total2;
                    total2Change += data.change24h * weight2;
                }
            }
        }

        // Indexleri güncelle (Multiplier Calibration Applied)
        const totalCalibrated = total * INDEX_MULTIPLIERS.TOTAL;
        const total2Calibrated = total2 * INDEX_MULTIPLIERS.TOTAL2;
        // OTHERS disabled
        // const othersCalibrated = others * INDEX_MULTIPLIERS.OTHERS;

        // YENİ 24SAAT DEĞİŞİM HESABI
        // Eğer referans değer varsa, şu anki değer ile 24 saat önceki değeri kıyasla
        if (this.referenceValues.TOTAL) {
            totalChange = ((totalCalibrated - this.referenceValues.TOTAL) / this.referenceValues.TOTAL) * 100;
        }

        if (this.referenceValues.TOTAL2) {
            total2Change = ((total2Calibrated - this.referenceValues.TOTAL2) / this.referenceValues.TOTAL2) * 100;
        }

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

        // Calculate dominance percentages (using total WITH stablecoins)
        const btcDominance = totalWithStablecoins > 0 ? (btcMarketCap / totalWithStablecoins) * 100 : 0;
        const ethDominance = totalWithStablecoins > 0 ? (ethMarketCap / totalWithStablecoins) * 100 : 0;
        const usdtDominance = totalWithStablecoins > 0 ? (usdtMarketCap / totalWithStablecoins) * 100 : 0;

        // Apply multipliers to current values
        const btcDValue = btcDominance * (DOMINANCE_MULTIPLIERS['BTC.D'] || 1);
        const ethDValue = ethDominance * (DOMINANCE_MULTIPLIERS['ETH.D'] || 1);
        const usdtDValue = usdtDominance * (DOMINANCE_MULTIPLIERS['USDT.D'] || 1);

        // Get previous dominance for change calculation (Deprecated approach)
        // const prevBtcD = this.indices['BTC.D'].value || btcDValue;
        // const prevEthD = this.indices['ETH.D'].value || ethDValue;
        // const prevUsdtD = this.indices['USDT.D'].value || usdtDValue;

        // YENİ DOMINANCE DEĞİŞİM HESABI
        let btcDChange = 0;
        let ethDChange = 0;
        let usdtDChange = 0;

        if (this.referenceValues['BTC.D']) {
            // Yüzdelik puan değişimi (Percentage Point Change) indexler için daha mantıklı olabilir 
            // ama kullanıcı genelde yüzdelik değişim ister. 
            // TradingView'de BTC.D 55.00 -> 55.55 ise bu +1.00% değişimdir.
            btcDChange = ((btcDValue - this.referenceValues['BTC.D']) / this.referenceValues['BTC.D']) * 100;
        }

        if (this.referenceValues['ETH.D']) {
            ethDChange = ((ethDValue - this.referenceValues['ETH.D']) / this.referenceValues['ETH.D']) * 100;
        }

        if (this.referenceValues['USDT.D']) {
            usdtDChange = ((usdtDValue - this.referenceValues['USDT.D']) / this.referenceValues['USDT.D']) * 100;
        }

        this.indices['BTC.D'] = {
            value: btcDValue,
            change24h: btcDChange,
            formattedValue: btcDValue.toFixed(2) + '%',
        };

        this.indices['ETH.D'] = {
            value: ethDValue,
            change24h: ethDChange,
            formattedValue: ethDValue.toFixed(2) + '%',
        };

        this.indices['USDT.D'] = {
            value: usdtDValue,
            change24h: usdtDChange,
            formattedValue: usdtDValue.toFixed(2) + '%',
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
            console.log(`   BTC.D:  ${this.indices['BTC.D'].formattedValue} (${btcDChange.toFixed(2)}%)`);
            console.log(`   ETH.D:  ${this.indices['ETH.D'].formattedValue} (${ethDChange.toFixed(2)}%)`);
            console.log(`   USDT.D: ${this.indices['USDT.D'].formattedValue} (${usdtDChange.toFixed(2)}%)`);
            // console.log(`   OTHERS: ${this.indices.OTHERS.formattedValue} (${othersChange.toFixed(2)}%)`);
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
