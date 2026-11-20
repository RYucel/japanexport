# RAV4 Avcısı — Japonya → KKTC gümrüklü fiyat takibi

Japonya'daki kullanılmış **Toyota RAV4** ilanlarını iki kaynaktan ([SBT Japan](https://www.sbtjapan.com) ve
[Goo-net Exchange](https://www.goo-net-exchange.com)) her gün tarar; navlun, sigorta, galeri komisyonu ve
**KKTC ithalat vergilerini** ekleyerek aracın **KKTC'de plakalı (gümrüklü) fiyatını** hesaplar, piyasaya göre
en ucuz olanları **fırsat skoru** ile sıralar ve günlük rapor üretir.

- 🔎 **Kaynaklar:** SBT Japan (669 RAV4) + Goo-net Exchange (664 RAV4) → tek panelde ~1.300 ilan
- 🚙 **Model seçici:** RAV4, Corolla, Yaris, C-HR, Hilux, X-Trail, Note, Civic, CR-V, CX-5, Swift, Forester, Golf, Passat
- 🧾 **Gümrük modeli:** Neveser Gümrükleme'nin (KKTC) kamuya açık araç gümrük hesaplama aracındaki oranlar
- 💱 **Kurlar:** TCMB döviz satış (günlük)
- ⏳ **5 yaş kuralı:** Ordino tarihinde araç 5 yaşını doldurmamış olmalı — uymayan ilanlar elenir

---

## Hızlı başlangıç

```powershell
cd E:\Projeler\JapanExportGuide

npm run daily                          # varsayılan model (RAV4) + rapor
npm run daily -- --model corolla       # belirli model için rapor
npm start                              # web paneli → http://localhost:4173
```

Windows'ta kısayol: **`baslat.cmd`** (panel) ve **`gunluk.cmd`** (günlük tarama + rapor) dosyalarına çift tıklamanız yeterli.

Bağımlılık yoktur; Node.js 18+ yeterlidir (`node -v` ile kontrol edin).

İlk çalıştırmada ~14 sayfa taranır (yaklaşık 40–60 saniye). Sonuçlar gün boyu önbellekten gelir;
**Yenile** düğmesi (`?refresh=1`) yeniden tarar.

---

## Ne gösterir?

| Alan | Açıklama |
|---|---|
| **KKTC gümrüklü** | Aracın KKTC'de trafiğe çıkabilmesi için ödenen her şey dahil toplam (CIF + vergiler + komisyon) |
| **FOB** | Japonya'daki ilan fiyatı (£ karşılığı, ¥ üzerinden) |
| **Piyasa farkı** | Aynı motor/yakıt grubunda, aynı yaş ve km'deki emsallerine göre ne kadar ucuz/pahalı |
| **Fırsat skoru** | 0–100; piyasa farkı + fiyat düşüşü + düşük km |
| **Maliyet dökümü** | Gümrük, FİF, özel fon/stopaj, rıhtım, GKK, bandrol, KDV satır satır |
| **5 yaş uyarısı** | Varışta 5 yaşa 3 aydan az kalan araçlar işaretlenir |

Panelde bütçe, model yılı, km, yakıt, çekiş filtreleri; liman, navlun, komisyon, ithalatçı tipi ve varış süresi
ayarları vardır. Ayar değiştirince tüm fiyatlar anında yeniden hesaplanır (yeniden tarama yapılmaz).

---

## Modeller

Panelin sağ üstündeki **Model** seçicisinden geçiş yapılır. İlk seçimde o model
taranır (1–2 dk), sonrası gün boyu önbellekten gelir.

| Marka | Modeller |
|---|---|
| Toyota | RAV4, Corolla, Yaris, Yaris Cross, Corolla Cross, C-HR, Hilux, Land Cruiser Prado, Harrier |
| Nissan | X-Trail, Juke, Note |
| Honda | Civic, CR-V, Vezel, HR-V |
| Mazda | CX-5, CX-30 |
| Suzuki | Swift, Jimny |
| Subaru | Forester |
| Mitsubishi | Outlander |
| Volkswagen | Golf, Passat, Tiguan |

Bazı modeller Goo-net'te yok (Yaris Cross, Corolla Cross, Prado): `gnModel: null` verilir,
o model için yalnızca SBT taranır. Yeni bir model eklemeden önce stok kontrolü:

```powershell
node scripts/check-models.mjs yaris-cross jimny tiguan
```

Yeni model eklemek için `models.json`'a bir kayıt ekleyin:

```json
"tucson": {
  "label": "Hyundai Tucson",
  "make": "HYUNDAI", "model": "TUCSON",
  "sbtMakeId": 27, "sbtModel": "TUCSON",
  "gnMake": "HYUNDAI", "gnModel": "TUCSON",
  "vehicleType": "suv", "bodyLabel": "SUV"
}
```

- `sbtMakeId`: SBT marka kimliği (Toyota 2, Nissan 3, Honda 4, Mazda 5, Subaru 7, Suzuki 9, VW 53)
- `gnMake` / `gnModel`: Goo-net URL'sindeki `/usedcars/MAKE/MODEL/` parçaları
- `vehicleType`: `suv` · `otomobil` · `ticari` (pickup) — gümrük oranlarını etkiler

Model listesi popüler araçlarla sınırlı tutuldu; diğer marka/modeller aynı şablonla eklenebilir.

---

## Kaynaklar

| Kaynak | RAV4 stoğu | Not |
|---|---|---|
| **SBT Japan** | ~670 (2022+) | FOB fiyat, model kodu, çekiş, yakıt, konum; sunucu-render HTML |
| **Goo-net Exchange** | 664 | Fiyat JSON'da; yakıt başlıktan çıkarılır, çekiş bilgisi listelenmez; sayfalama POST + `offset`, hız sınırı vardır (yavaş taranır) |

Her kaynak `config.json → sources` altından ayrı ayrı açılıp kapatılabilir.
Panelde **Kaynak** filtresiyle yalnızca birini görebilirsiniz.

---

## Hesaplama modeli

### 1. CIF

```
FOB (¥ → ₺)  +  Navlun (USD → ₺)  +  Sigorta (%1,5 × FOB)  =  CIF
```

**Navlun iki şekilde hesaplanır** (`config.json → shipping.method`):

| Yöntem | Formül | Örnek |
|---|---|---|
| `container` (varsayılan) | Konteyner ücreti ÷ konteynere sığan araç | $11.000 ÷ 4 SUV = **$2.750/araç** · ÷ 5 sedan = $2.200 · ÷ 3 pickup = $3.667 |
| `roro` | Limana göre araç başı sabit | Gazimağusa $1.350 |

> 40' konteynere kabaca 4 SUV veya 5 sedan sığar (paylaşımlı yükleme). Bu sayılar
> `carsPerContainer` ile araç tipine göre ayarlanır; panelde “Yöntem” seçicisiyle
> RORO'ya geçip karşılaştırma yapabilirsiniz.
> Piyasa referansı (2026): paylaşımlı 40' HC ≈ $2.000–3.000/araç, dedicated ≈ $3.800–5.400 + liman/varış masrafları.

### 2. KKTC vergileri (CIF üzerinden)

| Kalem | Oran |
|---|---|
| Gümrük Vergisi | **%10** (Japonya menşeli binek/SUV) |
| Fiyat İstikrar Fonu (FİF) | **%3** ≤2000cc · **%8** 2001–3000cc · **%12** >3000cc |
| Özel Fon | **%15** (şahıs ithalatı) |
| Stopaj | **%4** (galeri/bayi ithalatı — özel fon yerine) |
| Rıhtım Harcı | **%4,4** (deniz yolu; Ercan'da muaf) |
| GKK | **%2,5** |
| Bandrol | **%0,3 + 50 ₺** |
| KDV | **%20** — matrah: CIF + yukarıdaki tüm vergiler |

> Hibrit araçlar, motor tipine göre (benzinli/dizel) değerlendirilir; ayrı hibrit avantajı yoktur.
> Elektrikli araçta FİF %5, KDV %5.

### 3. Toplam
```
KKTC toplam = CIF + tüm vergiler + galeri komisyonu (£2.000) + (varsa) tescil/plaka
```

**Örnek (2024 RAV4, 2.0 benzin, ¥2.431.000):**

| | |
|---|---|
| FOB | £11.573 |
| Navlun + sigorta | £1.198 |
| CIF | £12.771 |
| Vergiler (toplam) | £7.951 |
| Komisyon | £2.000 |
| **KKTC gümrüklü** | **£22.721** |

---

## 5 yaş kuralı

KKTC'de salon araçlarda **ordino alındığında araç 5 yaşını bir gün bile geçmemiş** olmalıdır.
Uygulama varışı `bugün + 90 gün` varsayar ve yaşı **ilk tescil tarihinden** hesaplar:

```js
eligible = ageAtArrival < 60 ay
```

2026 Kasım'da bakıyorsanız pratikte **2022 Şubat ve sonrası** tescilli araçlar uygundur.
Sınıra 3 aydan az kalanlar `⚠️ 5 yaş sınırına yakın` etiketi alır.

---

## Fırsat skoru

1. İlanlar yakıt (benzin/hibrit) + motor hacmi grubuna ayrılır.
2. Her grup içinde **6 aylık yaş kovalarında** medyan FOB fiyatı hesaplanır.
3. Araç, kendi kovasının medyanıyla karşılaştırılır; km farkı ±%1,2/10.000 km ile düzeltilir.
4. `skor = 50 + 180 × piyasaFarkı + 150 × fiyatDüşüşü` (0–100 arası sınırlanır).

Skor bir "alım sinyali"dir, garanti değil: en düşük fiyatlı araçlar genelde yüksek km'li veya
düşük donanımlı (X/G) olur. Kart üzerindeki donanım, km ve yaş bilgisine birlikte bakın.

---

## Günlük otomasyon

**Windows Görev Zamanlayıcı** (her sabah 08:30):

```powershell
schtasks /Create /TN "RAV4 Avcisi" /SC DAILY /ST 08:30 ^
  /TR "cmd /c cd /d E:\Projeler\JapanExportGuide && node src\daily.js" /F
```

**Linux/macOS cron** (her sabah 08:30):

```
30 8 * * * cd /path/JapanExportGuide && node src/daily.js >> data/daily.log 2>&1
```

Raporlar: `data/reports/YYYY-MM-DD-<model>.md` ve `.html`.
Panelden **Günlük rapor** bağlantısıyla da açılır (`/report`).

Fiyat geçmişi `data/state-<model>.json` içinde tutulur; ertesi gün **fiyatı düşenler**, **yeni ilanlar** ve
**listeden düşenler (muhtemelen satıldı)** rapora otomatik eklenir.

---

## Ücretsiz yayınlama

Tarama 40+ sayfa ve 15–25 dakika sürdüğü için Vercel/Cloudflare fonksiyonlarının ücretsiz
zaman aşımına sığmaz. Bu yüzden mimari şöyle:

```
GitHub Actions (günlük cron)  →  tarama + hesaplama  →  public/ (statik site)  →  GitHub Pages
```

Panel statik modda API olmadan çalışır: `public/data/<model>.json` dosyalarını okur,
gümrük/navlun/komisyon hesaplarını tarayıcıda yapar (`public/lib/*.js` — sunucuyla aynı kod).

### GitHub Pages (önerilen, tamamen ücretsiz)

1. GitHub'da yeni bir repo açın, sonra:

```powershell
git init
git add .
git commit -m "ilk sürüm"
git branch -M main
git remote add origin https://github.com/<kullanici>/<repo>.git
git push -u origin main
```

2. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**
3. **Actions → “Günlük tarama ve yayın” → Run workflow** (ilk veriyi üretir, 20–40 dk)
4. Site: `https://<kullanici>.github.io/<repo>/`
5. Bundan sonra her gün 03:15 UTC'de otomatik güncellenir.

Notlar:
- Fiyat geçmişi (`data/state-*.json`) her gün commit edilir; “fiyat düştü” tespiti buna dayanır.
- `public/data` ve `public/reports` repoya girmez; Pages'e artifact olarak yüklenir.
- İlk çalıştırmada 14 model taranır; süre ~20–40 dk. Daha kısa sürmesi için
  workflow'da `node src/build-static.js --models=rav4,corolla` kullanabilirsiniz.
- Kaynak siteler Actions IP'lerini engellerse: yerelde `npm run build` çalıştırıp
  `public/data` + `public/reports` klasörlerini commit edin (Pages bunları da yayınlar).

### Cloudflare Pages (alternatif)

- Repoyu bağlayın; **Build command:** `node src/build-static.js`, **Output directory:** `public`.
- Cloudflare'in ücretsiz build süresi 20 dakika olduğu için 14 model riskli. İki seçenek:
  - Actions'ta workflow'u **`commit_site` işaretli** çalıştırın (veri repoya yazılır), Cloudflare'de build komutunu boş bırakın.
  - Ya da `--models=` ile 4–6 modelle sınırlayın.

### Vercel

Statik çıktı olarak yayınlanabilir (Framework: Other, Output: `public`), ancak veri üretimi
yine GitHub Actions'ta olmalı — Vercel'in build ortamına tarayıcı/sayfa erişimi için ek
yapılandırma gerekir. Bu proje için GitHub Pages daha basit.

### Yerel

```powershell
npm start     # API + panel (canlı tarama)
npm run build # public/ altına statik site üret
```

`public/` klasörünü herhangi bir statik host'a (Netlify, S3, nginx) olduğu gibi atabilirsiniz.

---

## Bildirim özelleştirme (`notify.json`)

Telegram ve WhatsApp mesajları bu dosyadan ayarlanır:

```json
{
  "maxPriceGbp": 25000,
  "models": [],
  "topN": 5,
  "minGapPct": 5,
  "header": "🚗 KKTC Araç Avcısı",
  "footer": "Tüm liste ve maliyet dökümü:"
}
```

| Alan | Anlamı |
|---|---|
| `maxPriceGbp` | **Üst bütçe** (gümrüklü £). `0` = sınırsız. Ör. 25000 → sadece £25.000 altı fırsatlar |
| `models` | Yalnızca bu modeller (ör. `["rav4","corolla"]`). Boş dizi = tümü |
| `topN` | Mesajda kaç fırsat gösterilecek |
| `minGapPct` | En az piyasa farkı (%). `5` → “piyasanın en az %5 altında” |
| `header` / `footer` | Mesaj başlığı ve kapanış satırı |

Değişiklikten sonra bir sonraki günlük çalıştırma yeni ayarları kullanır.
Yerelde denemek için: `node src/notify.js --dry-run`

> Paneldeki varsayılan bütçe filtresi `config.json → ui.defaultBudgetGbp` ile gelir
> (şu an 25.000 £). Boş bırakmak için `0` yapın.

---

## Telegram bildirimi (ücretsiz, en güvenilir)

WhatsApp'a alternatif olarak aynı özet Telegram'a gönderilebilir. Kurulum ~2 dakika:

1. Telegram'da **@BotFather** → `/newbot` → isim verin → **token** alın.
2. Botunuza bir mesaj gönderin (ör. "merhaba").
3. Chat id'yi bulun — tarayıcıda açın:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
   Yanıttaki `"chat":{"id":123456789` değerini alın.
4. Secret'ları ekleyin ve sağlayıcıyı seçin:

```powershell
gh secret set TELEGRAM_TOKEN   --body "123456:ABC..."
gh secret set TELEGRAM_CHAT_ID --body "123456789"
gh variable set NOTIFY_PROVIDER --body "telegram"
```

5. Test: **Actions → Run workflow** (veya yerelde `node src/notify.js`).

Yerelde chat id bulmak için:

```powershell
$env:TELEGRAM_TOKEN="123456:ABC..."
node src/notify.js --telegram-setup
```

`NOTIFY_PROVIDER` boşsa: Telegram token'ı varsa Telegram, yoksa CallMeBot kullanılır.

---

## WhatsApp bildirimi (TextMeFlow — ücretsiz plan 50 mesaj/ay)

[TextMeFlow](https://textmeflow.eu) **kendi WhatsApp numaranızı** API'ye bağlar
(QR ile eşleştirme). Ücretsiz plan **ayda 50 mesaj** verir — günde 1 özet = ayda ~30.

1. https://textmeflow.eu/en/signup?plan=free → ücretsiz planla kayıt olun.
2. Panelden WhatsApp'ı **QR ile eşleştirin** (Telefon → Bağlı cihazlar gibi).
3. **API key**'i kopyalayın.
4. Secret'ları ekleyin:

```powershell
gh secret set TEXTMEFLOW_APIKEY --body "KEY"
gh secret set TEXTMEFLOW_TO     --body "+90533xxxxxxx"
gh variable set NOTIFY_PROVIDER --body "textmeflow"
```

5. Test: **Actions → Run workflow**.

Gönderim `POST https://api.textmeflow.eu/v1/messages` (Bearer) ile yapılır;
`send.php` (TextMeBot uyumlu) uç noktası da mevcuttur.

> Not: Eşleştirilen oturum düşerse mesaj gitmez; panelden yeniden bağlamak gerekir.
> Telegram halen en güvenilir kanal — WhatsApp'ı ikinci kanal olarak açık tutabilirsiniz.

---

## WhatsApp bildirimi (CallMeBot, alternatif)

Her günün özeti (en iyi 5 fırsat + gümrüklü fiyatlar + site linki) WhatsApp'a gönderilir.
[CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/) kullanılır — kişisel
kullanım için ücretsizdir, resmî API değildir.

**Kurulum (5 dakika):**

1. Telefon rehberine **+34 644 31 95 65** numarasını `CallMeBot` adıyla ekleyin.
2. WhatsApp'tan bu numaraya şu mesajı gönderin:
   `I allow callmebot to send me messages`
3. Gelen yanıttaki **API key**'i not edin.
4. GitHub reposuna iki secret ekleyin:

```powershell
gh secret set WHATSAPP_PHONE  --body "+90533xxxxxxx"   # ülke kodlu
gh secret set WHATSAPP_APIKEY --body "123456"          # CallMeBot anahtarı
```

   (veya repo → Settings → Secrets and variables → Actions)

5. Denemek için **Actions → Günlük tarama ve yayın → Run workflow**.

Yerelde denemek:

```powershell
$env:WHATSAPP_PHONE="+90533xxxxxxx"; $env:WHATSAPP_APIKEY="123456"
node src/notify.js            # gönderir
node src/notify.js --dry-run  # sadece mesajı gösterir
```

Örnek mesaj:

```
🚗 KKTC Araç Avcısı · 20 Kasım
14 model · 6.812 ilan tarandı, 4.930 tanesi 5 yaşa uygun.

🔥 Bugünün en iyi fırsatları:
1) Toyota RAV4 · 2024/09 X
   12.704 km · £24.536 gümrüklü · piyasa −%29,5
...
```

Notlar:
- **Numara:** güncel bot numarası **+34 644 31 95 65** (callmebot.com'da doğrulayın; eski `+34 644 51 95 23` çalışmıyor).
- Yanıt 2 dakika içinde gelmezse CallMeBot 24 saat beklemenizi istiyor; farklı bir numaradan denemeyin.
- CallMeBot dakikada 1 mesajla sınırlı; günde 1 özet için fazlasıyla yeterli.
- Secret'lar tanımlı değilse bildirim sessizce atlanır, yayın etkilenmez.
- Resmî **WhatsApp Cloud API** alternatifi: Meta Business hesabı + mesaj şablonu onayı gerekir;
  günlük bildirimler ücretli olabilir, bu yüzden varsayılan olarak CallMeBot kullanılıyor.

---

## Yapılandırma (`config.json`)

| Anahtar | Anlamı |
|---|---|
| `search.model` / `modelFilter` | SBT model kodu (`RAV4`) |
| `search.makeId` | SBT marka kimliği (Toyota = 2) |
| `activeModel` | Varsayılan model anahtarı (`models.json`) |
| `search.yearFromBack` | Bugünden kaç yıl geriye taranacağı (4 → 2022+) |
| `search.maxPages` | Emniyet sınırı (varsayılan 30) |
| `sources.sbt.enabled` | SBT Japan taransın mı |
| `sources.goonet.enabled` | Goo-net Exchange taransın mı |
| `sources.goonet.maxPages` | Goo-net sayfa sınırı (20 ilan/sayfa, varsayılan 35) |
| `shipping.port` | `FAMAGUSTA` · `MERSIN` · `ISKENDERUN` |
| `shipping.method` | `container` (paylaşımlı, varsayılan) veya `roro` |
| `shipping.containerUsd` | Konteyner toplam ücreti (varsayılan $11.000) |
| `shipping.carsPerContainer` | Araç tipine göre konteynere sığan adet (`suv:4, otomobil:5, ticari:3`) |
| `shipping.roroUsd` | Liman başına araç başı RORO ücreti (USD) |
| `shipping.insuranceRate` | Sigorta oranı (SBT örneğinde ~%1,53 → %1,5 kullanılıyor) |
| `fees.commissionGbp` | Galeri/aracılık komisyonu (varsayılan £2.000) |
| `fees.kktcRegistrationTry` | Tescil/plaka masrafı (varsayılan 0) |
| `customs.importerType` | `sahis` (+%15 özel fon) veya `galeri` (+%4 stopaj) |
| `customs.arrivalDays` | Tahmini varış süresi (5 yaş hesabı için) |

> **Navlun** ilan/ölçü/liman ve sezona göre değişir. En doğrusu: SBT'nin ilan sayfasındaki
> “Total Price Calculator”dan veya satış temsilcisinden teklif alıp panelde **Navlun (USD)** alanına yazmak.

---

## Sınırlamalar ve doğruluk

- **Gümrük değeri:** KKTC Gümrük Dairesi vergi matrahını **kendi belirlediği araç değerine** göre saptar;
  fatura/CIF yalnızca yaklaşıktır. Kesin tutar için
  [GBS Tarife Maketi](https://giris.gbs.gov.ct.tr/tarife-maketi) veya Neveser Gümrükleme (0533 840 3834).
- **Oranlar** Resmî Gazete emirnameleriyle değişebilir; `src/customs.js` tek dosyada toplanmıştır.
- **İlan verisi** SBT ve Goo-net'in HTML'inden çözümlenir; site yapısı değişirse ilgili modül güncellenmelidir.
- **Goo-net** listesinde yakıt tipi ve çekiş yazmaz: yakıt başlıktan (HYBRID/PHV) çıkarılır, çekiş boş bırakılır.
- Tam tarama (SBT + Goo-net) yaklaşık **2 dakika** sürer; gün içinde önbellekten anında gelir.
- SBT fiyatları **FOB Japonya**'dır; sigorta/navlun/komisyon ve vergiler hariçtir.
- Sağ direksiyon (RHD) KKTC için uygundur (soldan trafik).

---

## Japonya müzayede / alternatif kaynaklar

SBT dışında bakmak isterseniz:

| Kaynak | Not |
|---|---|
| **USS / TAA / JU müzayedeleri** | Gerçek müzayede fiyatları; üyelik genelde **Japonya'daki yetkili bayi/ihracatçı** üzerinden olur, bireysel erişim yok |
| **BE FORWARD** | Açık ilan sitesi, Japonya stok + navlun hesabı |
| **Carused.jp / Japan Partner / Goo-net Exchange** | Perakende ihracat ilanları |
| **SBT Japan** (bu proje) | KKTC'ye liman seçenekleri ve şeffaf FOB fiyat |

Müzayede fiyatlarına erişmek için genelde bir ihracatçıyla çalışmak gerekir; o durumda müzayede
komisyonu (genelde ¥50.000–150.000) + navlun + gümrük aynı şekilde eklenir.

Başka bir kaynak eklemek için `src/sbt.js` ile aynı arayüzü (`scan()` → araç dizisi) sağlayan bir modül
yazıp `src/pipeline.js` içindeki `getRawScan` çağrısını değiştirmek yeterlidir.

---

## Dosya yapısı

```
config.json            ayarlar (varsayılan model, navlun, komisyon, gümrük)
models.json            popüler model listesi (SBT + Goo-net eşlemeleri)
server.js              web paneli + API
src/
  models.js            model tanımları ve search eşlemesi
  sbt.js               SBT Japan tarayıcı/ayrıştırıcı
  goonet.js            Goo-net Exchange tarayıcı/ayrıştırıcı
  fx.js                TCMB kurları (+ yedek)
  pipeline.js          tarama → hesaplama → state
  store.js             fiyat geçmişi / snapshot
  report.js            günlük rapor (md + html)
  view.js              istemciye giden sade JSON şekli
  daily.js             komut satırı: tarama + rapor
  build-static.js      statik site üretimi (Actions / Cloudflare)
  notify.js            günlük WhatsApp özeti (CallMeBot)
public/
  index.html           panel
  app.js               panel mantığı (veri yükler, maliyetleri hesaplar)
  lib/customs.js       KKTC gümrük vergisi motoru  ← tarayıcı + Node ortak
  lib/landed.js        CIF + vergi + komisyon
  lib/score.js         piyasa medyanları ve fırsat skoru
  data/                üretilen statik veri (git'e girmez)
  reports/             üretilen statik raporlar (git'e girmez)
.github/workflows/daily.yml   günlük tarama + GitHub Pages yayını
data/
  cache/               günlük ham tarama (yeniden taramayı önler)
  reports/             günlük raporlar (md)
  state-<model>.json   fiyat geçmişi (model başına)
test/                  gümrük motoru testleri (node --test)
```

## Komutlar

```powershell
npm start          # panel (API + canlı tarama)
npm run build      # statik site üret (public/)
npm run daily      # canlı tara + rapor
npm run scan       # sadece tara (önbelleği tazeler)
npm run scan -- --model corolla    # belirli modeli tara
node src/daily.js --no-refresh   # önbellekten rapor üret
node --test        # gümrük motoru testleri
```
