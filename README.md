# Last Chance — Discipline Tracker

IELTS intizom nazorati uchun shaxsiy sayt + Telegram bot. 7 bo'lim: Reading, Listening,
Writing, Speaking, Vocabulary, Grammar, Progress.

## Nima qiladi

- **Progress**: har kuni 6 ta standart task (Reading/Listening/Writing/Speaking/Vocabulary/Grammar)
  avtomatik yaratiladi. Har birida Start/Finish — vaqt avtomatik hisoblanadi.
  Bundan tashqari **"+ Yangi task qo'shish"** orqali o'zingiz istalgan task qo'shishingiz mumkin —
  ixtiyoriy ravishda "necha kun davom etsin" (masalan 30) kiritib, uni belgilangan kun davomida
  har kuni avtomatik qayta paydo bo'ladigan qilib qo'yishingiz mumkin.
- **Reading/Listening**: kunlik material (PDF/HTML), Keyword bo'limi, Vocabulary (PDF/HTML fayl), kunlik natija.
- **Writing/Speaking**: kunlik material, Model Answer bo'limi, Vocabulary (PDF/HTML fayl), kunlik natija.
- **Vocabulary**: 4 ta alohida bo'lim (Reading/Listening/Writing/Speaking) — har birida kunlik so'zlar
  **fayl** (PDF/HTML) sifatida yuklanadi (qo'lda so'z kiritish emas). Bu yerdagi va tegishli
  bo'limning o'z "Vocabulary" tabidagi fayllar — bir xil ma'lumot.
- **Grammar**: kunlik topic (PDF/HTML).
- **Telegram bot**:
  - Har kuni **03:00** — kunlik 6 ta task ro'yxati, har birida Start tugmasi.
  - Tugmani bossangiz vaqt boshlanadi, Finish bossangiz to'xtaydi va natija saqlanadi.
  - Har kuni **22:00** — kunlik natija va qolib ketgan tasklar ro'yxati.
  - Har kuni **08:00** — so'zlarni **3, 7, 14, 23, 30-kun**larda avtomatik eslatadi
    (4 bo'lim: Reading/Listening/Writing/Speaking so'zlari alohida).

Sayt va bot bitta bazani ishlatadi — saytda qo'shgan task/so'zingiz botda ham ko'rinadi va aksincha.

## 1-qadam: Kompyuteringizda sinab ko'rish (ixtiyoriy)

```bash
npm install
npm start
```

Brauzerda oching: `http://localhost:3000`

`.env` faylida token va chat ID allaqachon kiritilgan:

```
TELEGRAM_BOT_TOKEN=8442320589:AAF8KlSYQ3YZBdn5y8O1gxVZ3Se3C6FfaaI
TELEGRAM_CHAT_ID=8569038697
TIMEZONE=Asia/Tashkent
```

⚠️ **`.env` faylni hech qachon GitHub'ga yuklamang** — u `.gitignore`'da allaqachon berkitilgan.

## 2-qadam: GitHub'ga yuklash

```bash
cd last-chance
git init
git add .
git commit -m "Last Chance - boshlang'ich versiya"
```

GitHub'da yangi **private** repository yarating (masalan `last-chance`), keyin:

```bash
git remote add origin https://github.com/FOYDALANUVCHI_NOMI/last-chance.git
git branch -M main
git push -u origin main
```

## 3-qadam: Railway'ga joylash

