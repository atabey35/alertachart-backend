# Alerta Chart Backend

Historical data API for Alerta Chart with **unlimited pagination** support.

## Features

✅ **Pagination**: Fetch unlimited historical candles  
✅ **Multi-Exchange**: Binance, Bybit, OKX support  
✅ **Rate Limiting**: Smart delays to avoid API bans  
✅ **CORS**: Configured for Vercel + Railway  
✅ **Railway Ready**: Deploy with one click

## API Endpoints

### GET `/api/historical/:exchange/:pair/:timeframe`

**Parameters:**
- `exchange`: BINANCE | BYBIT | OKX
- `pair`: Trading pair (e.g., btcusdt)
- `timeframe`: Timeframe in seconds (60, 300, 900, 3600, 14400, 86400)

**Query Params:**
- `from`: Start timestamp (milliseconds)
- `to`: End timestamp (milliseconds)
- `limit`: Max candles (optional, default 1000, max 5000)

**Example:**
```bash
GET /api/historical/BINANCE/btcusdt/300?from=1700000000000&to=1700086400000&limit=2000
```

**Response:**
```json
{
  "exchange": "BINANCE",
  "pair": "btcusdt",
  "timeframe": 300,
  "from": 1700000000000,
  "to": 1700086400000,
  "count": 2000,
  "data": [
    {
      "time": 1700000000000,
      "open": 42000.5,
      "high": 42100.2,
      "low": 41900.1,
      "close": 42050.3,
      "volume": 123.45
    },
    ...
  ]
}
```

## Deploy to Railway

### 1. Install Railway CLI
```bash
npm install -g @railway/cli
```

### 2. Login
```bash
railway login
```

### 3. Deploy
```bash
cd alerta-chart-backend
railway init
railway up
```

### 4. Set Environment Variables
```bash
railway variables set ALLOWED_ORIGINS="https://your-vercel-app.vercel.app,http://localhost:3000"
```

### 5. Get Your Railway URL
```bash
railway domain
```

## Local Development

```bash
cd alerta-chart-backend
npm install
cp .env.example .env
npm run dev
```

Server runs on `http://localhost:3002`

## How It Works

### Pagination Strategy

1. **First Request**: Fetch 1000 candles from exchange
2. **Check Response**: If 1000 candles returned, there's likely more
3. **Next Request**: Start from last candle timestamp + 1ms
4. **Repeat**: Until we have all data or hit `maxLimit`

### Rate Limiting

- **Binance**: 100ms delay between requests
- **Bybit**: 100ms delay between requests
- **OKX**: 150ms delay between requests (more strict)

### Example: Fetching 5000 Candles

For 1-minute timeframe, 5000 candles = ~3.5 days of data

```
Request 1: 1000 candles (Day 1)
Request 2: 1000 candles (Day 2)
Request 3: 1000 candles (Day 3)
Request 4: 1000 candles (Day 3.5)
Request 5: 1000 candles (remaining)
Total: 5000 candles in ~0.5 seconds
```

## Integration with Frontend

Update your frontend to use Railway backend for historical data:

```typescript
// In your Chart component
const RAILWAY_API = 'https://your-app.railway.app';

const fetchHistoricalData = async (exchange, pair, timeframe, from, to) => {
  const response = await fetch(
    `${RAILWAY_API}/api/historical/${exchange}/${pair}/${timeframe}?from=${from}&to=${to}&limit=5000`
  );
  return response.json();
};
```

## Environment Variables

- `PORT`: Server port (default: 3002)
- `NODE_ENV`: Environment (production/development)
- `ALLOWED_ORIGINS`: CORS allowed origins (comma-separated)

## License

MIT



## 🔗 Related Links

- **Frontend Repository**: https://github.com/atabey35/alertachart
- **Backend Repository**: https://github.com/atabey35/alertachart-backend
- **Integration Guide**: See DEPLOY.md

---

**Built with ❤️ by Atabey**
