# Misafir Kullanıcı Alert Sorunu - Backend Çözümü

## ✅ Yapılan Değişiklikler

### 1. Alert Oluşturma Endpoint'i (`/src/routes/alerts.js` POST)

**Sorun:** Misafir kullanıcılar için cookie yok, bu yüzden `req.user` undefined oluyor ve user bulunamıyor.

**Çözüm:** 
- `userEmail` ve `deviceId` ile misafir kullanıcıyı bulma kodu eklendi
- Cookie/token yoksa, `device_id` ve `email` ile user sorgulanıyor

**Kod:**
```javascript
// 🔥 CRITICAL: For guest users, if no userId from cookie/token, try to find user by device_id and userEmail
if (!userId && userEmail && deviceId) {
  const sql = (await import('../lib/auth/db.js')).getSql();
  const guestUsers = await sql`
    SELECT id, email, plan, expiry_date, trial_started_at, trial_ended_at
    FROM users 
    WHERE email = ${userEmail} 
    AND device_id = ${deviceId}
    AND provider = 'guest'
    LIMIT 1
  `;
  
  if (guestUsers.length > 0) {
    userId = guestUsers[0].id;
  }
}
```

---

### 2. Alert Listeleme Endpoint'i (`/src/routes/alerts.js` GET)

**Sorun:** Misafir kullanıcılar için cookie yok, bu yüzden alert'ler listelenemiyor.

**Çözüm:**
- `deviceId` ile misafir kullanıcıyı bulma kodu eklendi
- Cookie/token yoksa, `device_id` ile user sorgulanıyor

**Kod:**
```javascript
// 🔥 CRITICAL: For guest users, if no userId from cookie/token, try to find user by device_id
if (!userId && deviceId) {
  const sql = (await import('../lib/auth/db.js')).getSql();
  const guestUsers = await sql`
    SELECT id, email, plan, expiry_date, trial_started_at, trial_ended_at
    FROM users 
    WHERE device_id = ${deviceId}
    AND provider = 'guest'
    LIMIT 1
  `;
  
  if (guestUsers.length > 0) {
    userId = guestUsers[0].id;
  }
}
```

---

### 3. Custom Alerts Yükleme Servisi (`/src/lib/push/db.js`)

**Sorun:** `getAllActiveCustomAlerts()` fonksiyonu sadece normal kullanıcıları destekliyordu (`d.user_id IS NOT NULL`).

**Çözüm:**
- Misafir kullanıcılar için `device_id` ile user join'i eklendi
- Hem normal kullanıcılar hem de misafir kullanıcılar destekleniyor

**Kod:**
```sql
-- Normal users: match by user_id
LEFT JOIN users u ON d.user_id = u.id AND d.user_id IS NOT NULL
-- Guest users: match by device_id
LEFT JOIN users u_guest ON d.device_id = u_guest.device_id AND u_guest.provider = 'guest' AND d.user_id IS NULL
```

**WHERE Koşulu:**
```sql
WHERE pa.is_active = true
  AND d.is_active = true
  AND (
    -- Normal users: user_id must be set
    (d.user_id IS NOT NULL AND u.id IS NOT NULL)
    OR
    -- Guest users: device_id must match
    (d.user_id IS NULL AND u_guest.id IS NOT NULL)
  )
```

---

### 4. Symbol Bazlı Alert Sorgulama (`/src/lib/push/db.js`)

**Sorun:** `getActivePriceAlertsBySymbol()` fonksiyonu sadece normal kullanıcıları destekliyordu.

**Çözüm:**
- Misafir kullanıcılar için `device_id` ile user join'i eklendi
- Hem normal kullanıcılar hem de misafir kullanıcılar destekleniyor

**Kod:** Aynı mantık `getAllActiveCustomAlerts()` ile aynı

---

## 🔄 Çalışma Mantığı

### Normal Kullanıcılar (Google/Apple)
1. NextAuth.js session oluşturur
2. JWT token cookie'leri set edilir
3. Backend cookie'den user'ı bulur
4. Premium kontrolü yapılır
5. Alert oluşturulur/listelenir

### Misafir Kullanıcılar
1. Session yok (NextAuth.js kullanılmıyor)
2. Cookie yok (backend'de authentication yok)
3. Frontend'den `userEmail` ve `deviceId` gönderilir
4. Backend `device_id` ve `email` ile user'ı bulur
5. Premium kontrolü yapılır
6. Alert oluşturulur/listelenir

---

## 📝 Test Senaryoları

### Senaryo 1: Misafir Kullanıcı - Alert Oluşturma
1. Misafir kullanıcı olarak giriş yap
2. Premium'a yükselt
3. Settings → Custom Coin Alerts → Add Alert
4. ✅ Alert başarıyla oluşturulmalı

### Senaryo 2: Misafir Kullanıcı - Alert Listeleme
1. Misafir kullanıcı olarak giriş yap
2. Premium'a yükselt
3. Alert oluştur
4. Sayfayı yenile
5. ✅ Alert'ler görünmeli

### Senaryo 3: Misafir Kullanıcı - Otomatik Fiyat Takibi
1. Misafir kullanıcı olarak giriş yap
2. Premium'a yükselt
3. Alert oluştur
4. Fiyat hedefe yaklaşsın
5. ✅ Push notification gelmeli

### Senaryo 4: Google/Apple Kullanıcı - Karşılaştırma
1. Google/Apple ile giriş yap
2. Premium'a yükselt
3. Alert oluştur
4. ✅ Her şey çalışmalı (mevcut davranış korunmalı)

---

## 🔍 Değiştirilen Dosyalar

1. `/src/routes/alerts.js`
   - POST endpoint: Misafir kullanıcı desteği eklendi
   - GET endpoint: Misafir kullanıcı desteği eklendi

2. `/src/lib/push/db.js`
   - `getAllActiveCustomAlerts()`: Misafir kullanıcı desteği eklendi
   - `getActivePriceAlertsBySymbol()`: Misafir kullanıcı desteği eklendi

---

## ✅ Sonuç

Artık misafir kullanıcılar da Google/Apple kullanıcıları gibi:
- ✅ Custom coin alert oluşturabilir
- ✅ Alert'lerini listeleyebilir
- ✅ Otomatik fiyat takipleri alabilir

Tüm değişiklikler geriye dönük uyumlu (backward compatible) - normal kullanıcılar için mevcut davranış korunuyor.










