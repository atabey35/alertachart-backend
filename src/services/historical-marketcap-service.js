/**
 * Historical Market Cap Service
 * 
 * Binance'den historical kline verileri çekip
 * her timeframe için TOTAL, TOTAL2, OTHERS hesaplar.
 * 
 * SSE (Server-Sent Events) ile progressive streaming destekler.
 */

import { CIRCULATING_SUPPLY, STABLECOINS, TOP_10_SYMBOLS, DOMINANCE_MULTIPLIERS, INDEX_MULTIPLIERS } from '../data/circulating-supply.js';

// In-memory cache for calculated historical data
const historyCache = new Map(); // key: `${interval}_${limit}` -> data array

class HistoricalMarketCapService {
    constructor() {
        // Binance kline intervals
        this.supportedIntervals = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

        // Cache TTL (ms)
        this.cacheTTL = {
            '1m': 60 * 1000,        // 1 minute
            '5m': 5 * 60 * 1000,    // 5 minutes
            '15m': 15 * 60 * 1000,  // 15 minutes
            '1h': 60 * 60 * 1000,   // 1 hour
            '4h': 4 * 60 * 60 * 1000, // 4 hours
            '1d': 24 * 60 * 60 * 1000, // 1 day
            '1w': 7 * 24 * 60 * 60 * 1000, // 1 week
        };

        // Coins to fetch (only those with supply data)
        this.coinsToFetch = Object.keys(CIRCULATING_SUPPLY).filter(
            symbol => !STABLECOINS.includes(symbol)
        );

        console.log(`📊 [HistoricalMCap] Initialized with ${this.coinsToFetch.length} coins`);

        // Request deduplication map
        this.pendingRequests = new Map();

        // Warm up cache immediately
        this.initializeCache();
    }

    /**
     * Initialize cache with popular timeframes (Warm-up)
     */
    initializeCache() {
        console.log('🔥 [HistoricalMCap] Warming up cache for popular timeframes...');
        // Arka planda hesapla, hatayı yut (zaten loglanıyor)
        // High Timeframes (Critical for daily view)
        this.calculateHistoricalIndices('1d', 2000).catch(() => { });
        this.calculateHistoricalIndices('4h', 2000).catch(() => { });
        this.calculateHistoricalIndices('1h', 2000).catch(() => { });

        // Low Timeframes (Requested by user) - delay slightly to prioritize HTF
        setTimeout(() => {
            this.calculateHistoricalIndices('15m', 2000).catch(() => { });
            this.calculateHistoricalIndices('5m', 2000).catch(() => { });
            this.calculateHistoricalIndices('1m', 2000).catch(() => { });
        }, 5000); // 5 sec delay to let HTF requests start first and avoid burst rate limits
    }

    /**
     * Get cached data if available and fresh
     */
    getCachedData(interval, limit, endTime = null) {
        const cacheKey = `${interval}_${limit}_${endTime || 'latest'}`;
        const cached = historyCache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < this.cacheTTL[interval]) {
            console.log(`📊 [HistoricalMCap] Cache hit for ${cacheKey}`);
            return cached.data;
        }

