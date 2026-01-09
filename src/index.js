/**
 * Alerta Chart Backend - Railway Deployment
 * Historical data API with pagination support
 * + Binance WebSocket Relay for US users
 */

import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import historicalRouter from './routes/historical.js';
import tickerRouter from './routes/ticker.js';
import pushRouter from './routes/push.js';
import alertsRouter from './routes/alerts.js';
import alarmsRouter from './routes/alarms.js';
import adminRouter from './routes/admin.js';
import authRouter from './routes/auth.js';
import devicesRouter from './routes/devices.js';
import { getAutoPriceAlertService } from './lib/push/auto-price-alerts.js';
import { getPercentageAlertService } from './lib/push/percentage-alerts.js';
import { getVolumeAlertService } from './lib/push/volume-alerts.js';
import { getScheduledSummaryService } from './lib/push/scheduled-summary.js';
import { getFundingOIAlertService } from './lib/push/funding-oi-alerts.js';
import { initPushDatabase } from './lib/push/db.js';
import { initAuthDatabase } from './lib/auth/db.js';
import BinanceRelayService from './services/binance-relay.js';
import MarketCapService from './services/market-cap-service.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    // Allow alertachart.com and aggr.alertachart.com
    if (allowedOrigins.includes(origin) ||
      origin.endsWith('.vercel.app') ||
      origin === 'https://alertachart.com' ||
      origin === 'https://aggr.alertachart.com') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Important: allow cookies
}));

app.use(cookieParser()); // Parse cookies
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    service: 'alerta-chart-backend'
  });
});

// API routes
app.use('/api/historical', historicalRouter);
app.use('/api/ticker', tickerRouter);
app.use('/api/push', pushRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/alarms', alarmsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/auth', authRouter);
app.use('/api/devices', devicesRouter);

// Relay endpoints will be added after binanceRelay is initialized
// (see below after Socket.io setup)

// Error handler - must be after all routes
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({
    error: err.message || 'Internal server error',
    timestamp: Date.now()
  });
});

// 🔥 CRITICAL: Add error handler for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', error);
  console.error('❌ Error name:', error.name);
  console.error('❌ Error message:', error.message);
  console.error('❌ Error stack:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION at:', promise);
  console.error('❌ Reason:', reason);
  process.exit(1);
});

// Create HTTP server from Express app (needed for Socket.io)
const httpServer = createServer(app);

// Initialize Socket.io with CORS configuration
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, etc.)
      if (!origin) return callback(null, true);

      // Allow alertachart.com and related origins
      if (allowedOrigins.includes(origin) ||
        origin.endsWith('.vercel.app') ||
        origin === 'https://alertachart.com' ||
        origin === 'https://www.alertachart.com' ||
        origin === 'https://aggr.alertachart.com' ||
        origin.includes('localhost')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']
});

// Initialize Binance Relay Service
const binanceRelay = new BinanceRelayService(io);

// Initialize Market Cap Service
const marketCapService = new MarketCapService(binanceRelay, io);

// Relay status endpoint (added before 404 handler via app.get)
app.get('/api/relay/status', (req, res) => {
  res.json(binanceRelay.getStatus());
});

// Ticker cache endpoints (REST fallback)
app.get('/api/relay/ticker/:marketType', (req, res) => {
  const { marketType } = req.params;
  if (marketType === 'futures') {
    res.json(binanceRelay.getFuturesCache());
  } else {
    res.json(binanceRelay.getSpotCache());
  }
});

app.get('/api/relay/ticker/:marketType/:symbol', (req, res) => {
  const { marketType, symbol } = req.params;
  const ticker = binanceRelay.getTicker(symbol, marketType);
  if (ticker) {
    res.json(ticker);
  } else {
    res.status(404).json({ error: 'Symbol not found in cache' });
  }
});

// Exchange Info Proxy - for Symbol Search (US users can't access Binance directly)
app.get('/api/relay/exchangeInfo/:marketType', async (req, res) => {
  const { marketType } = req.params;

  try {
    const url = marketType === 'futures'
      ? 'https://fapi.binance.com/fapi/v1/exchangeInfo'
      : 'https://api.binance.com/api/v3/exchangeInfo';

    const response = await fetch(url);
    const data = await response.json();

    // Cache headers for 5 minutes (exchangeInfo doesn't change often)
    res.set('Cache-Control', 'public, max-age=300');
    res.json(data);

    console.log(`[Relay] ExchangeInfo ${marketType}: ${data.symbols?.length || 0} symbols`);
  } catch (error) {
    console.error('[Relay] ExchangeInfo error:', error.message);
    res.status(500).json({ error: 'Failed to fetch exchange info' });
  }
});

