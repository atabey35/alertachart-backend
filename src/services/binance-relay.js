/**
 * Binance WebSocket Relay Service
 * 
 * Connects to Binance WebSocket once and broadcasts to all clients.
 * This bypasses US IP restrictions by having clients connect to our server
 * instead of directly to Binance.
 * 
 * Features:
 * - Single Binance connection for all clients (rate limit friendly)
 * - In-memory cache for instant data on new connections
 * - Room-based subscriptions (clients only get coins they need)
 * - Automatic reconnection with exponential backoff
 */

import WebSocket from 'ws';

class BinanceRelayService {
    constructor(io) {
        this.io = io;

        // Binance WebSocket connections
        this.spotWs = null;
        this.futuresWs = null;

        // Price caches
        this.spotCache = new Map();    // symbol -> ticker data
        this.futuresCache = new Map(); // symbol -> ticker data

        // Connection state
        this.spotConnected = false;
        this.futuresConnected = false;
        this.spotReconnectAttempts = 0;
        this.futuresReconnectAttempts = 0;
        this.maxReconnectAttempts = 10;

        // Broadcast throttle (avoid overwhelming clients)
        this.lastBroadcastTime = 0;
        this.broadcastInterval = 100; // ms - Binance sends every 100ms anyway
    }

    /**
     * Start the relay service
     */
    start() {
        console.log('[Binance Relay] 🚀 Starting Binance WebSocket Relay Service...');

        // Fetch initial snapshot via REST to populate cache immediately
        this.fetchInitialSnapshot();

        this.connectToSpot();
        this.connectToFutures();
        this.setupSocketIOHandlers();

        console.log('[Binance Relay] ✅ Relay service started');
    }

    /**
     * Fetch initial full snapshot via REST API
     * (Fixes "Red Daily Candle" issue due to missing inactive coins)
     */
    async fetchInitialSnapshot() {
        try {
            console.log('[Binance Relay] 📸 Fetching initial snapshot...');
            const [spotRes, futuresRes] = await Promise.all([
                fetch('https://api.binance.com/api/v1/ticker/24hr'),
                fetch('https://fapi.binance.com/fapi/v1/ticker/24hr')
            ]);

            if (spotRes.ok) {
                const spotData = await spotRes.json();
                this.handleSpotMessage(Buffer.from(JSON.stringify(spotData)));
                console.log(`[Binance Relay] ✅ Initial Spot snapshot loaded: ${spotData.length} coins`);
            }

            if (futuresRes.ok) {
                const futuresData = await futuresRes.json();
                this.handleFuturesMessage(Buffer.from(JSON.stringify(futuresData)));
                console.log(`[Binance Relay] ✅ Initial Futures snapshot loaded: ${futuresData.length} coins`);
            }
        } catch (error) {
            console.error('[Binance Relay] ❌ Failed to fetch initial snapshot:', error.message);
        }
    }

    /**
     * Connect to Binance Spot WebSocket
     * Uses !ticker@arr for all spot tickers with full data including price change %
     */
    connectToSpot() {
        // !ticker@arr = All market tickers with full data (includes P = price change %)
        const url = 'wss://stream.binance.com:9443/ws/!ticker@arr';

        console.log('[Binance Relay] Connecting to Binance Spot...');

        try {
            this.spotWs = new WebSocket(url);

            this.spotWs.on('open', () => {
                console.log('[Binance Relay] ✅ Connected to Binance Spot WebSocket');
                this.spotConnected = true;
                this.spotReconnectAttempts = 0;
            });

            this.spotWs.on('message', (data) => {
                this.handleSpotMessage(data);
            });

            this.spotWs.on('close', () => {
                console.log('[Binance Relay] Spot connection closed');
                this.spotConnected = false;
                this.scheduleReconnect('spot');
            });

            this.spotWs.on('error', (error) => {
                console.error('[Binance Relay] Spot WebSocket error:', error.message);
            });
        } catch (error) {
            console.error('[Binance Relay] Failed to connect to Spot:', error.message);
            this.scheduleReconnect('spot');
        }
    }

