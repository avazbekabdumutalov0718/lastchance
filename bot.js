const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { extractWordPairs } = require('./wordExtractor');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TZ = process.env.TIMEZONE || 'Asia/Tashkent';
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const SECTION_LABELS = {
  reading: '📖 Reading',
  listening: '🎧 Listening',
  writing: '✍️ Writing',
  speaking: '🗣 Speaking',
  vocabulary: '📚 Vocabulary',
  grammar: '📐 Grammar',
};

let bot = null;
if (TOKEN && CHAT_ID) {
  bot = new TelegramBot(TOKEN, { polling: true });
} else {
  console.warn("TELEGRAM_BOT_TOKEN yoki TELEGRAM_CHAT_ID sozlanmagan. Bot ishlamaydi.");
}

function todayStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Baza so'zlarini tozalash va tekshirish yordamchi funksiyasi
function getValidWords(wordsArray) {
  if (!Array.isArray(wordsArray)) return [];
  return wordsArray.filter(w => 
    w && 
    w.word && 
    w.meaning && 
    w.word !== 'undefined' && 
    w.meaning !== 'undefined'
  );
}

// ---------------------------------------------------------
// NOTIFICATION FUNKSIYALARI
// ---------------------------------------------------------
async function sendDailyTasks() {
  if (!bot || !CHAT_ID) return;
  db.ensureTodayTasks(todayStr());
  const tasks = db.getTasksByDate(todayStr());
  
  let msg = `🌅 *BUGUNGI INTIZOM REJASI (${todayStr()})*\n\n`;
  tasks.forEach((t, i) => {
    const st = t.status === 'done' ? '✅' : (t.status === 'in_progress' ? '⏳' : '⭕️');
    msg += `${i + 1}. ${st} *${db.taskLabel(t)}*\n`;
  });
  
  msg += `\nBugungi maqsad sari olg'a! Sayt orqali timer va natijalarni belgilang.`;
  await bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
}

async function checkVocabReminders() {
  if (!bot || !CHAT_ID) return;
  const eligible = db.getReminderEligibleMaterials();
  if (eligible.length === 0) return;

  for (const item of eligible) {
    let text = `📚 *LUG'AT ESLATMASI (${item.stage_days}-kun)*\n\n`;
    text += `Bo'lim: *${SECTION_LABELS[item.section] || item.section}*\n`;
    text += `Sana: ${item.date}\n`;
    if (item.title) text += `Mavzu: ${item.title}\n`;
    
    // Telegram caption chegarasi max 1024 belgi
    const safeCaption = text.length > 1020 ? text.slice(0, 1017) + '...' : text;

    if (item.file_path && fs.existsSync(item.file_path)) {
      const ext = path.extname(item.file_path).toLowerCase();
      if (ext === '.pdf') {
        await bot.sendDocument(CHAT_ID, item.file_path, { 
          caption: safeCaption, 
          parse_mode: 'Markdown' 
        });
      } else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
        await bot.sendPhoto(CHAT_ID, item.file_path, { 
          caption: safeCaption, 
          parse_mode: 'Markdown' 
        });
      } else {
        await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
      }
    } else {
      await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
    }
  }
}

async function sendEveningReview() {
  if (!bot || !CHAT_ID) return;
  const tasks = db.getTasksByDate(todayStr());
  const undone = tasks.filter(t => t.status !== 'done');
  
  if (undone.length > 0) {
    let msg = `⚠️ *KUN YAKUNLANMOQDA!*\n\nSizda hali bajarilmagan ${undone.length} ta task bor:\n`;
    undone.forEach(t => msg += `- ${db.taskLabel(t)}\n`);
    msg += `\nUxlashdan oldin ularni yakunlashni unutmang!`;
    await bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
  }
}

async function sendEveningSummary() {
  if (!bot || !CHAT_ID) return;
  const tasks = db.getTasksByDate(todayStr());
  const done = tasks.filter(t => t.status === 'done');
  const totalMin = Math.round(done.reduce((sum, t) => sum + (t.duration_seconds || 0), 0) / 60);

  let msg = `📊 *KUNLIK HISOBOT (${todayStr()})*\n\n`;
  msg += `Bajarilgan tasklar: *${done.length} / ${tasks.length}*\n`;
  msg += `Umumiy sarflangan vaqt: *${totalMin} daqiqa*\n\n`;

  if (done.length === tasks.length && tasks.length > 0) {
    msg += `🎉 *Ajoyib! Bugungi barcha maqsadlarga erishdingiz!*`;
  } else {
    msg += `Ertaga bundan ham yaxshiroq natija ko'rsatamiz! 💪`;
  }

  await bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
}

