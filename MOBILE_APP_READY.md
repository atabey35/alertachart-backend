# 📱 Mobil Uygulama Hazır!

## ✅ Çalışan Servisler

```
✅ Backend:  http://localhost:3002
✅ Mobile:   http://localhost:8081  
✅ Database: Neon PostgreSQL
```

## 🎯 Şu An Yapılacaklar

### 1. QR Kodu Tarayın
Terminal'de görünen QR kodu telefonunuzla tarayın:
- **iOS**: Camera app ile direkt tarayın
- **Android**: Expo Go uygulamasından tarayın

### 2. Expo Go İndirin
Henüz yoksa App Store/Play Store'dan indirin

### 3. Uygulama Açılınca
- Push notification izni verin
- WebView yüklenecek
- https://alerta.kriptokirmizi.com görünecek

## 🧪 Test Push Notification

Uygulama açıldıktan sonra console'da device ID göreceksiniz.
Sonra test push gönderin:

```bash
curl -X POST http://localhost:3002/api/push/test \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"BURAYA_DEVICE_ID"}'
```

## 🔧 Sorun Giderme

### "Project is incompatible" Hatası
```bash
# iOS Simulator kullanın (Mac gerekli)
cd /Users/ata/Desktop/alertachart/mobile
npm run ios

# VEYA Expo Go'yu güncelleyin
```

### Terminal'de QR Görmüyorsanız
```bash
cd /Users/ata/Desktop/alertachart/mobile
npm start
```

### Backend Çalışmıyorsa
```bash
cd /Users/ata/Desktop/alertachart-backend
node src/index.js
```

## 📚 Detaylı Dokümantasyon

- **Backend Setup**: `PUSH_NOTIFICATIONS_SETUP.md`
- **Mobile App**: `../alertachart/mobile/README.md`
- **API Docs**: `../alertachart/PUSH_NOTIFICATIONS.md`

## 🎉 Başarılı Test

Şunları gördüyseniz başarılı:
1. ✅ Uygulama WebView'da açıldı
2. ✅ Push izni verildi
3. ✅ Console'da device ID görünüyor
4. ✅ Test push bildirimi geldi

---

**Her şey hazır! QR kodu tarayarak başlayın! 🚀**