    /**
     * Connect to Binance Futures WebSocket
     * Uses !ticker@arr for all futures tickers with full data
     */
    connectToFutures() {
        // !ticker@arr = Full ticker with price change %
        const url = 'wss://fstream.binance.com/ws/!ticker@arr';

        console.log('[Binance Relay] Connecting to Binance Futures...');

        try {
            this.futuresWs = new WebSocket(url);

            this.futuresWs.on('open', () => {
                console.log('[Binance Relay] ✅ Connected to Binance Futures WebSocket');
                this.futuresConnected = true;
                this.futuresReconnectAttempts = 0;
            });

            this.futuresWs.on('message', (data) => {
                this.handleFuturesMessage(data);
            });

            this.futuresWs.on('close', () => {
                console.log('[Binance Relay] Futures connection closed');
                this.futuresConnected = false;
                this.scheduleReconnect('futures');
            });

            this.futuresWs.on('error', (error) => {
                console.error('[Binance Relay] Futures WebSocket error:', error.message);
            });
        } catch (error) {
            console.error('[Binance Relay] Failed to connect to Futures:', error.message);
            this.scheduleReconnect('futures');
        }
    }

    /**
     * Handle Spot ticker messages
     */
    handleSpotMessage(data) {
        try {
            const tickers = JSON.parse(data.toString());

            if (!Array.isArray(tickers)) return;

            // Update cache
            tickers.forEach(ticker => {
                const symbol = ticker.s.toLowerCase();

                this.spotCache.set(symbol, {
                    symbol: symbol,
                    price: parseFloat(ticker.c),           // Close price
                    change24h: parseFloat(ticker.P || '0'), // Price change percent (only in full ticker)
                    volume24h: parseFloat(ticker.v || '0'), // Base asset volume
                    high24h: parseFloat(ticker.h || '0'),   // High price
                    low24h: parseFloat(ticker.l || '0'),    // Low price
                    openPrice: parseFloat(ticker.o || '0'), // Open price
                    timestamp: Date.now()
                });
            });

            // Broadcast to clients
            this.broadcastToClients('spot');

        } catch (error) {
            console.error('[Binance Relay] Spot parse error:', error.message);
        }
    }

    /**
     * Handle Futures ticker messages
     */
    handleFuturesMessage(data) {
        try {
            const tickers = JSON.parse(data.toString());

            if (!Array.isArray(tickers)) return;

            // Update cache
            tickers.forEach(ticker => {
                const symbol = ticker.s.toLowerCase();

                this.futuresCache.set(symbol, {
                    symbol: symbol,
                    price: parseFloat(ticker.c),
                    change24h: parseFloat(ticker.P || '0'),
                    volume24h: parseFloat(ticker.v || '0'),
                    high24h: parseFloat(ticker.h || '0'),
                    low24h: parseFloat(ticker.l || '0'),
                    openPrice: parseFloat(ticker.o || '0'),
                    timestamp: Date.now()
                });
            });

            // Broadcast to clients
            this.broadcastToClients('futures');

        } catch (error) {
            console.error('[Binance Relay] Futures parse error:', error.message);
        }
    }

    /**
     * Broadcast cached data to Socket.io clients
     */
    broadcastToClients(marketType) {
        const now = Date.now();

        // Throttle broadcasts to avoid overwhelming clients
        if (now - this.lastBroadcastTime < this.broadcastInterval) {
            return;
        }
        this.lastBroadcastTime = now;

        const cache = marketType === 'futures' ? this.futuresCache : this.spotCache;
        const rooms = this.io.sockets.adapter.rooms;

        // Broadcast to market-specific "all" room
        const allRoomName = `ticker-all-${marketType}`;
        if (rooms.has(allRoomName)) {
            const allData = Object.fromEntries(cache);
            this.io.to(allRoomName).emit('ticker-update', {
                marketType,
                data: allData
            });
        }

        // Broadcast to symbol-specific rooms
        cache.forEach((tickerData, symbol) => {
            const roomName = `ticker-${marketType}-${symbol}`;
            if (rooms.has(roomName)) {
                this.io.to(roomName).emit('ticker-update', {
                    marketType,
                    data: { [symbol]: tickerData }
                });
            }
        });
    }

