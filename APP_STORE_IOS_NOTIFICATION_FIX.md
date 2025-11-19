# App Store iOS Bildirim Sorunu - Çözüm

## Sorun
- ✅ APNs key Firebase Console'da yüklü
- ✅ Android'de bildirimler çalışıyor
- ❌ App Store'dan yüklenen iOS uygulamasında bildirimler çalışmıyor
- ✅ Development/TestFlight'ta çalışıyordu

## Olası Nedenler

### 1. Bundle ID Uyumsuzluğu (En Olası)

App Store build'lerinde Bundle ID kontrolü kritik öneme sahip.

**Kontrol:**
1. Firebase Console → Project Settings → General
2. iOS app'in **Bundle ID**'sini kontrol edin
3. Xcode'da **App** → **Signing & Capabilities** → **Bundle Identifier** kontrol edin
4. App Store Connect'te **App Information** → **Bundle ID** kontrol edin

**Üçü de aynı olmalı!**

### 2. Provisioning Profile Push Notifications Capability Eksik

App Store build'leri için provisioning profile'ın Push Notifications capability'si olmalı.

**Kontrol:**
1. Apple Developer Portal → **Certificates, Identifiers & Profiles**
2. **Identifiers** → iOS App ID'nizi bulun
3. **Push Notifications** capability'sinin **enabled** olduğundan emin olun
4. **Profiles** → App Store provisioning profile'ınızı kontrol edin
5. Profile'ın Push Notifications içerdiğinden emin olun

### 3. Firebase Console'da Yanlış Bundle ID

Firebase Console'daki iOS app'in Bundle ID'si App Store'daki Bundle ID ile eşleşmiyor olabilir.

**Çözüm:**
1. Firebase Console → Project Settings → General
2. iOS app'in Bundle ID'sini kontrol edin
3. Eğer yanlışsa:
   - Yeni bir iOS app ekleyin (doğru Bundle ID ile) veya
   - Mevcut app'i silip yeniden ekleyin (⚠️ Bu tüm verileri siler!)

### 4. GoogleService-Info.plist Güncel Değil

App Store build'inde eski `GoogleService-Info.plist` dosyası kullanılıyor olabilir.

**Kontrol:**
1. Xcode'da `ios/App/App/GoogleService-Info.plist` dosyasını açın
2. `BUNDLE_ID` değerinin doğru olduğundan emin olun
3. Firebase Console'dan yeni `GoogleService-Info.plist` indirip değiştirin

### 5. APNs Key Production Ortamı İçin Yapılandırılmamış

Bazı durumlarda APNs key production ortamı için ayrı yapılandırma gerektirebilir.

**Kontrol:**
1. Firebase Console → Project Settings → Cloud Messaging
2. **Apple app configuration** bölümünde:
   - APNs Authentication Key yüklü mü?
   - Key ID görünüyor mu?
   - Team ID görünüyor mu?
3. Eğer yüklüyse, **Key ID** ve **Team ID**'nin doğru olduğundan emin olun

## Adım Adım Çözüm

### Adım 1: Bundle ID Kontrolü

```bash
# Xcode'da Bundle ID'yi kontrol et
# ios/App/App.xcworkspace aç
# App → Signing & Capabilities → Bundle Identifier
```

**Kontrol Listesi:**
- [ ] Xcode Bundle Identifier: `com.kriptokirmizi.alerta` (veya ne ise)
- [ ] Firebase Console Bundle ID: Aynı olmalı
- [ ] App Store Connect Bundle ID: Aynı olmalı

### Adım 2: Firebase Console'da iOS App Kontrolü

1. [Firebase Console](https://console.firebase.google.com/) → Projeniz
2. **Project Settings** → **General** tab
3. **Your apps** bölümünde iOS app'i bulun
4. **Bundle ID**'yi kontrol edin
5. Eğer yanlışsa:
   - **⚠️ DİKKAT:** Mevcut app'i silmek tüm verileri siler!
   - Yeni iOS app ekleyin (doğru Bundle ID ile)
   - Yeni `GoogleService-Info.plist` indirin
   - Xcode'da eski dosyayı değiştirin

### Adım 3: GoogleService-Info.plist Güncelleme

1. Firebase Console → Project Settings → General
2. iOS app'in yanındaki **⚙️** ikonuna tıklayın
3. **Download GoogleService-Info.plist** butonuna tıklayın
4. İndirilen dosyayı Xcode'da `ios/App/App/GoogleService-Info.plist` ile değiştirin
5. Xcode'da **File** → **Add Files to "App"** → Yeni dosyayı seçin
6. **Copy items if needed** seçeneğini işaretleyin

### Adım 4: Provisioning Profile Kontrolü

1. [Apple Developer Portal](https://developer.apple.com/account/resources/identifiers/list)
2. **Identifiers** → iOS App ID'nizi bulun
3. **Push Notifications** capability'sinin **enabled** olduğundan emin olun
4. Eğer değilse:
   - **Edit** butonuna tıklayın
   - **Push Notifications** seçeneğini işaretleyin
   - **Save** butonuna tıklayın

### Adım 5: Yeni Build ve Test

1. Xcode'da **Product** → **Clean Build Folder** (Shift + Cmd + K)
2. Yeni bir build alın
3. App Store Connect'e yükleyin
4. TestFlight'ta test edin
5. Admin panelinden bildirim gönderin

## Hızlı Kontrol Komutları

### Bundle ID Kontrolü
```bash
# Xcode project'te Bundle ID'yi bul
grep -r "PRODUCT_BUNDLE_IDENTIFIER" ios/App/App.xcodeproj/project.pbxproj

# GoogleService-Info.plist'te Bundle ID'yi bul
grep "BUNDLE_ID" ios/App/App/GoogleService-Info.plist
```

### Firebase Console Kontrolü
1. Firebase Console → Project Settings → General
2. iOS app'in Bundle ID'sini not edin
3. Xcode'daki Bundle Identifier ile karşılaştırın

## Beklenen Sonuç

Tüm adımlar tamamlandıktan sonra:
- ✅ App Store build'inde bildirimler çalışmalı
- ✅ Backend loglarında `messaging/third-party-auth-error` hatası görünmemeli
- ✅ iOS cihazlara bildirimler başarıyla gönderilmeli

## Notlar

- ⚠️ **GoogleService-Info.plist** dosyası her Firebase projesi için özeldir
- ⚠️ Bundle ID değişirse, Firebase Console'da da güncellemeniz gerekir
- ⚠️ App Store build'leri production APNs kullanır (development değil)
- ✅ APNs key hem development hem production için çalışır (doğru yapılandırıldıysa)

## En Olası Sorun

**Bundle ID uyumsuzluğu** - Firebase Console'daki Bundle ID ile App Store'daki Bundle ID eşleşmiyor olabilir.

