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
