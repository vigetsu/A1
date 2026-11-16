# 🌍 Gezi Albümü

Gezdiğin yerlerde çektiğin fotoğrafları ekle. Uygulama her fotoğrafın **hangi ülke ve şehirde**
çekildiğini kendisi bulur ve albümü **Ülke → Şehir** olarak düzenler. Android ve iPhone'da çalışır
(Expo / React Native).

## Konum nasıl bulunuyor?

1. **GPS (en kesin):** Fotoğrafta konum bilgisi (EXIF GPS) varsa, telefonun kendi harita servisiyle
   ülke ve şehre çevrilir.
2. **Yapay zekâ (Claude):** GPS yoksa fotoğraf Claude'a gönderilir. Claude tabelalar, ünlü yapılar,
   mimari ve doğa gibi ipuçlarından ülke, şehir ve görünen yeri (ör. "Kolezyum") tahmin eder.
   Ne kadar emin olduğunu ve gerekçesini de yazar.

Tahmin yanlışsa fotoğrafa dokunup ülke ve şehri elle düzeltebilirsin.

## Özellikler

- Galeriden çoklu seçim (en fazla 30) veya kamerayla çekip ekleme
- Bayraklı ülke listesi; ülkeye dokununca şehir şehir fotoğraf ızgarası
- Fotoğraf detayı: konum, yer adı, açıklama, yapay zekâ gerekçesi, çekim tarihi
- Elle konum düzeltme ve albümden silme (galerideki asıl fotoğraf silinmez)
- Aynı fotoğraf ikinci kez eklenmez
- Her şey telefonda kalır: fotoğrafların küçültülmüş kopyası uygulama klasöründe, bilgiler SQLite'ta

## Telefonda deneme (Expo Go)

1. Telefona **Expo Go** uygulamasını kur (App Store / Google Play).
2. Bilgisayarda:
   ```bash
   npm install
   npx expo start
   ```
3. Ekranda çıkan QR kodu telefonla okut (iPhone: Kamera, Android: Expo Go içinden).
4. Uygulamada ⚙️ **Ayarlar** → Claude API anahtarını gir (https://console.anthropic.com).

## Gerçek uygulama olarak kurma (APK / App Store)

[EAS Build](https://docs.expo.dev/build/introduction/) ile bulutta derlenir, bilgisayarda Android Studio/Xcode gerekmez:

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform android --profile preview   # telefona kurulabilir APK
npx eas-cli@latest build --platform ios                          # Apple Developer hesabı gerekir
```

## Geliştirme

```bash
npm test           # GPS okuma ve gruplama birim testleri
npm run typecheck  # TypeScript kontrolü
```

| Dosya | Görev |
|---|---|
| `App.tsx` | Ekranlar: albüm, ülke görünümü, fotoğraf detayı, ayarlar |
| `src/lib/pipeline.ts` | Fotoğrafı küçültür, GPS → konum, yoksa AI, kaydeder |
| `src/lib/ai.ts` | Claude görsel analizi (yapılandırılmış JSON çıktısı) |
| `src/lib/db.ts` | SQLite kayıtları |
| `src/lib/logic.ts` | EXIF GPS/tarih okuma, Ülke → Şehir gruplama, bayrak |

## Notlar

- **API anahtarı:** Telefonun güvenli deposunda (Keychain / Keystore) saklanır ve yalnızca Anthropic'e
  gönderilir. Uygulama kişisel kullanım içindir. Başkalarına dağıtacaksan anahtarı uygulamaya gömme;
  araya kendi sunucunu koy.
- **Maliyet:** GPS'siz her fotoğraf bir Claude çağrısıdır. Ayarlar'daki "GPS'li fotoğraflara da AI
  açıklaması ekle" seçeneğini kapatırsan GPS'li fotoğraflar ücretsiz işlenir. Fotoğraflar
  gönderilmeden önce en fazla 1568 px'e küçültülür.
- **GPS bilgisi:** Android 10+ için uygulama "fotoğraf konumuna erişim" izni ister. iPhone'da galeri
  seçici bazı fotoğrafların konum bilgisini vermeyebilir; o zaman yapay zekâ devreye girer.