async function sendWeeklyReport() {
  if (!bot || !CHAT_ID) return;
  const stats = db.computeWeeklyStats();
  let msg = `📈 *HAFTALIK XULOSA*\n\n`;
  msg += `O'tgan haftada bajarilgan tasklar: *${stats.totalCompleted} ta*\n`;
  msg += `Umumiy vaqt: *${stats.totalMinutes} daqiqa*\n`;
  msg += `To'liq bajarilgan kunlar: *${stats.fullDays} kun*\n\nHarakatni davom ettiring!`;
  await bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
}

async function refreshRunningTaskTimers() {}

async function checkDueSrsWords() {}

// ---------------------------------------------------------
// UNIVERAZAL VOCABULARY QUIZ (Istalgan bo'lim bo'yicha)
// ---------------------------------------------------------
async function startVocabularyQuiz(chatId, section = 'all') {
  let rawWords = [];
  
  if (section === 'all') {
    const sections = ['reading', 'listening', 'writing', 'speaking', 'grammar', 'vocabulary'];
    for (const sec of sections) {
      const secWords = db.getWordsBySection ? db.getWordsBySection(sec) : [];
      rawWords = rawWords.concat(secWords);
    }
  } else {
    rawWords = db.getWordsBySection ? db.getWordsBySection(section) : [];
  }

  const validWords = getValidWords(rawWords);

  // Unikal so'zlarni ajratamiz (takrorlanishning oldini olish uchun)
  const uniqueWordsMap = new Map();
  for (const w of validWords) {
    if (w.word && w.meaning && !uniqueWordsMap.has(w.word.toLowerCase())) {
      uniqueWordsMap.set(w.word.toLowerCase(), w);
    }
  }
  const uniqueWords = Array.from(uniqueWordsMap.values());

  if (uniqueWords.length < 4) {
    const secName = SECTION_LABELS[section] || 'Ushbu bo\'lim';
    await bot.sendMessage(
      chatId, 
      `⚠️ ${secName}da quiz tuzish uchun kamida 4 ta har xil so'z bo'lishi kerak. Iltimos, ko'proq fayl yuklang.`
    );
    return;
  }

  // 1 ta to'g'ri so'zni tanlaymiz
  const target = uniqueWords[Math.floor(Math.random() * uniqueWords.length)];
  
  // Qolgan so'zlardan 3 ta har xil (noto'g'ri) variant tanlaymiz
  const otherWords = uniqueWords.filter(w => w.word.toLowerCase() !== target.word.toLowerCase());
  const shuffledOthers = shuffle(otherWords).slice(0, 3);

  // 4 ta unikal variantni aralashtiramiz
  const options = shuffle([target, ...shuffledOthers]);
  const correctIdx = options.findIndex(o => o.word.toLowerCase() === target.word.toLowerCase());

  const pollOptions = options.map(o => o.word);
  const secTitle = SECTION_LABELS[section] ? `[${SECTION_LABELS[section]}]` : '[Barcha Bo\'limlar]';

  await bot.sendPoll(
    chatId,
    `📝 ${secTitle}\nMa'nosi: "${target.meaning}"\n\nUshbu ma'noga mos keladigan inglizcha so'zni tanlang:`,
    pollOptions,
    {
      is_anonymous: false,
      type: 'quiz',
      correct_option_id: correctIdx,
      explanation: `To'g'ri javob: ${target.word} — ${target.meaning}`,
      parse_mode: 'Markdown'
    }
  );
}

