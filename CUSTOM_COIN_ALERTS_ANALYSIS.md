# Özel Coin Bildirimleri - Backend Yük Analizi

## 📊 Mevcut Sistem (4 Sabit Coin)

### WebSocket Bağlantıları
- **4 WebSocket bağlantısı** (BTC, ETH, SOL, BNB)
- Her coin için: `wss://stream.binance.com:9443/ws/{symbol}@ticker`
- Memory: ~1-2KB per connection = **~8KB total**
- CPU: Minimal (sadece message parsing)

### Database Yükü
- **Her bildirimde:** `getPremiumTrialDevices()` - **1 sorgu**
- Sorgu tipi: JOIN (devices + users) + WHERE (premium/trial filter)
- Index'ler: `idx_devices_user_id`, `idx_users_plan`, `idx_users_expiry`
- **Yük:** Düşük (index'li, optimize edilmiş)

### Bildirim Gönderme
- **Tüm premium/trial kullanıcılara** gönderiliyor
- FCM batch gönderimi: Tek API call ile tüm token'lara
- **Yük:** Orta (token sayısına bağlı)

---

## 🚀 Özel Coin Bildirimleri Eklendiğinde

### Senaryo 1: 50 Farklı Coin, 100 Premium Kullanıcı

#### WebSocket Bağlantıları
- **50 WebSocket bağlantısı** (unique coin'ler)
- Memory: ~1-2KB per connection = **~100KB total**
- CPU: Minimal (sadece message parsing)
- **Binance Limit:** ~200 bağlantı (güvenli limit)
- **Yük:** ✅ **Düşük-Orta** (50 coin için yeterli)

#### Database Yükü
- **Her fiyat güncellemesinde:** `getActivePriceAlertsBySymbol(symbol)` - **1 sorgu per coin**
- Sorgu tipi: JOIN (price_alerts + devices) + WHERE (symbol + is_active)
- Index'ler: `idx_price_alerts_symbol`, `idx_price_alerts_active`
- **Saniyede sorgu sayısı:** ~50 coin × 1 update/saniye = **50 sorgu/saniye**
- **Yük:** ✅ **Orta** (index'li sorgular, optimize edilebilir)

#### Bildirim Gönderme
- **Sadece o coin için alert'i olan kullanıcılara** gönderiliyor
- FCM batch gönderimi: Tek API call ile targeted token'lara
- **Yük:** ✅ **Düşük** (daha targeted, daha az token)

---

## 📈 Senaryo 2: 100 Farklı Coin, 500 Premium Kullanıcı

#### WebSocket Bağlantıları
- **100 WebSocket bağlantısı**
- Memory: ~200KB total
- **Binance Limit:** ~200 bağlantı (limit'e yakın)
- **Yük:** ⚠️ **Orta-Yüksek** (limit'e yaklaşıyor)

#### Database Yükü
- **100 sorgu/saniye** (100 coin × 1 update/saniye)
- **Yük:** ⚠️ **Yüksek** (optimize edilmeli)

#### Bildirim Gönderme
- Targeted gönderim (daha az token)
- **Yük:** ✅ **Düşük-Orta**

---

## 🔍 Detaylı Analiz

### 1. WebSocket Bağlantı Yönetimi

**Mevcut Kod:**
```javascript
// auto-price-alerts.js
connectToSymbol(symbol) {
  if (this.wsConnections.has(symbol)) return; // ✅ Duplicate kontrolü
  const ws = new WebSocket(wsUrl);
  this.wsConnections.set(symbol, ws);
}
```

**Yük:**
- ✅ **Connection pooling:** Aynı coin için tek bağlantı
- ✅ **Memory:** Her bağlantı ~1-2KB
- ✅ **CPU:** Minimal (sadece message parsing)
- ⚠️ **Limit:** Binance ~200 bağlantı (genellikle)

**Öneri:**
- ✅ **100 coin'e kadar:** Sorun yok
- ⚠️ **100-200 coin:** Limit'e yaklaşıyor, monitoring gerekli
- ❌ **200+ coin:** Binance limit aşılabilir (alternatif strateji gerekli)

---

### 2. Database Yükü

**Mevcut Kod:**
```javascript
// db.js
getActivePriceAlertsBySymbol(symbol) {
  return sql`
    SELECT pa.*, d.expo_push_token, d.platform
    FROM price_alerts pa
    JOIN devices d ON pa.device_id = d.device_id
    WHERE pa.symbol = ${symbol}
      AND pa.is_active = true
      AND d.is_active = true
  `;
}
```

**Index'ler:**
- ✅ `idx_price_alerts_symbol` - Symbol bazlı hızlı arama
- ✅ `idx_price_alerts_active` - Active filter
- ✅ `idx_devices_device_id` - JOIN için

**Yük:**
- ✅ **50 coin:** ~50 sorgu/saniye (index'li, hızlı)
- ⚠️ **100 coin:** ~100 sorgu/saniye (optimize edilmeli)
- ❌ **200+ coin:** ~200 sorgu/saniye (çok yüksek)

**Optimizasyon Önerileri:**
1. **Batch sorgu:** Tüm aktif coin'leri tek sorguda çek
2. **Cache:** Price cache + alert cache (5-10 saniye)
3. **Connection pooling:** Database connection pool kullan

---

### 3. Bildirim Gönderme

**Mevcut Kod:**
```javascript
// unified-push.js
sendPriceAlertNotification(tokens, symbol, currentPrice, targetPrice, direction) {
  return sendPushNotifications([{
    to: tokens, // Array of tokens
    title: `${symbol} ${emoji}`,
    body: `${symbol} ${targetPrice} $ seviyesine ${actionText}!`,
  }]);
}
```

**Yük:**
- ✅ **FCM Batch:** Tek API call ile tüm token'lara
- ✅ **Targeted:** Sadece o coin için alert'i olan kullanıcılara
- ✅ **Daha az token:** Mevcut sistemden daha az (tüm premium yerine targeted)

---

## 💡 Optimizasyon Stratejileri

### 1. WebSocket Bağlantı Optimizasyonu

**Problem:** 200+ coin için Binance limit aşılabilir

**Çözüm:**
```javascript
// Binance Stream API: Multiple symbols in one connection
// wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@ticker/...

// Örnek: 50 coin'i 5 WebSocket'e böl
const streams = [
  symbols.slice(0, 10),   // 10 coin per stream
  symbols.slice(10, 20),
  // ...
];
```

**Kazanç:**
- ✅ **200 coin → 20 WebSocket** (10 coin per stream)
- ✅ **Limit sorunu çözülür**

---

### 2. Database Optimizasyonu

**Problem:** Her coin için ayrı sorgu

**Çözüm 1: Batch Sorgu**
```javascript
// Tüm aktif alert'leri tek sorguda çek
getAllActivePriceAlerts() {
  return sql`
    SELECT pa.*, d.expo_push_token, d.platform
    FROM price_alerts pa
    JOIN devices d ON pa.device_id = d.device_id
    WHERE pa.is_active = true
      AND d.is_active = true
    ORDER BY pa.symbol
  `;
}

// Memory'de group by symbol
const alertsBySymbol = new Map();
alerts.forEach(alert => {
  if (!alertsBySymbol.has(alert.symbol)) {
    alertsBySymbol.set(alert.symbol, []);
  }
  alertsBySymbol.get(alert.symbol).push(alert);
});
```

**Kazanç:**
- ✅ **100 sorgu/saniye → 1 sorgu/10 saniye**
- ✅ **%99 sorgu azalması**

**Çözüm 2: Cache**
```javascript
// 10 saniye cache
const alertCache = new Map();
const CACHE_TTL = 10 * 1000; // 10 seconds

async getActivePriceAlertsBySymbol(symbol) {
  const cached = alertCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  const data = await sql`...`;
  alertCache.set(symbol, { data, timestamp: Date.now() });
  return data;
}
```

**Kazanç:**
- ✅ **100 sorgu/saniye → 10 sorgu/saniye** (10 saniye cache)
- ✅ **%90 sorgu azalması**

---

### 3. Bildirim Optimizasyonu

**Mevcut:** Tüm premium kullanıcılara gönderiliyor
**Özel Coin:** Sadece o coin için alert'i olan kullanıcılara

**Kazanç:**
- ✅ **Daha az token:** 500 token → 50 token (örnek)
- ✅ **Daha az FCM API call**
- ✅ **Daha az maliyet**

---

## 📊 Sonuç ve Öneriler

### ✅ Backend Yükü: **DÜŞÜK-ORTA**

**Neden:**
1. **WebSocket:** 50-100 coin için yeterli (Binance limit: ~200)
2. **Database:** Index'li sorgular, optimize edilebilir
3. **Bildirim:** Targeted gönderim (daha az token)

### ⚠️ Dikkat Edilmesi Gerekenler

1. **100+ coin:** WebSocket limit'e yaklaşıyor
   - **Çözüm:** Binance Stream API (multiple symbols per connection)

2. **100+ sorgu/saniye:** Database yükü artıyor
   - **Çözüm:** Batch sorgu + Cache (10 saniye)

3. **Memory:** Alert cache için memory kullanımı
   - **Çözüm:** LRU cache (eski alert'leri temizle)

### 🚀 Önerilen Yapı

1. **WebSocket:** Binance Stream API kullan (multiple symbols)
2. **Database:** Batch sorgu + 10 saniye cache
3. **Bildirim:** Targeted gönderim (zaten optimize)

**Tahmini Yük:**
- **50 coin:** ✅ Düşük
- **100 coin:** ✅ Orta (optimize edilmiş)
- **200+ coin:** ⚠️ Yüksek (Stream API gerekli)

---

## 🔧 Implementasyon Önerisi

### Phase 1: Temel Yapı (50 coin'e kadar)
- ✅ Mevcut WebSocket yapısı yeterli
- ✅ `getActivePriceAlertsBySymbol()` kullan
- ✅ Targeted bildirim gönderimi

### Phase 2: Optimizasyon (100 coin'e kadar)
- ✅ 10 saniye cache ekle
- ✅ Batch sorgu implementasyonu
- ✅ Memory monitoring

### Phase 3: Scale (200+ coin)
- ✅ Binance Stream API (multiple symbols)
- ✅ Connection pooling
- ✅ Advanced caching

---

## 📈 Performans Metrikleri

### Mevcut Sistem (4 coin)
- WebSocket: 4 bağlantı
- Database: 1 sorgu/bildirim
- Bildirim: Tüm premium kullanıcılara

### Özel Coin (50 coin, optimize edilmiş)
- WebSocket: 50 bağlantı (veya 5 Stream API)
- Database: 1 sorgu/10 saniye (cache ile)
- Bildirim: Targeted (sadece alert'i olan kullanıcılara)

**Yük Artışı:** %200-300 (optimize edilmiş)
**Kullanıcı Deneyimi:** %1000+ (her kullanıcı kendi coin'ini ekleyebilir)

---

## ✅ Sonuç

**Backend yükü kabul edilebilir seviyede.** Optimizasyonlarla 100+ coin'e kadar scale edilebilir.

**Öneri:** Phase 1 ile başla, kullanıcı sayısına göre Phase 2-3'e geç.

