/**
 * Alerta Chart Backend - Railway Deployment
 * Historical data API with pagination support
 */

import express from 'express';
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
import { initPushDatabase } from './lib/push/db.js';
import { initAuthDatabase } from './lib/auth/db.js';

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

// Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({
    error: err.message || 'Internal server error',
    timestamp: Date.now()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
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

app.listen(PORT, async () => {
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

  console.log('');
  console.log('✅ All services running!');
});