        return null;
    }

    /**
     * Set cache data
     */
    setCacheData(interval, limit, endTime, data) {
        const cacheKey = `${interval}_${limit}_${endTime || 'latest'}`;
        historyCache.set(cacheKey, {
            data,
            timestamp: Date.now(),
        });
        console.log(`📊 [HistoricalMCap] Cached ${data.length} candles for ${cacheKey}`);
    }

    /**
     * Fetch klines from Binance for a single symbol
     */
    /**
     * Fetch klines from Binance for a single symbol
     * Supports fetching more than 1000 candles by splitting requests
     */
    async fetchKlines(symbol, interval, limit = 500, initialEndTime = null, retries = 3) {
        // Binance limit per request is 1000
        const MAX_LIMIT_PER_REQ = 1000;
        let remainingLimit = limit;
        let allKlines = [];
        let endTime = initialEndTime; // Used for pagination (going backwards)

        // Calculate how many chunks we need
        // E.g. limit 2500 -> 1000, 1000, 500
        while (remainingLimit > 0) {
            const currentLimit = Math.min(remainingLimit, MAX_LIMIT_PER_REQ);

            let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=${interval}&limit=${currentLimit}`;
            if (endTime) {
                url += `&endTime=${endTime}`;
            }

            let fetchedChunk = null;

            for (let attempt = 1; attempt <= retries; attempt++) {
                try {
                    const response = await fetch(url);
                    if (response.status === 429) {
                        console.warn(`📊 [HistoricalMCap] Rate limited for ${symbol}, waiting... (Attempt ${attempt}/${retries})`);
                        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                        continue;
                    }

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const data = await response.json();

                    // Parse klines
                    const chunk = data.map(k => ({
                        time: k[0],
                        open: parseFloat(k[1]),
                        high: parseFloat(k[2]),
                        low: parseFloat(k[3]),
                        close: parseFloat(k[4]),
                        volume: parseFloat(k[5]),
                    }));

                    fetchedChunk = chunk;
                    break; // Success
                } catch (error) {
                    if (attempt === retries) {
                        console.error(`📊 [HistoricalMCap] Failed to fetch ${symbol}: ${error.message}`);
                        // If a chunk fails, we return what we have so far or null if critical
                        if (allKlines.length > 0) return allKlines.sort((a, b) => a.time - b.time);
                        return null;
                    }
                    await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                }
            }

            if (!fetchedChunk || fetchedChunk.length === 0) {
                break; // No more data available
            }

            // Add to total collection
            // fetch with endTime returns data ENDING at endTime.
            // But wait, standard binance behavior:
            // If we don't send endTime, we get LATEST candles.
            // If we send endTime, we get candles UP TO endTime.
            // So we want to prepend older data to our list.

            // However, iterating backwards:
            // 1. Fetch latest N (no endTime)
            // 2. Fetch next N (endTime = oldest_time - 1)

            if (allKlines.length === 0) {
                // First chunk (latest data)
                allKlines = fetchedChunk;
            } else {
                // Older chunks -> Prepend
                allKlines = [...fetchedChunk, ...allKlines];
            }

            // Update remaining
            remainingLimit -= fetchedChunk.length;

            // Prepare for next chunk (older data)
            // endTime should be time of oldest candle - 1ms
            if (fetchedChunk.length > 0) {
                endTime = fetchedChunk[0].time - 1;
            } else {
                break;
            }

            // If we got fewer candles than requested, we probably reached end of history
            if (fetchedChunk.length < currentLimit) {
                break;
            }

            // Small delay between chunks
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        return allKlines;
    }

    /**
     * Calculate historical indices (non-streaming, for REST API)
     */
    async calculateHistoricalIndices(interval = '1h', limit = 2000, endTime = null) {
        // Check cache first
        const cacheKey = `${interval}_${limit}_${endTime || 'latest'}`;

        // 1. Check Cache
        const cached = this.getCachedData(interval, limit, endTime);
        if (cached) return cached;

        // 2. Check Pending Request (Deduplication)
        if (this.pendingRequests.has(cacheKey)) {
            console.log(`⏳ [HistoricalMCap] Waiting for pending calculation: ${cacheKey}`);
            return this.pendingRequests.get(cacheKey);
        }

        console.log(`📊 [HistoricalMCap] Calculating ${interval} indices (${limit} candles) end=${endTime || 'now'}...`);

        // 3. Start New Calculation
        const promise = (async () => {
            return this._calculateIndicesInternal(interval, limit, endTime);
        })();

        this.pendingRequests.set(cacheKey, promise);

        try {
            return await promise;
        } finally {
            this.pendingRequests.delete(cacheKey);
        }
    }

    async _calculateIndicesInternal(interval, limit, endTime = null) {
        const startTime = Date.now();

        // Fetch all coin klines in parallel (batch of 10 to avoid rate limits)
        const allKlines = new Map(); // symbol -> klines array
        const batchSize = 10;

        // Use larger delay for high-weight requests (limit=1000 is weight 5 per req)
        // 500ms delay ensures we stay under safe limits
        const batchDelay = limit > 500 ? 500 : 200;

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < this.coinsToFetch.length; i += batchSize) {
            const batch = this.coinsToFetch.slice(i, i + batchSize);
            const promises = batch.map(symbol =>
                this.fetchKlines(symbol, interval, limit, endTime).then(klines => ({ symbol, klines }))
            );

            const results = await Promise.all(promises);
            results.forEach(({ symbol, klines }) => {
                if (klines && klines.length > 0) {
                    allKlines.set(symbol, klines);
                    successCount++;
                } else {
                    failCount++;
                }
            });

            // Small delay between batches to respect rate limits
            if (i + batchSize < this.coinsToFetch.length) {
                await new Promise(resolve => setTimeout(resolve, batchDelay));
            }
        }

        const totalCoins = this.coinsToFetch.length;
        const successRate = (successCount / totalCoins) * 100;
        console.log(`📊 [HistoricalMCap] Fetched klines for ${successCount}/${totalCoins} coins (${successRate.toFixed(1)}%)`);

        if (successRate < 90) {
            console.warn(`⚠️ [HistoricalMCap] Low success rate (${successRate.toFixed(1)}%), skipping cache save to prevent corrupted 1d data`);
            // We still proceed calculating with what we have, but we don't cache it
            // so next request will try again
        }

        // 1. Optimize: Convert Array to Map for O(1) Access and sort timestamps
        const quickKlines = new Map();
        const timeSet = new Set();

        for (const [symbol, klines] of allKlines.entries()) {
            const klineMap = new Map();
            klines.forEach(k => {
                klineMap.set(k.time, k);
                timeSet.add(k.time);
            });
            quickKlines.set(symbol, klineMap);
        }

        const timestamps = Array.from(timeSet).sort((a, b) => a - b);
        const indices = [];

        // 2. State for Forward Filling (prevent drop-off when data is missing)
        // Stores the last known candle for each symbol
        const lastKnownCandles = new Map();

        for (const ts of timestamps) {
            let total = 0, open = 0, high = 0, low = 0, close = 0;
            let total2 = 0, total2Open = 0, total2High = 0, total2Low = 0, total2Close = 0;
            let total2Value = 0; // Separate value accumulator for TOTAL2

            // Track individual coins for dominance calculation
            let btcMarketCap = 0, btcOpen = 0, btcHigh = 0, btcLow = 0;
            let ethMarketCap = 0, ethOpen = 0, ethHigh = 0, ethLow = 0;
            let usdtMarketCap = 0, usdtOpen = 0, usdtHigh = 0, usdtLow = 0;

            // Check if BTC exists (Market Validator)
            // If BTC is missing entirely for this timestamp AND it's not a small gap, 
            // it's likely a bad data point for the whole market.
            const btcCandle = quickKlines.get('BTC')?.get(ts);

            // Allow BTC to be forward-filled for short gaps, but if it's missing at start, skip
            if (!btcCandle && !lastKnownCandles.get('BTC')) {
                continue;
            }

            // Special handling for USDT (stablecoin, no trading pair, always $1)
            const usdtSupply = CIRCULATING_SUPPLY['USDT'];
            if (usdtSupply) {
                const usdtMC = usdtSupply * 1.0; // $1 price
                usdtMarketCap = usdtMC;
                usdtOpen = usdtMC;
                usdtHigh = usdtMC;
                usdtLow = usdtMC;
            }

            let coinsCounted = 0;

            for (const symbol of this.coinsToFetch) {
                // Get supply
                const supply = CIRCULATING_SUPPLY[symbol];
                if (!supply) continue;

                // 3. Get Candle: Try current timestamp -> Fallback to last known (Forward Fill)
                let candle = quickKlines.get(symbol)?.get(ts);

                if (candle) {
                    // Update last known
                    lastKnownCandles.set(symbol, candle);
                } else {
                    // Forward Fill: Use last known candle if available
                    // This prevents the chart from "dropping" when a specific coin misses a 1m/5m candle
                    candle = lastKnownCandles.get(symbol);
                }

                // If still no candle (e.g. coin hasn't started trading yet), skip
                if (!candle || !candle.close) continue;

                const mcOpen = candle.open * supply;
                const mcHigh = candle.high * supply;
                const mcLow = candle.low * supply;
                const mcClose = candle.close * supply;

                // Accumulate TOTAL
                open += mcOpen;
                high += mcHigh;
                low += mcLow;
                close += mcClose;
                total = close;

                // Accumulate TOTAL2 (Ex-BTC)
                if (symbol !== 'BTC') {
                    total2Open += mcOpen;
                    total2High += mcHigh;
                    total2Low += mcLow;
                    total2Close += mcClose;
                    total2Value = total2Close;
                }

                // Track individual coins for dominance
                if (symbol === 'BTC') {
                    btcMarketCap = mcClose;
                    btcOpen = mcOpen;
                    btcHigh = mcHigh;
                    btcLow = mcLow;
                }
                if (symbol === 'ETH') {
                    ethMarketCap = mcClose;
                    ethOpen = mcOpen;
                    ethHigh = mcHigh;
                    ethLow = mcLow;
                }
                if (symbol === 'USDT') {
                    usdtMarketCap = mcClose;
                    usdtOpen = mcOpen;
                    usdtHigh = mcHigh;
                    usdtLow = mcLow;
                }

                coinsCounted++;
            }

            // Calculate total WITH stablecoins for dominance
            const totalWithStablecoins = total + usdtMarketCap;

            if (total > 0) {
                indices.push({
                    time: Math.floor(ts / 1000),
                    total: {
                        open: open * (INDEX_MULTIPLIERS.TOTAL || 1),
                        high: high * (INDEX_MULTIPLIERS.TOTAL || 1),
                        low: low * (INDEX_MULTIPLIERS.TOTAL || 1),
                        close: close * (INDEX_MULTIPLIERS.TOTAL || 1),
                        value: total * (INDEX_MULTIPLIERS.TOTAL || 1)
                    },
                    total2: {
                        open: total2Open * (INDEX_MULTIPLIERS.TOTAL2 || 1),
                        high: total2High * (INDEX_MULTIPLIERS.TOTAL2 || 1),
                        low: total2Low * (INDEX_MULTIPLIERS.TOTAL2 || 1),
                        close: total2Close * (INDEX_MULTIPLIERS.TOTAL2 || 1),
                        value: total2Value * (INDEX_MULTIPLIERS.TOTAL2 || 1)
                    },
                    others: { open: 0, high: 0, low: 0, close: 0, value: 0 }, // Disabled
                    'btc.d': {
                        open: ((btcOpen / (open + usdtOpen)) * 100) * (DOMINANCE_MULTIPLIERS['BTC.D'] || 1),
                        high: ((btcHigh / (high + usdtHigh)) * 100) * (DOMINANCE_MULTIPLIERS['BTC.D'] || 1),
                        low: ((btcLow / (low + usdtLow)) * 100) * (DOMINANCE_MULTIPLIERS['BTC.D'] || 1),
                        close: ((btcMarketCap / (close + usdtMarketCap)) * 100) * (DOMINANCE_MULTIPLIERS['BTC.D'] || 1),
                        value: ((btcMarketCap / totalWithStablecoins) * 100) * (DOMINANCE_MULTIPLIERS['BTC.D'] || 1)
                    },
                    'eth.d': {
                        open: ((ethOpen / (open + usdtOpen)) * 100) * (DOMINANCE_MULTIPLIERS['ETH.D'] || 1),
                        high: ((ethHigh / (high + usdtHigh)) * 100) * (DOMINANCE_MULTIPLIERS['ETH.D'] || 1),
                        low: ((ethLow / (low + usdtLow)) * 100) * (DOMINANCE_MULTIPLIERS['ETH.D'] || 1),
                        close: ((ethMarketCap / (close + usdtMarketCap)) * 100) * (DOMINANCE_MULTIPLIERS['ETH.D'] || 1),
                        value: ((ethMarketCap / totalWithStablecoins) * 100) * (DOMINANCE_MULTIPLIERS['ETH.D'] || 1)
                    },
                    'usdt.d': {
                        open: ((usdtOpen / (open + usdtOpen)) * 100) * (DOMINANCE_MULTIPLIERS['USDT.D'] || 1),
                        high: ((usdtHigh / (high + usdtHigh)) * 100) * (DOMINANCE_MULTIPLIERS['USDT.D'] || 1),
                        low: ((usdtLow / (low + usdtLow)) * 100) * (DOMINANCE_MULTIPLIERS['USDT.D'] || 1),
                        close: ((usdtMarketCap / (close + usdtMarketCap)) * 100) * (DOMINANCE_MULTIPLIERS['USDT.D'] || 1),
                        value: ((usdtMarketCap / totalWithStablecoins) * 100) * (DOMINANCE_MULTIPLIERS['USDT.D'] || 1)
                    }
                });
            }
        }

        const elapsed = Date.now() - startTime;
        console.log(`📊 [HistoricalMCap] Calculated ${indices.length} candles in ${elapsed}ms`);

        // Cache the result ONLY if data is reliable
        if (successRate >= 90) {
            this.setCacheData(interval, limit, endTime, indices);
        } else {
            console.warn(`⚠️ [HistoricalMCap] Skipping cache due to partial data`);
        }

        return indices;
    }

    /**
     * Stream historical indices via SSE (progressive loading)
     */
    async streamHistoricalIndices(res, interval = '1h', limit = 500, indexType = 'TOTAL') {
        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // Check cache first
        const cached = this.getCachedData(interval, limit);
        if (cached) {
            // Send cached data in chunks
            const chunkSize = 100;
            for (let i = 0; i < cached.length; i += chunkSize) {
                const chunk = cached.slice(i, i + chunkSize).map(c => ({
                    time: c.time,
                    open: c[indexType.toLowerCase()].open,
                    high: c[indexType.toLowerCase()].high,
                    low: c[indexType.toLowerCase()].low,
                    close: c[indexType.toLowerCase()].close,
                }));

                res.write(`data: ${JSON.stringify({ type: 'candles', data: chunk })}\n\n`);
            }

            res.write(`data: ${JSON.stringify({ type: 'complete', total: cached.length })}\n\n`);
            res.end();
            return;
        }

        // Calculate and stream progressively
        console.log(`📊 [HistoricalMCap] Streaming ${interval} ${indexType} (${limit} candles)...`);

        // Send initial message
        res.write(`data: ${JSON.stringify({ type: 'start', coins: this.coinsToFetch.length })}\n\n`);

        // Fetch and process in batches, streaming as we go
        const allKlines = new Map();
        const batchSize = 10;
        let processedCoins = 0;

        for (let i = 0; i < this.coinsToFetch.length; i += batchSize) {
            const batch = this.coinsToFetch.slice(i, i + batchSize);
            const promises = batch.map(symbol =>
                this.fetchKlines(symbol, interval, limit).then(klines => ({ symbol, klines }))
            );

            const results = await Promise.all(promises);
            results.forEach(({ symbol, klines }) => {
                if (klines && klines.length > 0) {
                    allKlines.set(symbol, klines);
                }
            });

            processedCoins += batch.length;

            // Send progress update
            res.write(`data: ${JSON.stringify({
                type: 'progress',
                processed: processedCoins,
                total: this.coinsToFetch.length
            })}\n\n`);

            // Calculate partial indices every 20 coins and stream
            if (processedCoins % 20 === 0 || processedCoins === this.coinsToFetch.length) {
                const partialIndices = this.calculateIndicesFromKlines(allKlines, indexType);
                if (partialIndices.length > 0) {
                    res.write(`data: ${JSON.stringify({ type: 'candles', data: partialIndices, partial: true })}\n\n`);
                }
            }

            // Small delay between batches
            if (i + batchSize < this.coinsToFetch.length) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        // Final complete calculation
        const finalIndices = this.calculateIndicesFromKlines(allKlines, indexType);

        // Cache the full result
        const fullData = this.buildFullCacheData(allKlines);
        this.setCacheData(interval, limit, fullData);

        res.write(`data: ${JSON.stringify({ type: 'candles', data: finalIndices, partial: false })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'complete', total: finalIndices.length })}\n\n`);
        res.end();
    }

    /**
     * Helper: Calculate indices from klines map for a specific index type
     */
    calculateIndicesFromKlines(allKlines, indexType = 'TOTAL') {
        const timeSet = new Set();
        for (const [symbol, klines] of allKlines.entries()) {
            klines.forEach(k => timeSet.add(k.time));
        }
        const timestamps = Array.from(timeSet).sort((a, b) => a - b);

        const indices = [];

        for (const ts of timestamps) {
            let open = 0, high = 0, low = 0, close = 0;

            for (const [symbol, klines] of allKlines.entries()) {
                const candle = klines.find(k => k.time === ts);
                if (!candle) continue;

                const supply = CIRCULATING_SUPPLY[symbol];
                if (!supply) continue;

                // Filter based on index type
                if (indexType === 'TOTAL2' && symbol === 'BTC') continue;
                if (indexType === 'OTHERS' && TOP_10_SYMBOLS.includes(symbol)) continue;

                open += candle.open * supply;
                high += candle.high * supply;
                low += candle.low * supply;
                close += candle.close * supply;
            }

            if (close > 0) {
                indices.push({
                    time: Math.floor(ts / 1000),
                    open, high, low, close,
                });
            }
        }

        return indices;
    }

    /**
     * Helper: Build full cache data structure
     */
    buildFullCacheData(allKlines) {
        const timeSet = new Set();
        for (const [symbol, klines] of allKlines.entries()) {
            klines.forEach(k => timeSet.add(k.time));
        }
        const timestamps = Array.from(timeSet).sort((a, b) => a - b);

        const indices = [];

        for (const ts of timestamps) {
            let tOpen = 0, tHigh = 0, tLow = 0, tClose = 0;
            let t2Open = 0, t2High = 0, t2Low = 0, t2Close = 0;
            let oOpen = 0, oHigh = 0, oLow = 0, oClose = 0;

            for (const [symbol, klines] of allKlines.entries()) {
                const candle = klines.find(k => k.time === ts);
                if (!candle) continue;

                const supply = CIRCULATING_SUPPLY[symbol];
                if (!supply) continue;

                const mcO = candle.open * supply;
                const mcH = candle.high * supply;
                const mcL = candle.low * supply;
                const mcC = candle.close * supply;

                tOpen += mcO; tHigh += mcH; tLow += mcL; tClose += mcC;

                if (symbol !== 'BTC') {
                    t2Open += mcO; t2High += mcH; t2Low += mcL; t2Close += mcC;
                }

                // OTHERS (Disabled)
                /*
                if (!TOP_10_SYMBOLS.includes(symbol)) {
                    oOpen += mcO; oHigh += mcH; oLow += mcL; oClose += mcC;
                }
                */
            }

            if (tClose > 0) {
                // Apply multipliers
                indices.push({
                    time: Math.floor(ts / 1000),
                    total: {
                        open: tOpen * INDEX_MULTIPLIERS.TOTAL,
                        high: tHigh * INDEX_MULTIPLIERS.TOTAL,
                        low: tLow * INDEX_MULTIPLIERS.TOTAL,
                        close: tClose * INDEX_MULTIPLIERS.TOTAL,
                        value: tClose * INDEX_MULTIPLIERS.TOTAL
                    },
                    total2: {
                        open: t2Open * INDEX_MULTIPLIERS.TOTAL2,
                        high: t2High * INDEX_MULTIPLIERS.TOTAL2,
                        low: t2Low * INDEX_MULTIPLIERS.TOTAL2,
                        close: t2Close * INDEX_MULTIPLIERS.TOTAL2,
                        value: t2Close * INDEX_MULTIPLIERS.TOTAL2
                    },
                    others: {
                        // OTHERS Disabled
                        open: 0, high: 0, low: 0, close: 0, value: 0
                    },
                });
            }
        }

        return indices;
    }
}

// Singleton instance
let instance = null;

export function getHistoricalMarketCapService() {
    if (!instance) {
        instance = new HistoricalMarketCapService();
    }
    return instance;
}

export default HistoricalMarketCapService;
