/**
 * Historical Data Routes
 * Supports pagination for unlimited candle fetching
 */

import express from 'express';
import { fetchBinanceCandles, fetchBinanceFuturesCandles, fetchBybitCandles, fetchOKXCandles } from '../services/exchangeService.js';

const router = express.Router();

/**
 * GET /api/historical/:exchange/:pair/:timeframe
 * Query params:
 *   - from: timestamp (ms)
 *   - to: timestamp (ms)
 *   - limit: max candles (optional, default 1000)
 */
router.get('/:exchange/:pair/:timeframe', async (req, res) => {
  try {
    const { exchange, pair, timeframe } = req.params;
    const { from, to, limit = 1000 } = req.query;

    // Validate params
    if (!from || !to) {
      return res.status(400).json({ 
        error: 'Missing required query params: from, to' 
      });
    }

    const fromTs = parseInt(from);
    const toTs = parseInt(to);
    const limitNum = parseInt(limit);
    const timeframeSeconds = parseInt(timeframe);

    console.log(`[API] Fetching ${exchange} ${pair} ${timeframeSeconds}s from ${new Date(fromTs).toISOString()} to ${new Date(toTs).toISOString()}`);

    let candles = [];

    // Fetch from appropriate exchange
    switch (exchange.toUpperCase()) {
      case 'BINANCE':
        candles = await fetchBinanceCandles(pair, fromTs, toTs, timeframeSeconds, limitNum);
        break;
      
      case 'BINANCE_FUTURES':
        candles = await fetchBinanceFuturesCandles(pair, fromTs, toTs, timeframeSeconds, limitNum);
        break;
      
      case 'BYBIT':
        candles = await fetchBybitCandles(pair, fromTs, toTs, timeframeSeconds, limitNum);
        break;
      
      case 'OKX':
        candles = await fetchOKXCandles(pair, fromTs, toTs, timeframeSeconds, limitNum);
        break;
      
      default:
        return res.status(400).json({ 
          error: `Unsupported exchange: ${exchange}` 
        });
    }

    res.json({
      exchange,
      pair,
      timeframe: timeframeSeconds,
      from: fromTs,
      to: toTs,
      count: candles.length,
      data: candles,
    });

  } catch (error) {
    console.error('[Historical Route Error]', error);
    res.status(500).json({ 
      error: error.message,
      timestamp: Date.now()
    });
  }
});

export default router;

