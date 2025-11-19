# Binance Stream API Açıklaması

## 🔴 Mevcut Sistem (Tek Symbol Per Connection)

### Şu Anki Kod:
```javascript
// auto-price-alerts.js
connectToSymbol(symbol) {
  const wsUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`;
  const ws = new WebSocket(wsUrl);
  // Her coin için AYRI bağlantı
}
```

### Örnek:
- BTCUSDT → 1 WebSocket bağlantısı
- ETHUSDT → 1 WebSocket bağlantısı
- SOLUSDT → 1 WebSocket bağlantısı
- BNBUSDT → 1 WebSocket bağlantısı

**Toplam: 4 coin = 4 WebSocket bağlantısı**

---

## 🟢 Binance Stream API (Multiple Symbols Per Connection)

### Yeni Yapı:
Binance, tek bir WebSocket bağlantısında **birden fazla symbol'ü** dinlemenize izin verir.

### URL Format:
```
wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@ticker/solusdt@ticker/bnbusdt@ticker
```

### Örnek:
- BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT → **1 WebSocket bağlantısı**

**Toplam: 4 coin = 1 WebSocket bağlantısı** ✅

---

## 📊 Karşılaştırma

### Senaryo: 50 Farklı Coin

#### Mevcut Sistem:
```
50 coin = 50 WebSocket bağlantısı
Memory: ~100KB
Binance Limit: ~200 bağlantı
```

#### Stream API ile:
```
50 coin = 5 WebSocket bağlantısı (10 coin per stream)
Memory: ~10KB
Binance Limit: ~200 bağlantı (çok daha güvenli)
```

**Kazanç:**
- ✅ **%90 bağlantı azalması** (50 → 5)
- ✅ **%90 memory azalması** (100KB → 10KB)
- ✅ **Limit sorunu çözülür** (200 limit'e çok uzak)

---

## 🔧 Implementasyon

### Mevcut Kod (Tek Symbol):
```javascript
connectToSymbol(symbol) {
  if (this.wsConnections.has(symbol)) return;
  
  const wsUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`;
  const ws = new WebSocket(wsUrl);
  
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const price = parseFloat(message.c);
    this.checkPriceLevel(symbol, price);
  });
  
  this.wsConnections.set(symbol, ws);
}
```

### Stream API ile (Multiple Symbols):
```javascript
connectToSymbols(symbols) {
  // Her 10 coin için bir stream oluştur
  const STREAMS_PER_CONNECTION = 10;
  const streamGroups = [];
  
  for (let i = 0; i < symbols.length; i += STREAMS_PER_CONNECTION) {
    streamGroups.push(symbols.slice(i, i + STREAMS_PER_CONNECTION));
  }
  
  streamGroups.forEach((group, index) => {
    const streamKey = `stream_${index}`;
    if (this.wsConnections.has(streamKey)) return;
    
    // Stream URL oluştur: btcusdt@ticker/ethusdt@ticker/...
    const streams = group.map(s => `${s.toLowerCase()}@ticker`).join('/');
    const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;
    
    const ws = new WebSocket(wsUrl);
    
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      
      // Stream API format: { stream: "btcusdt@ticker", data: {...} }
      if (message.stream && message.data) {
        const symbol = message.stream.split('@')[0].toUpperCase();
        const price = parseFloat(message.data.c);
        this.checkPriceLevel(symbol, price);
      }
    });
    
    this.wsConnections.set(streamKey, ws);
  });
}
```

---

## 📝 Stream API Mesaj Formatı

### Tek Symbol API (Mevcut):
```json
{
  "e": "24hrTicker",
  "E": 123456789,
  "s": "BTCUSDT",
  "c": "50000.00",
  "P": "5.00",
  ...
}
```

### Stream API (Yeni):
```json
{
  "stream": "btcusdt@ticker",
  "data": {
    "e": "24hrTicker",
    "E": 123456789,
    "s": "BTCUSDT",
    "c": "50000.00",
    "P": "5.00",
    ...
  }
}
```

**Fark:** Stream API'de mesaj `data` objesi içinde gelir ve `stream` field'ı hangi symbol olduğunu gösterir.

---

## 🚀 Avantajlar

### 1. Bağlantı Sayısı
- ✅ **50 coin → 5 bağlantı** (10 coin per stream)
- ✅ **100 coin → 10 bağlantı**
- ✅ **200 coin → 20 bağlantı** (hala limit'in altında)

### 2. Memory Kullanımı
- ✅ **%90 azalma** (daha az WebSocket objesi)

### 3. CPU Kullanımı
- ✅ **Aynı** (sadece message parsing farklı)

### 4. Binance Limit
- ✅ **Çok daha güvenli** (limit'e uzak)

---

## ⚠️ Dezavantajlar

### 1. Kod Karmaşıklığı
- ⚠️ **Biraz daha karmaşık** (stream grouping logic)

### 2. Error Handling
- ⚠️ **Bir stream'de hata olursa**, o stream'deki tüm coin'ler etkilenir
- ✅ **Çözüm:** Her stream'i ayrı try-catch ile handle et

### 3. Reconnection
- ⚠️ **Bir stream disconnect olursa**, o stream'deki tüm coin'ler yeniden bağlanmalı
- ✅ **Çözüm:** Stream bazlı reconnection logic

---

## 💡 Önerilen Strateji

### Phase 1: Mevcut Sistem (50 coin'e kadar)
- ✅ Tek symbol per connection
- ✅ Basit ve çalışıyor
- ✅ Limit sorunu yok

### Phase 2: Stream API (100+ coin)
- ✅ 10 coin per stream
- ✅ Bağlantı sayısını %90 azalt
- ✅ Limit sorununu çöz

---

## 📊 Örnek Senaryo

### 50 Coin, Mevcut Sistem:
```
50 WebSocket bağlantısı
Memory: ~100KB
Binance Limit: 200 (güvenli)
```

### 50 Coin, Stream API:
```
5 WebSocket bağlantısı (10 coin per stream)
Memory: ~10KB
Binance Limit: 200 (çok güvenli)
```

**Kazanç:** %90 bağlantı azalması, %90 memory azalması

---

## ✅ Sonuç

**Stream API nedir?**
- Binance'in tek bir WebSocket bağlantısında **birden fazla symbol'ü** dinlemenize izin veren özelliği
- URL format: `wss://stream.binance.com:9443/stream?streams=symbol1@ticker/symbol2@ticker/...`
- Mesaj format: `{ stream: "symbol@ticker", data: {...} }`

**Ne zaman kullanılmalı?**
- 50+ coin için önerilir
- Binance limit sorununu çözer
- Memory ve bağlantı sayısını azaltır

**Mevcut sistem yeterli mi?**
- ✅ 50 coin'e kadar: Evet, mevcut sistem yeterli
- ⚠️ 100+ coin: Stream API'ye geçilmeli

