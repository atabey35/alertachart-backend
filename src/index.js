/**
 * Alerta Chart Backend - Railway Deployment
 * Historical data API with pagination support
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import historicalRouter from './routes/historical.js';
import tickerRouter from './routes/ticker.js';
import pushRouter from './routes/push.js';
import alertsRouter from './routes/alerts.js';
import alarmsRouter from './routes/alarms.js';
import adminRouter from './routes/admin.js';
import { getAutoPriceAlertService } from './lib/push/auto-price-alerts.js';

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
    
    if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

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

app.listen(PORT, () => {
  console.log(`🚀 Alerta Chart Backend running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌍 CORS enabled for: ${allowedOrigins.join(', ')}`);
  
  // Start auto price alert service
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔔 Starting Auto Price Alert Service...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const autoPriceService = getAutoPriceAlertService();
  autoPriceService.start();
  
  console.log('');
  console.log('✅ All services running!');
});