1. [railway.app](https://railway.app) ga GitHub akkount orqali kiring.
2. **New Project → Deploy from GitHub repo** → `last-chance` repo'ni tanlang.
3. Railway avtomatik `npm install` va `npm start` ni ishga tushiradi.
4. **Variables** bo'limiga o'ting va quyidagilarni qo'shing (chunki `.env` GitHub'da yo'q):
   - `TELEGRAM_BOT_TOKEN` = `8442320589:AAF8KlSYQ3YZBdn5y8O1gxVZ3Se3C6FfaaI`
   - `TELEGRAM_CHAT_ID` = `8569038697`
   - `TIMEZONE` = `Asia/Tashkent`
5. **Settings → Networking → Generate Domain** — saytga havola olasiz (masalan
   `last-chance-production.up.railway.app`).
6. Deploy tugagach, botga Telegram'da `/start` yozing — endi u 24/7 ishlaydi.

Railway bepul kredit tugagach oyiga taxminan $3–5 atrofida to'lov talab qilishi mumkin
(loyiha juda yengil bo'lgani uchun odatda bepul limit ham yetadi).

## Yangi funksiyalar (2-versiya)

- **Progress**: Start/Pause/Resume/Finish/Qayta boshlash — task istalgan payt pauza qilinishi, davom
  ettirilishi yoki qaytadan boshlanishi mumkin. Custom tasklarni o'chirish tugmasi (🗑) qo'shildi.
- **Bot buyruqlari**:
  - `/start`, `/bugun` — bugungi tasklarni ko'rsatadi
  - `/stats` — streak, bugungi progress, jami statistika
  - `/mashq` — to'plangan barcha vocabulary/grammar fayllaridan tasodifiy mashq (quiz)
  - `/yuklash` — botning o'zidan turib bo'limga PDF/HTML/audio fayl yuklash
- **Audio fayllar**: Speaking (va boshqa bo'limlar) uchun PDF/HTML bilan bir qatorda audio
  (.mp3, .m4a, .ogg, .wav) ham yuklash mumkin — saytda pleer sifatida ko'rinadi.
- **Avtomatik quiz**: har bir yuklangan Vocabulary fayli uchun 2, 5, 8, 14 va 24 soatdan keyin
  bot faylni o'qib (HTML/matnli PDF), undagi "so'z - ma'no" juftliklaridan interaktiv savol-javob
  o'tkazadi. ⚠️ Bu faqat matn ko'rinishidagi (skanerlanmagan) fayllarda va "so'z - ma'no" yoki
  "so'z: ma'no" formatida yozilgan qatorlarda ishonchli ishlaydi.
- **Kechki takrorlash** (20:30): to'plangan grammar/vocabulary fayllaridan tasodifiy 5 tasini
  eslatib, o'z-o'zini tekshirish uchun ro'yxat yuboradi.
- **Kechki natija** (22:00): endi "boshlanmagan" va "boshlangan, lekin tugallanmagan (pauzada/jarayonda)"
  tasklarni alohida ko'rsatadi.

## Yangi funksiyalar (3-versiya)

- **4 variantli quiz**: har bir savolda so'z va 4 ta javob varianti (tugma bosib javob beriladi, matn yozish shart emas).
- **Keyword fayllari** ham Vocabulary kabi 3/7/14/23/30-kunlik va 2/5/8/14/24-soatlik eslatma/quiz tizimida ishtirok etadi.
- **Rasm (screenshot) fayllar**: Vocabulary/Keyword uchun so'zlar rasmini ham yuklash mumkin — undan matn OCR orqali avtomatik o'qiladi (faqat aniq, tartibli yozilgan rasmlarda ishonchli ishlaydi).
- **Botda vaqt ko'rsatish**: jarayondagi/pauzadagi tasklar yonida qancha vaqt o'tgani (soat:daqiqa:soniya) ko'rsatiladi, har daqiqada yangilanadi.
- **Har bir bo'limning natijasiga rasm biriktirish** mumkin (masalan, imtihon natijasi skrinshoti).
- **Haftalik hisobot**: har yakshanba soat 00:00 da o'tgan hafta bo'yicha umumiy statistika botga yuboriladi.
- **PDF barcha brauzerlarda ochiladi**: Content-Type va Content-Disposition sarlavhalari to'g'ri sozlangan (Chrome, Edge, Firefox, Safari — barchasida ishlaydi, yuklab olinmasdan to'g'ridan-to'g'ri ochiladi).

⚠️ **OCR (rasmdan matn o'qish) haqida eslatma**: bu funksiya `tesseract.js` kutubxonasi orqali ishlaydi va birinchi marta ishlatilganda til modellarini internetdan yuklab oladi (internet aloqasi kerak, Railway'da avtomatik ishlaydi). Aniqlik rasm sifatiga bog'liq — qo'lda yozilgan yoki noaniq rasmlarda natija yomon bo'lishi mumkin.

## Yangi funksiyalar (4-versiya)

- **📖 Lug'at (so'zlar banki)**: barcha Vocabulary/Keyword/Grammar fayllaridan chiqarilgan so'zlar
  endi saytda alohida **Lug'at** tabida qidiruv bilan ko'rinadi — har birida qaysi bo'limga tegishli
  ekani va joriy holati (qiyin/takrorlash vaqti kelgan) ko'rsatiladi.
- **🔁 Moslashuvchan takrorlash (SRS)**: eski qattiq belgilangan 2/5/8/14/24-soatlik jadval o'rniga,
  endi har bir **so'z alohida** kuzatiladi — to'g'ri javob bersangiz keyingi takrorlash oralig'i
  uzayadi (2s→5s→8s→14s→24s→2kun→4kun→7kun→14kun), xato qilsangiz qisqaradi. Bot buni har 30
  daqiqada avtomatik tekshirib, muddati kelgan so'zlardan quiz o'tkazadi.
- **⚠️ Qiyin so'zlar**: ketma-ket 2+ marta xato qilingan so'zlar avtomatik "qiyin" deb belgilanadi.
  Botda `/qiyin` buyrug'i orqali faqat shu so'zlardan mashq qilish mumkin.
- **🔥 Faollik xaritasi (heatmap)**: Progress sahifasida oxirgi 180 kunlik faollik GitHub-uslubidagi
  rangli katakchalar bilan ko'rsatiladi.
- **⏰ Sozlanadigan eslatma vaqtlari**: `03:00/08:00/20:30/22:00` endi qattiq kod emas — botda
  `/vaqt 03:00 08:00 20:30 22:00` buyrug'i bilan istalgan vaqtga o'zgartirish mumkin (server qayta
  ishga tushirilmasdan darhol qo'llanadi).
- **🎯 Kunlik maqsad**: Progress sahifasida kunlik daqiqa maqsadiga progress-bar. Botda `/maqsad 90`
  bilan o'rnatiladi, `/stats`da ham ko'rinadi.
- **📊 Grafik statistika**: Progress sahifasida bo'limlar bo'yicha vaqt taqsimoti (doira diagramma)
  va so'nggi 7 kunlik bajarilgan tasklar (ustunli grafik) — Chart.js orqali.
- **🔁 Snooze (kechiktirish)**: kechki natija va so'z eslatma xabarlarida "1 soatdan keyin eslat"
  tugmasi — band bo'lganda foydali.
- **🥉🥈🥇💎 Reyting/darajalar**: streak asosida daraja beriladi — 7 kun = Bronza, 14 kun = Kumush,
  30 kun = Oltin, 60 kun = Olmos. Saytda va `/stats`da ko'rinadi, keyingi darajagacha necha kun
  qolgani ham chiqadi.
- **✍️ Writing/Speaking baholash (1-9)**: kunlik natija blokida endi IELTS band (1-9, 0.5 qadam
  bilan) kiritish mumkin. Har bir bo'limning natija panelida vaqt bo'yicha progress grafigi chiqadi.
- **📐 Grammar quiz**: botda `/grammatika` buyrug'i — faqat Grammar bo'limiga yuklangan
  materiallardan (mavzu nomi + qoida) so'z-banki asosida interaktiv quiz o'tkazadi.
- **🔎 Bot orqali tezkor qidiruv**: `/soz <so'z>` — butun lug'at bazasidan (barcha bo'limlardan)
  mos so'z/ma'nolarni qidirib topib beradi.

⚠️ **Grammar/heading ajratish tuzatildi**: mavzu nomida raqam bo'lsa (masalan "Conditional Type 2"),
avvalgi versiyada noto'g'ri ajratilardi — bu endi to'g'irlandi.

## Muhim eslatmalar

- Baza — oddiy fayl (`data/lastchance.db`, SQLite). Railway'da bu fayl konteyner
  qayta ishga tushganda saqlanib qolishi uchun **Volume** qo'shish tavsiya etiladi:
  Railway loyihasida **Settings → Volumes → New Volume**, mount path: `/app/data`.
  Xuddi shunday `uploads/` papka uchun ham volume qo'shing (`/app/uploads`) — aks holda
  yuklagan PDF/HTML fayllar qayta deploy vaqtida yo'qolishi mumkin.
- Vaqt zonasi `Asia/Tashkent` qilib qo'yilgan — soat 03:00/08:00/22:00 shu zonaga ko'ra ishlaydi.
- Kelajakda ko'proq foydalanuvchi/qurilma qo'shmoqchi bo'lsangiz, ayting — autentifikatsiya
  qo'shib beraman (hozircha bu bitta shaxsiy foydalanuvchi uchun mo'ljallangan, parolsiz).

## Papka tuzilishi

```
last-chance/
├── server.js        # Express API server
├── bot.js           # Telegram bot + cron jadval (03:00 / 08:00 / 22:00)
├── db.js            # SQLite baza sxemasi
├── public/           # Sayt (HTML/CSS/JS)
├── uploads/          # Yuklangan PDF/HTML fayllar
└── data/             # SQLite baza fayli
```
