/**
 * Exchange Service
 * Handles pagination and data fetching from exchanges
 */

import fetch from 'node-fetch';

/**
 * Fetch with timeout and retry
 */
async function fetchWithRetry(url, maxRetries = 2, timeoutMs = 10000) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      
      return response;
    } catch (error) {
      if (i === maxRetries) throw error;
      
      console.warn(`[Fetch Retry] Attempt ${i + 1} failed, retrying...`);
      await sleep(1000 * (i + 1)); // Exponential backoff
    }
  }
}

/**
 * Convert timeframe seconds to Binance interval
 */
function timeframeToInterval(timeframe) {
  const minutes = timeframe / 60;
  if (minutes === 1) return '1m';
  if (minutes === 5) return '5m';
  if (minutes === 15) return '15m';
  if (minutes === 60) return '1h';
  if (minutes === 240) return '4h';
  if (minutes === 1440) return '1d';
  return '5m';
}

/**
 * Fetch Binance candles with pagination
 */
export async function fetchBinanceCandles(pair, from, to, timeframe, maxLimit = 5000) {
  const interval = timeframeToInterval(timeframe);
  const symbol = pair.toUpperCase();
  const allCandles = [];
  
  let currentFrom = from;
  const LIMIT_PER_REQUEST = 1000; // Binance max

  console.log(`[Binance Spot] Fetching ${symbol} ${interval} with pagination...`);

  // Pagination loop
  while (currentFrom < to && allCandles.length < maxLimit) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${currentFrom}&endTime=${to}&limit=${LIMIT_PER_REQUEST}`;
    
    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error(`[Binance] HTTP ${response.status}: ${await response.text()}`);
        break;
      }

      const klines = await response.json();
      
      if (!klines || klines.length === 0) {
        break; // No more data
      }

      // Convert to standard format
      const candles = klines.map(k => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));

      allCandles.push(...candles);

      // Update currentFrom to last candle time + 1ms
      currentFrom = candles[candles.length - 1].time + 1;

      console.log(`[Binance] Fetched ${candles.length} candles, total: ${allCandles.length}`);

      // If we got less than limit, we've reached the end
      if (klines.length < LIMIT_PER_REQUEST) {
        break;
      }

      // Rate limiting (be nice to Binance)
      await sleep(100);

    } catch (error) {
      console.error(`[Binance] Error:`, error.message);
      break;
    }
  }

  console.log(`[Binance Spot] Total fetched: ${allCandles.length} candles`);
  return allCandles;
}

/**
 * Fetch Binance Futures candles with pagination
 */
export async function fetchBinanceFuturesCandles(pair, from, to, timeframe, maxLimit = 5000) {
  const interval = timeframeToInterval(timeframe);
  const symbol = pair.toUpperCase();
  const allCandles = [];
  
  let currentFrom = from;
  const LIMIT_PER_REQUEST = 1000; // Binance Futures max

  console.log(`[Binance Futures] Fetching ${symbol} ${interval} with pagination...`);

  // Pagination loop
  while (currentFrom < to && allCandles.length < maxLimit) {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${currentFrom}&endTime=${to}&limit=${LIMIT_PER_REQUEST}`;
    
    try {
      const response = await fetchWithRetry(url, 2, 15000); // 15s timeout, 2 retries
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Binance Futures] HTTP ${response.status}: ${errorText}`);
        
        // If rate limited, wait longer and continue
        if (response.status === 418 || response.status === 429) {
          console.warn(`[Binance Futures] Rate limited, waiting 5s...`);
          await sleep(5000);
          continue; // Try again
        }
        break;
      }

      const klines = await response.json();
      
      if (!klines || klines.length === 0) {
        break; // No more data
      }

      // Convert to standard format (same as spot)
      const candles = klines.map(k => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));

      allCandles.push(...candles);

      // Update currentFrom to last candle time + 1ms
      currentFrom = candles[candles.length - 1].time + 1;

      console.log(`[Binance Futures] Fetched ${candles.length} candles, total: ${allCandles.length}`);

      // If we got less than limit, we've reached the end
      if (klines.length < LIMIT_PER_REQUEST) {
        break;
      }

      // Rate limiting (be nice to Binance)
      await sleep(100);

    } catch (error) {
      console.error(`[Binance Futures] Error:`, error.message);
      break;
    }
  }

  console.log(`[Binance Futures] Total fetched: ${allCandles.length} candles`);
  return allCandles;
}

/**
 * Fetch Bybit candles with pagination
 */
export async function fetchBybitCandles(pair, from, to, timeframe, maxLimit = 5000) {
  const interval = timeframeToInterval(timeframe);
  const symbol = pair.toUpperCase();
  const allCandles = [];
  
  let currentFrom = from;
  const LIMIT_PER_REQUEST = 200; // Bybit max per request

  console.log(`[Bybit] Fetching ${symbol} ${interval} with pagination...`);

  while (currentFrom < to && allCandles.length < maxLimit) {
    const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${interval}&start=${currentFrom}&end=${to}&limit=${LIMIT_PER_REQUEST}`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();

      if (!data.result || !data.result.list || data.result.list.length === 0) {
        break;
      }

      const candles = data.result.list.map(k => ({
        time: parseInt(k[0]),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      })).reverse(); // Bybit returns newest first

      allCandles.push(...candles);
      currentFrom = candles[candles.length - 1].time + 1;

      console.log(`[Bybit] Fetched ${candles.length} candles, total: ${allCandles.length}`);

      if (data.result.list.length < LIMIT_PER_REQUEST) {
        break;
      }

      await sleep(100);

    } catch (error) {
      console.error(`[Bybit] Error:`, error.message);
      break;
    }
  }

  console.log(`[Bybit] Total fetched: ${allCandles.length} candles`);
  return allCandles;
}

/**
 * Fetch OKX candles with pagination
 */
export async function fetchOKXCandles(pair, from, to, timeframe, maxLimit = 5000) {
  const interval = timeframeToInterval(timeframe);
  const symbol = pair.replace(/([A-Z]+)(USDT|USD)$/i, '$1-$2').toUpperCase();
  const allCandles = [];
  
  let currentAfter = from;
  const LIMIT_PER_REQUEST = 100; // OKX max is 100

  console.log(`[OKX] Fetching ${symbol} ${interval} with pagination...`);

  while (currentAfter < to && allCandles.length < maxLimit) {
    const url = `https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=${interval}&after=${currentAfter}&before=${to}&limit=${LIMIT_PER_REQUEST}`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();

      if (!data.data || data.data.length === 0) {
        break;
      }

      const candles = data.data.map(k => ({
        time: parseInt(k[0]),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      })).reverse();

      allCandles.push(...candles);
      currentAfter = candles[candles.length - 1].time + 1;

      console.log(`[OKX] Fetched ${candles.length} candles, total: ${allCandles.length}`);

      if (data.data.length < LIMIT_PER_REQUEST) {
        break;
      }

      await sleep(150); // OKX is more strict

    } catch (error) {
      console.error(`[OKX] Error:`, error.message);
      break;
    }
  }

  console.log(`[OKX] Total fetched: ${allCandles.length} candles`);
  return allCandles;
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