// Market Cap Index Endpoints
app.get('/api/marketcap/indices', (req, res) => {
  res.json(marketCapService.getIndices());
});

app.get('/api/marketcap/coin/:symbol', (req, res) => {
  const { symbol } = req.params;
  const data = marketCapService.getCoinMarketCap(symbol);
  if (data) {
    res.json(data);
  } else {
    res.status(404).json({ error: 'Coin not found or no supply data' });
  }
});

app.get('/api/marketcap/top/:n', (req, res) => {
  const n = parseInt(req.params.n) || 10;
  res.json(marketCapService.getTopCoins(n));
});

// Historical Market Cap Endpoints
app.get('/api/marketcap/historical', async (req, res) => {
  const { interval = '1h', limit = 500, index = 'TOTAL', endTime = null } = req.query;

  try {
    const { getHistoricalMarketCapService } = await import('./services/historical-marketcap-service.js');
    const service = getHistoricalMarketCapService();

    const data = await service.calculateHistoricalIndices(interval, parseInt(limit), endTime);

    // Historical service now applies multipliers internally, so we don't apply them again
    const multiplier = 1;
    const indexKey = index.toLowerCase().replace('.', '.');

    const candles = data.map(d => ({
      time: d.time,
      open: (d[indexKey]?.open || 0) * multiplier,
      high: (d[indexKey]?.high || 0) * multiplier,
      low: (d[indexKey]?.low || 0) * multiplier,
      close: (d[indexKey]?.close || 0) * multiplier,
    }));

    res.json({ candles, count: candles.length });
  } catch (error) {
    console.error('[MarketCap] Historical error:', error.message);
    res.status(500).json({ error: 'Failed to calculate historical data' });
  }
});

// SSE Streaming endpoint for progressive loading
app.get('/api/marketcap/historical-stream', async (req, res) => {
  const { interval = '1h', limit = 500, index = 'TOTAL' } = req.query;

  try {
    const { getHistoricalMarketCapService } = await import('./services/historical-marketcap-service.js');
    const service = getHistoricalMarketCapService();

    await service.streamHistoricalIndices(res, interval, parseInt(limit), index.toUpperCase());
  } catch (error) {
    console.error('[MarketCap] Stream error:', error.message);
    res.status(500).json({ error: 'Failed to stream historical data' });
  }
});

// 404 handler - MUST be after all routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start HTTP server (replaces app.listen)
httpServer.listen(PORT, async () => {
  console.log(`🚀 Alerta Chart Backend running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌍 CORS enabled for: ${allowedOrigins.join(', ')}`);
  console.log(`🔍 Node.js version: ${process.version}`);
  console.log(`🔍 Process PID: ${process.pid}`);

  // Initialize databases
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🗄️  Initializing databases...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    console.log('🔍 Starting database initialization...');
    console.log('🔍 DATABASE_URL exists:', !!process.env.DATABASE_URL);
    console.log('🔍 DATABASE_URL length:', process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 0);

    await initPushDatabase();
    console.log('✅ Push database initialized');

    await initAuthDatabase();
    console.log('✅ Auth database initialized');

    console.log('✅ All databases initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize databases:', error);
    console.error('❌ Error name:', error.name);
    console.error('❌ Error message:', error.message);
    console.error('❌ Error stack:', error.stack);
    process.exit(1);
  }

  // Start Binance Relay Service
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔌 Starting Binance WebSocket Relay...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  binanceRelay.start();

  // Start Market Cap Index Service (after binance relay has data)
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Starting Market Cap Index Service...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  marketCapService.start();

  // Start auto price alert service
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔔 Starting Alert Services...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const autoPriceService = getAutoPriceAlertService();
  autoPriceService.start();

  const percentageService = getPercentageAlertService();
  percentageService.start();

  const volumeService = getVolumeAlertService();
  volumeService.start();

  const scheduledSummaryService = getScheduledSummaryService();
  scheduledSummaryService.start();

  const fundingOIService = getFundingOIAlertService();
  fundingOIService.start();

  console.log('');
  console.log('✅ All services running!');
  console.log('🔌 WebSocket Relay available at ws://localhost:' + PORT);
});

