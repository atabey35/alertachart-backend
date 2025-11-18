# 🔔 Push Notifications - Kurulum Rehberi

## ✅ Backend Hazır!

Backend başarıyla test edildi ve çalışıyor:
- ✅ Port 3002'de aktif
- ✅ Database bağlantısı OK
- ✅ Push notification API'leri çalışıyor
- ✅ Device registration test edildi
- ✅ Price alerts test edildi

## 📡 API Endpoints

### Base URL
```
Development: http://localhost:3002/api
Production: https://your-backend-url.com/api
```

### Endpoints

#### 1. Device Registration
```bash
POST /push/register
Content-Type: application/json

{
  "deviceId": "unique-device-id",
  "expoPushToken": "ExponentPushToken[xxxxx]",
  "platform": "ios" | "android",
  "appVersion": "1.0.0"
}
```

#### 2. Test Push
```bash
POST /push/test
Content-Type: application/json

{
  "deviceId": "unique-device-id"
}
```

#### 3. Create Price Alert
```bash
POST /alerts/price
Content-Type: application/json

{
  "deviceId": "unique-device-id",
  "symbol": "BTCUSDT",
  "targetPrice": 106000,
  "proximityDelta": 500,
  "direction": "up" | "down"
}
```

#### 4. Get Price Alerts
```bash
GET /alerts/price?deviceId=unique-device-id
```

#### 5. Alarm Notification (Web'den çağrılır)
```bash
POST /alarms/notify
Content-Type: application/json

{
  "alarmKey": "alarm-123",
  "symbol": "BTCUSDT",
  "message": "BTC 106,000$ seviyesine ulaştı!"
}
```

## 🚀 Backend Başlatma

### Development
```bash
cd alertachart-backend
npm run dev
```

### Production
```bash
npm start
```

## 📱 Mobil Uygulama Entegrasyonu

Mobil uygulama `alertachart/mobile/` klasöründe hazır:

1. **Expo Setup:**
```bash
cd ../alertachart/mobile
eas login
eas build:configure
```

2. **Backend URL Güncelle:**
`mobile/src/services/api.ts`:
```typescript
const API_BASE_URL = __DEV__ 
  ? 'http://YOUR_IP:3002/api'  // Local IP
  : 'https://your-backend.com/api';
```

3. **Başlat:**
```bash
npm start
# QR kod ile Expo Go'dan tara
```

## 🧪 Test Komutları

### 1. Health Check
```bash
curl http://localhost:3002/health
```

### 2. Device Registration
```bash
curl -X POST http://localhost:3002/api/push/register \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-123",
    "expoPushToken": "ExponentPushToken[test]",
    "platform": "ios",
    "appVersion": "1.0.0"
  }'
```

### 3. Price Alert
```bash
curl -X POST http://localhost:3002/api/alerts/price \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-123",
    "symbol": "BTCUSDT",
    "targetPrice": 106000,
    "proximityDelta": 500,
    "direction": "up"
  }'
```

### 4. Test Push
```bash
curl -X POST http://localhost:3002/api/push/test \
  -H "Content-Type: application/json" \
  -d '{"deviceId": "test-123"}'
```

## 🗄️ Database

### Tables Created (Automatically)
- `devices` - Registered devices
- `price_alerts` - Price proximity alerts
- `alarm_subscriptions` - Alarm subscriptions

### Connection
Neon PostgreSQL bağlantısı `.env` dosyasında:
```
DATABASE_URL=postgresql://...
```

## 📊 Durum Raporu

```
✅ Backend çalışıyor: http://localhost:3002
✅ Database bağlı: Neon PostgreSQL
✅ API Endpoints: 8 endpoint hazır
✅ Test edildi: Device reg, alerts
⏳ Mobil app: Kurulumu bekliyor
⏳ Fiyat servisi: Eklenmesi gerekiyor
```

## 🔧 Sonraki Adımlar

1. ✅ Backend hazır
2. 📱 Mobil uygulamayı başlat (`cd ../alertachart/mobile && npm start`)
3. 🧪 Test push gönder
4. 🎯 Fiyat yaklaşma servisini ekle (opsiyonel)
5. 🌐 Production'a deploy et

## 📝 Notlar

- Backend port: **3002**
- Frontend port: **3000**
- Database: Neon PostgreSQL
- Push: Expo Server SDK

## 🆘 Sorun Giderme

### Backend başlamıyor
```bash
# Port kontrolü
lsof -i :3002

# Logları kontrol et
node src/index.js
```

### Database bağlanamıyor
- `.env` dosyasında `DATABASE_URL` kontrol edin
- Neon Console'da database aktif mi kontrol edin

### Push gelmiyor
- Device ID doğru kaydedilmiş mi kontrol edin
- Mobil cihazda notification izni verilmiş mi kontrol edin
- Expo push token geçerli mi kontrol edin

---

**Backend tamamen hazır! 🎉**
Mobil uygulamayı başlatmaya hazırsınız!
