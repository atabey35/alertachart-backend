# 🚂 Railway Deployment Guide

This guide will help you deploy the Alerta Chart Backend to Railway in under 5 minutes.

## Prerequisites

- GitHub account
- Railway account (sign up at https://railway.app)
- Vercel deployment URL (for CORS configuration)

## Deployment Steps

### Option 1: Deploy via GitHub (Recommended)

1. **Push to GitHub**
   ```bash
   cd alerta-chart-backend
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

2. **Deploy to Railway**
   - Go to https://railway.app
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your `alerta-chart-backend` repository
   - Railway will automatically detect Node.js and deploy

3. **Configure Environment Variables**
   - In Railway dashboard, go to your project
   - Click on "Variables" tab
   - Add the following:
     ```
     ALLOWED_ORIGINS=https://your-vercel-app.vercel.app,http://localhost:3000
     NODE_ENV=production
     ```

4. **Get Your Railway URL**
   - In Railway dashboard, click "Settings"
   - Click "Generate Domain"
   - Copy the URL (e.g., `https://your-app.railway.app`)

### Option 2: Deploy via Railway CLI

1. **Install Railway CLI**
   ```bash
   npm install -g @railway/cli
   ```

2. **Login**
   ```bash
   railway login
   ```

3. **Initialize Project**
   ```bash
   cd alerta-chart-backend
   railway init
   ```

4. **Deploy**
   ```bash
   railway up
   ```

5. **Set Environment Variables**
   ```bash
   railway variables set ALLOWED_ORIGINS="https://your-vercel-app.vercel.app"
   railway variables set NODE_ENV="production"
   ```

6. **Generate Domain**
   ```bash
   railway domain
   ```

## Update Frontend

After deployment, update your Alerta Chart frontend:

1. **Create `.env.local` in `alerta-chart/`**
   ```env
   NEXT_PUBLIC_RAILWAY_API=https://your-railway-app.railway.app
   NEXT_PUBLIC_LOCAL_API=http://localhost:4000
   ```

2. **Rebuild and Deploy**
   ```bash
   cd alerta-chart
   npm run build
   vercel --prod
   ```

## Test the Integration

```bash
# Test Railway backend
curl "https://your-railway-app.railway.app/health"

# Test historical data
curl "https://your-railway-app.railway.app/api/historical/BINANCE/btcusdt/60?from=1700000000000&to=1700086400000&limit=2000"
```

## Monitoring

### Railway Dashboard
- View logs: Railway Dashboard → Your Project → Deployments → View Logs
- Metrics: Railway Dashboard → Your Project → Metrics
- Usage: Railway Dashboard → Your Project → Usage

### Common Issues

**CORS Errors**
- Make sure `ALLOWED_ORIGINS` includes your Vercel URL
- Check Railway logs for CORS-related errors

**503 Service Unavailable**
- Railway may be cold starting (takes 5-10 seconds)
- Check Railway logs for startup errors

**Rate Limiting**
- Binance: Max 1200 requests/min
- Bybit: Max 120 requests/min
- OKX: Max 20 requests/sec

## Scaling

Railway automatically scales based on usage:
- **Free Tier**: 500 hours/month
- **Pro Plan**: $5/month + usage

### Optimize Costs

1. **Add Redis Cache** (optional)
   ```bash
   railway add redis
   ```

2. **Update `exchangeService.js`** to cache responses

3. **Enable Gzip Compression**
   ```javascript
   import compression from 'compression';
   app.use(compression());
   ```

## Database Integration (Optional)

For persistent caching:

1. **Add PostgreSQL**
   ```bash
   railway add postgresql
   ```

2. **Install Prisma**
   ```bash
   npm install @prisma/client
   npm install -D prisma
   ```

3. **Initialize Prisma**
   ```bash
   npx prisma init
   ```

## Support

- Railway Docs: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- Alerta Chart Issues: Your GitHub Issues URL

## License

MIT

