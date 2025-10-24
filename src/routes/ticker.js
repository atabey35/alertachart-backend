/**
 * Ticker Routes for 24h price statistics
 * Provides cached ticker data to reduce frontend rate limits
 */

import express from 'express';
import NodeCache from 'node-cache';

const router = express.Router();

// Cache ticker data for 5 seconds to prevent rate limiting
const tickerCache = new NodeCache({ stdTTL: 5 });

/**
 * Fetch 24h ticker data from Binance
 */
async function fetchBinanceTicker(symbols, marketType = 'spot') {
  const baseUrl = marketType === 'futures' 
    ? 'https://fapi.binance.com/fapi/v1/ticker/24hr'
    : 'https://api.binance.com/api/v3/ticker/24hr';
  
  const symbolsArray = Array.isArray(symbols) ? symbols : [symbols];
  const symbolsParam = JSON.stringify(symbolsArray.map(s => s.toUpperCase()));
  
  const url = `${baseUrl}?symbols=${symbolsParam}`;
  
  console.log(`[Ticker API] Fetching ${marketType} ticker for ${symbolsArray.length} symbols`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    if (response.status === 418) {
      throw new Error('Binance rate limit (418)');
    }
    throw new Error(`Binance API error: ${response.status}`);
  }
  
  return await response.json();
}

/**
 * GET /api/ticker/:marketType
 * Query params:
 *   - symbols: comma-separated list of symbols (e.g., "btcusdt,ethusdt")
 */
router.get('/:marketType', async (req, res) => {
  try {
    const { marketType } = req.params;
    const { symbols } = req.query;

    // Validate params
    if (!symbols) {
      return res.status(400).json({ 
        error: 'Missing required query param: symbols' 
      });
    }

    if (!['spot', 'futures'].includes(marketType)) {
      return res.status(400).json({ 
        error: 'Invalid market type. Must be "spot" or "futures"' 
      });
    }

    // Parse symbols
    const symbolsArray = symbols.split(',').map(s => s.trim().toLowerCase());
    
    // Create cache key
    const cacheKey = `${marketType}-${symbolsArray.sort().join(',')}`;
    
    // Check cache
    const cachedData = tickerCache.get(cacheKey);
    if (cachedData) {
      console.log(`[Ticker API] Cache hit for ${symbolsArray.length} symbols`);
      return res.json({
        cached: true,
        data: cachedData,
      });
    }

    // Fetch from Binance
    const tickerData = await fetchBinanceTicker(symbolsArray, marketType);
    
    // Cache the result
    tickerCache.set(cacheKey, tickerData);
    
    res.json({
      cached: false,
      data: tickerData,
    });

  } catch (error) {
    console.error('[Ticker Route Error]', error);
    
    // If rate limited, try to return stale cache
    const cacheKey = `${req.params.marketType}-${req.query.symbols.split(',').sort().join(',')}`;
    const staleCache = tickerCache.get(cacheKey);
    
    if (staleCache) {
      console.log('[Ticker API] Returning stale cache due to error');
      return res.json({
        cached: true,
        stale: true,
        data: staleCache,
      });
    }
    
    res.status(500).json({ 
      error: error.message,
      timestamp: Date.now()
    });
  }
});

export default router;