    /**
     * Setup Socket.io event handlers for clients
     */
    setupSocketIOHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`[Binance Relay] Client connected: ${socket.id}`);

            // Client subscribes to specific symbols
            // Format: { symbols: ['btcusdt', 'ethusdt'], marketType: 'spot' | 'futures' }
            socket.on('subscribe', (params) => {
                const { symbols, marketType = 'spot' } = params;
                const symbolList = Array.isArray(symbols) ? symbols : [symbols];

                symbolList.forEach(symbol => {
                    const normalizedSymbol = symbol.toLowerCase();
                    const roomName = `ticker-${marketType}-${normalizedSymbol}`;
                    socket.join(roomName);
                });

                // Immediately send cached data for subscribed symbols
                const cache = marketType === 'futures' ? this.futuresCache : this.spotCache;
                const responseData = {};

                symbolList.forEach(symbol => {
                    const normalizedSymbol = symbol.toLowerCase();
                    if (cache.has(normalizedSymbol)) {
                        responseData[normalizedSymbol] = cache.get(normalizedSymbol);
                    }
                });

                if (Object.keys(responseData).length > 0) {
                    socket.emit('ticker-update', {
                        marketType,
                        data: responseData
                    });
                }

                console.log(`[Binance Relay] ${socket.id} subscribed to ${marketType}: ${symbolList.join(', ')}`);
            });

            // Client subscribes to all tickers for a market type
            socket.on('subscribe-all', (marketType = 'spot') => {
                const roomName = `ticker-all-${marketType}`;
                socket.join(roomName);

                // Send current cache immediately
                const cache = marketType === 'futures' ? this.futuresCache : this.spotCache;
                socket.emit('ticker-update', {
                    marketType,
                    data: Object.fromEntries(cache)
                });

                console.log(`[Binance Relay] ${socket.id} subscribed to all ${marketType} tickers`);
            });

            // Client unsubscribes from specific symbols
            socket.on('unsubscribe', (params) => {
                const { symbols, marketType = 'spot' } = params;
                const symbolList = Array.isArray(symbols) ? symbols : [symbols];

                symbolList.forEach(symbol => {
                    const roomName = `ticker-${marketType}-${symbol.toLowerCase()}`;
                    socket.leave(roomName);
                });

                console.log(`[Binance Relay] ${socket.id} unsubscribed from ${marketType}: ${symbolList.join(', ')}`);
            });

            // Client unsubscribes from all
            socket.on('unsubscribe-all', (marketType = 'spot') => {
                socket.leave(`ticker-all-${marketType}`);
            });

            // Get connection status
            socket.on('status', () => {
                socket.emit('status', {
                    spotConnected: this.spotConnected,
                    futuresConnected: this.futuresConnected,
                    spotCacheSize: this.spotCache.size,
                    futuresCacheSize: this.futuresCache.size
                });
            });

            socket.on('disconnect', () => {
                console.log(`[Binance Relay] Client disconnected: ${socket.id}`);
            });
        });
    }

    /**
     * Schedule reconnection with exponential backoff
     */
    scheduleReconnect(type) {
        const attempts = type === 'spot' ? this.spotReconnectAttempts : this.futuresReconnectAttempts;

        if (attempts >= this.maxReconnectAttempts) {
            console.error(`[Binance Relay] Max reconnect attempts reached for ${type}`);
            return;
        }

        if (type === 'spot') {
            this.spotReconnectAttempts++;
        } else {
            this.futuresReconnectAttempts++;
        }

        const delay = Math.min(1000 * Math.pow(2, attempts), 30000);

        console.log(`[Binance Relay] Reconnecting ${type} in ${delay}ms (attempt ${attempts + 1}/${this.maxReconnectAttempts})`);

        setTimeout(() => {
            if (type === 'spot') {
                this.connectToSpot();
            } else {
                this.connectToFutures();
            }
        }, delay);
    }

    /**
     * Get current spot cache (for REST API fallback)
     */
    getSpotCache() {
        return Object.fromEntries(this.spotCache);
    }

    /**
     * Get current futures cache
     */
    getFuturesCache() {
        return Object.fromEntries(this.futuresCache);
    }

    /**
     * Get specific ticker from cache
     */
    getTicker(symbol, marketType = 'spot') {
        const cache = marketType === 'futures' ? this.futuresCache : this.spotCache;
        return cache.get(symbol.toLowerCase());
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            spotConnected: this.spotConnected,
            futuresConnected: this.futuresConnected,
            spotCacheSize: this.spotCache.size,
            futuresCacheSize: this.futuresCache.size,
            uptime: process.uptime()
        };
    }

    /**
     * Graceful shutdown
     */
    stop() {
        console.log('[Binance Relay] Stopping relay service...');

        if (this.spotWs) {
            this.spotWs.close();
            this.spotWs = null;
        }

        if (this.futuresWs) {
            this.futuresWs.close();
            this.futuresWs = null;
        }

        this.spotConnected = false;
        this.futuresConnected = false;

        console.log('[Binance Relay] Relay service stopped');
    }
}

export default BinanceRelayService;