// ---------------------------------------------------------
// HANDLERLAR
// ---------------------------------------------------------
function registerHandlers() {
  if (!bot) return;

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 
      `Assalomu alaykum! *Last Chance Discipline Tracker* botiga xush kelibsiz.\n\n` +
      `Mavjud buyruqlar:\n` +
      `/today - Bugungi reja\n` +
      `/quiz - Bo'limlar bo'yicha test/quiz yechish\n` +
      `/soz <so'z> - Lug'atdan qidirish`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/\/today/, (msg) => {
    sendDailyTasks();
  });

  bot.onText(/\/grammatika/, (msg) => {
    startVocabularyQuiz(msg.chat.id, 'grammar');
  });

  // /quiz buyrug'i yuborilganda inline tugmalar chiqadi
  bot.onText(/\/quiz/, (msg) => {
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📖 Reading', callback_data: 'quiz_reading' },
            { text: '🎧 Listening', callback_data: 'quiz_listening' }
          ],
          [
            { text: '✍️ Writing', callback_data: 'quiz_writing' },
            { text: '🗣 Speaking', callback_data: 'quiz_speaking' }
          ],
          [
            { text: '📐 Grammar', callback_data: 'quiz_grammar' },
            { text: '📚 Hamma bo\'limlar', callback_data: 'quiz_all' }
          ]
        ]
      }
    };
    bot.sendMessage(msg.chat.id, "🎯 **Qaysi bo'lim bo'yicha Quiz yechmoqchisiz?**\nKerakli bo'limni tanlang:", { parse_mode: 'Markdown', ...opts });
  });

  // Inline tugmalar bosilganda ishlaydi
  bot.on('callback_query', async (query) => {
    const data = query.data;
    if (data && data.startsWith('quiz_')) {
      const section = data.replace('quiz_', '');
      await bot.answerCallbackQuery(query.id).catch(() => {});
      await startVocabularyQuiz(query.message.chat.id, section);
    }
  });

  bot.onText(/\/soz (.+)/, (msg, match) => {
    const query = match[1].trim().toLowerCase();
    const rawAll = db.getAllVocabMaterials ? db.getAllVocabMaterials() : [];
    
    // Barcha bo'limlardan toza so'zlarni izlash
    let allWords = [];
    ['reading', 'listening', 'writing', 'speaking', 'grammar', 'vocabulary'].forEach(sec => {
      if (db.getWordsBySection) {
        allWords = allWords.concat(db.getWordsBySection(sec));
      }
    });

    const validWords = getValidWords(allWords);
    const matched = validWords.filter(w => 
      w.word.toLowerCase().includes(query) || 
      w.meaning.toLowerCase().includes(query)
    );

    if (matched.length === 0) {
      bot.sendMessage(msg.chat.id, `🔍 "${query}" bo'yicha hech narsa topilmadi.`);
      return;
    }

    let response = `🔍 *Qidiruv natijalari ("${query}"):*\n\n`;
    matched.slice(0, 10).forEach(w => {
      response += `• *${w.word}* — ${w.meaning}\n`;
    });
    bot.sendMessage(msg.chat.id, response, { parse_mode: 'Markdown' });
  });
}

// ---------------------------------------------------------
// CRON VA TIMEJOBlar
// ---------------------------------------------------------
let timeJobs = {};

function hmToCron(hmStr) {
  if (!hmStr || !hmStr.includes(':')) return '0 3 * * *';
  const [h, m] = hmStr.split(':');
  return `${parseInt(m, 10)} ${parseInt(h, 10)} * * *`;
}

function scheduleTimeJobs() {
  Object.keys(timeJobs).forEach(k => {
    if (timeJobs[k]) timeJobs[k].stop();
  });
  timeJobs = {};

  const s = db.getSettings();
  timeJobs.daily = cron.schedule(hmToCron(s.times.daily), () => sendDailyTasks().catch(console.error), { timezone: TZ });
  timeJobs.vocab = cron.schedule(hmToCron(s.times.vocab), () => checkVocabReminders().catch(console.error), { timezone: TZ });
  timeJobs.evening_review = cron.schedule(hmToCron(s.times.evening_review), () => sendEveningReview().catch(console.error), { timezone: TZ });
  timeJobs.evening_summary = cron.schedule(hmToCron(s.times.evening_summary), () => sendEveningSummary().catch(console.error), { timezone: TZ });
  console.log(`Vaqt asosidagi cron jadval o'rnatildi: ${JSON.stringify(s.times)}`);
}

function rescheduleTimeJobs() {
  if (!bot) return;
  scheduleTimeJobs();
}

function scheduleJobs() {
  if (!bot) { console.log("Bot ishlamayapti, cron jadval o'rnatilmadi."); return; }
  registerHandlers();
  scheduleTimeJobs();
  cron.schedule('0 0 * * 0', () => sendWeeklyReport().catch(console.error), { timezone: TZ });
  cron.schedule('*/30 * * * *', () => checkDueSrsWords().catch(console.error), { timezone: TZ });
  cron.schedule('* * * * *', () => refreshRunningTaskTimers().catch(console.error), { timezone: TZ });
  console.log(`Cron jadval o'rnatildi (timezone: ${TZ}).`);
}

module.exports = {
  scheduleJobs,
  rescheduleTimeJobs,
  sendDailyTasks,
  sendEveningReview,
  sendEveningSummary,
  sendWeeklyReport,
  todayStr,
};
