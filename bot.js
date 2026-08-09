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
  reading: '📖 Reading', listening: '🎧 Listening', writing: '✍️ Writing',
  speaking: '🗣 Speaking', vocabulary: '📚 Vocabulary', grammar: '📐 Grammar',
};
const REMINDER_STAGES = [3, 7, 14, 23, 30];
const OPTION_LETTERS = ['A', 'B', 'C', 'D'];
const snoozeTimers = {};

const SECTION_KINDS = {
  reading: [['content', 'Material'], ['keyword', 'Keyword'], ['vocabulary', 'Vocabulary']],
  listening: [['content', 'Material'], ['keyword', 'Keyword'], ['vocabulary', 'Vocabulary']],
  writing: [['content', 'Material'], ['model_answer', 'Model Answer'], ['vocabulary', 'Vocabulary']],
  speaking: [['content', 'Material'], ['model_answer', 'Model Answer'], ['vocabulary', 'Vocabulary']],
  grammar: [['content', 'Material']],
};

let bot = null;
if (TOKEN && CHAT_ID) {
  bot = new TelegramBot(TOKEN, { polling: true });
} else {
  console.log("⚠️  TELEGRAM_BOT_TOKEN yoki TELEGRAM_CHAT_ID topilmadi — bot ishga tushmadi, faqat sayt ishlaydi.");
}

const conv = { mode: null, uploadSection: null, uploadKind: null };
let activeQuiz = null; // { chatId, questions: [{word,meaning,options,correctIndex}], index, correct, title }
const quizQueue = [];

function todayStr() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}
function daysAgoStr(n) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fmt.format(d);
}
function taskDisplayLabel(task) {
  if (task.custom_task_id) {
    const c = db.getCustomTaskById(task.custom_task_id);
    return c ? `⭐ ${c.title}` : '⭐ Task';
  }
  return SECTION_LABELS[task.section] || task.section;
}
function fmtMinutes(sec) { return Math.round((sec || 0) / 60); }
function fmtClock(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function taskElapsedSeconds(task) {
  let total = task.accumulated_seconds || 0;
  if (task.status === 'in_progress' && task.start_time) {
    total += Math.max(0, Math.round((Date.now() - new Date(task.start_time).getTime()) / 1000));
  }
  return total;
}

// ==========================================================================
// TASK TUGMALARI — vaqt ko'rsatilgan holda
// ==========================================================================
function buildKeyboard(date) {
  const tasks = db.getTasksByDate(date);
  const rows = [];
  tasks.forEach((task) => {
    const label = taskDisplayLabel(task);
    let row = [];
    if (task.status === 'pending') {
      row = [{ text: `▶️ Start — ${label}`, callback_data: `start:${task.id}` }];
    } else if (task.status === 'in_progress') {
      rows.push([{ text: `🔵 ${label} — ${fmtClock(taskElapsedSeconds(task))} ketmoqda`, callback_data: 'noop' }]);
      row = [
        { text: `⏸ Pause`, callback_data: `pause:${task.id}` },
        { text: `⏹ Finish`, callback_data: `finish:${task.id}` },
      ];
    } else if (task.status === 'paused') {
      rows.push([{ text: `⏸ ${label} — ${fmtClock(taskElapsedSeconds(task))} pauzada`, callback_data: 'noop' }]);
      row = [
        { text: `▶️ Resume`, callback_data: `resume:${task.id}` },
        { text: `⏹ Finish`, callback_data: `finish:${task.id}` },
        { text: `🔄`, callback_data: `restart:${task.id}` },
      ];
    } else {
      rows.push([{ text: `✅ ${label} — bajarildi (${fmtMinutes(task.duration_seconds)} daq)`, callback_data: 'noop' }]);
      row = [{ text: `🔄 Qayta boshlash`, callback_data: `restart:${task.id}` }];
    }
    row.push({ text: '🗑', callback_data: `delete:${task.id}` });
    rows.push(row);
  });
  rows.push([{ text: "➕ Yangi task qo'shish", callback_data: 'addtask' }]);
  return { inline_keyboard: rows };
}

async function sendTasksMessage(chatId, headerText) {
  const date = todayStr();
  db.ensureTodayTasks(date);
  const sent = await bot.sendMessage(chatId, headerText, { parse_mode: 'Markdown', reply_markup: buildKeyboard(date) });
  db.getTasksByDate(date).forEach((t) => db.updateTask(t.id, { message_id: sent.message_id }));
  return sent;
}
async function refreshAllTaskMessages(date) {
  const tasks = db.getTasksByDate(date);
  const uniqueMsgIds = [...new Set(tasks.map((t) => t.message_id).filter(Boolean))];
  for (const msgId of uniqueMsgIds) {
    try {
      await bot.editMessageReplyMarkup(buildKeyboard(date), { chat_id: CHAT_ID, message_id: msgId });
    } catch (e) { /* ignore */ }
  }
}
async function refreshRunningTaskTimers() {
  if (!bot) return;
  const date = todayStr();
  const running = db.getTasksByDate(date).filter((t) => t.status === 'in_progress' || t.status === 'paused');
  if (running.length) await refreshAllTaskMessages(date);
}

// ==========================================================================
// CRON XABARLARI
// ==========================================================================
async function sendDailyTasks() {
  if (!bot) return;
  await sendTasksMessage(CHAT_ID, `⏰ *Last Chance* — ${todayStr()}\n\nBugungi tasklar tayyor:`);
}

async function sendEveningSummary() {
  if (!bot) return;
  const date = todayStr();
  const tasks = db.getTasksByDate(date);
  const done = [], unfinished = [], notStarted = [];
  tasks.forEach((t) => {
    const label = taskDisplayLabel(t);
    if (t.status === 'done') done.push(`✅ ${label} — ${fmtMinutes(t.duration_seconds)} daqiqa`);
    else if (t.status === 'in_progress' || t.status === 'paused') unfinished.push(`⏳ ${label} (${fmtClock(taskElapsedSeconds(t))} — tugallanmagan)`);
    else notStarted.push(`❌ ${label}`);
  });
  let text = `🌙 *Kunlik natija* — ${date}\n\n`;
  if (done.length) text += done.join('\n') + '\n\n';
  if (unfinished.length) text += `*Tugallanmagan (Start bosilgan, Finish qilinmagan):*\n` + unfinished.join('\n') + '\n\n';
  if (notStarted.length) text += `*Boshlanmagan tasklar:*\n` + notStarted.join('\n');
  if (!unfinished.length && !notStarted.length) text += `🎉 Barcha tasklar bajarildi! Ajoyib intizom.`;
  const keyboard = (unfinished.length || notStarted.length)
    ? { inline_keyboard: [[{ text: '🔁 1 soatdan keyin eslat', callback_data: 'snooze:evening' }]] }
    : undefined;
  await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

async function checkVocabReminders() {
  if (!bot) return;
  const all = db.getReminderEligibleMaterials();
  const buckets = {};
  for (const n of REMINDER_STAGES) {
    const targetDate = daysAgoStr(n);
    all.filter((m) => m.date === targetDate).forEach((m) => {
      const sent = m.reminders_sent || [];
      if (sent.includes(n)) return;
      const key = `${m.section}|${m.kind}`;
      buckets[key] = buckets[key] || {};
      buckets[key][n] = buckets[key][n] || [];
      buckets[key][n].push(m);
    });
  }
  const keys = Object.keys(buckets);
  if (!keys.length) return;
  let text = `🔁 *So'z/Keyword takrorlash vaqti keldi!*\n\n`;
  const updates = [];
  for (const key of keys) {
    const [section, kind] = key.split('|');
    const kindLabel = kind === 'keyword' ? 'Keyword' : 'Vocabulary';
    text += `${SECTION_LABELS[section]} — ${kindLabel}\n`;
    for (const n of Object.keys(buckets[key])) {
      const items = buckets[key][n];
      text += `  _${n}-kunlik takrorlash:_ ${items.map((m) => m.title || m.original_name).join(', ')}\n`;
      items.forEach((m) => updates.push({ id: m.id, sent: [...(m.reminders_sent || []), Number(n)] }));
    }
    text += '\n';
  }
  await bot.sendMessage(CHAT_ID, text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '🔁 1 soatdan keyin eslat', callback_data: 'snooze:vocab' }]] },
  });
  updates.forEach((u) => db.updateMaterialReminders(u.id, u.sent));
}

async function sendEveningReview() {
  if (!bot) return;
  const pool = [...db.getReminderEligibleMaterials(), ...db.getAllGrammarMaterials()];
  if (!pool.length) return;
  const shuffled = pool.sort(() => Math.random() - 0.5).slice(0, 5);
  let text = `📝 *Kechki takrorlash* (20:30)\n\nQuyidagilarni ko'rib chiqing:\n\n`;
  shuffled.forEach((m, i) => {
    text += `${i + 1}. ${SECTION_LABELS[m.section] || m.section} — *${m.title || m.original_name}* (${m.date})\n`;
  });
  await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
}

async function sendWeeklyReport() {
  if (!bot) return;
  const dateList = [];
  for (let i = 7; i >= 1; i--) dateList.push(daysAgoStr(i));
  const s = db.computeWeeklyStats(dateList);
  let text = `📅 *Haftalik hisobot* (${dateList[0]} — ${dateList[6]})\n\n`;
  text += `✅ Jami bajarilgan tasklar: ${s.totalCompleted}\n`;
  text += `⏱ Jami vaqt: ${Math.floor(s.totalMinutes / 60)} soat ${s.totalMinutes % 60} daqiqa\n`;
  text += `🏆 To'liq bajarilgan kunlar: ${s.fullDays}/7\n\n`;
  text += s.perDay.map((d) => `${d.date}: ${d.done}/${d.total}`).join('\n');
  await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
}

// ==========================================================================
// QUIZ TIZIMI — 4 variantli
// ==========================================================================
function buildMCQuestions(pairs) {
  const shuffledPairs = [...pairs].sort(() => Math.random() - 0.5).slice(0, 10);
  const allMeanings = [...new Set(pairs.map((p) => p.meaning))];
  return shuffledPairs.map((p) => {
    let distractors = allMeanings.filter((m) => m !== p.meaning).sort(() => Math.random() - 0.5).slice(0, 3);
    while (distractors.length < 3) distractors.push("— mos javob yo'q —");
    const options = [...distractors, p.meaning].sort(() => Math.random() - 0.5);
    return { id: p.id || null, word: p.word, meaning: p.meaning, options, correctIndex: options.indexOf(p.meaning) };
  });
}

async function startQuizFromPairs(chatId, pairs, title) {
  if (!bot) return;
  if (!pairs.length) {
    await bot.sendMessage(chatId, `⚠️ *${title}* faylidan so'zlarni ajratib bo'lmadi.`, { parse_mode: 'Markdown' });
    return processQuizQueue();
  }
  const questions = buildMCQuestions(pairs);
  activeQuiz = { chatId, questions, index: 0, correct: 0, title };
  await bot.sendMessage(chatId, `🧠 *Quiz boshlandi:* ${title}\n${questions.length} ta savol, har birida 4 variant.`, { parse_mode: 'Markdown' });
  await askNextQuizQuestion();
}

// SRS (spaced repetition) asosidagi so'z quizi — muvaffaqiyat/xato bo'yicha keyingi
// takrorlash vaqtini moslashtiradi, ketma-ket xato qilingan so'zlarni "qiyin" deb belgilaydi.
async function startSrsQuiz(chatId, words, title) {
  if (!bot || !words.length) return;
  const allMeanings = [...new Set(db.getAllWords().map((w) => w.meaning))];
  const questions = words.map((w) => {
    let distractors = allMeanings.filter((m) => m !== w.meaning).sort(() => Math.random() - 0.5).slice(0, 3);
    while (distractors.length < 3) distractors.push("— mos javob yo'q —");
    const options = [...distractors, w.meaning].sort(() => Math.random() - 0.5);
    return { id: w.id, word: w.word, meaning: w.meaning, options, correctIndex: options.indexOf(w.meaning) };
  });
  activeQuiz = { chatId, questions, index: 0, correct: 0, title };
  await bot.sendMessage(chatId, `🧠 *${title}*\n${questions.length} ta so'z.`, { parse_mode: 'Markdown' });
  await askNextQuizQuestion();
}

async function askNextQuizQuestion() {
  if (!activeQuiz) return;
  const { chatId, questions, index } = activeQuiz;
  if (index >= questions.length) return finishQuiz();
  const q = questions[index];
  const buttons = q.options.map((opt, i) => ([{ text: `${OPTION_LETTERS[i]}) ${opt}`, callback_data: `quizans:${i}` }]));
  buttons.push([{ text: "⏭ O'tkazib yuborish", callback_data: 'quiz_skip' }]);
  await bot.sendMessage(chatId, `${index + 1}/${questions.length}. So'zning ma'nosi nima?\n\n*${q.word}*`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons },
  });
}

async function handleQuizButtonAnswer(selectedIndex) {
  if (!activeQuiz) return;
  const q = activeQuiz.questions[activeQuiz.index];
  const isCorrect = selectedIndex === q.correctIndex;
  if (q.id) db.recordWordAnswer(q.id, isCorrect);
  if (isCorrect) {
    activeQuiz.correct++;
    await bot.sendMessage(activeQuiz.chatId, `✅ To'g'ri!`);
  } else {
    await bot.sendMessage(activeQuiz.chatId, `❌ Noto'g'ri. To'g'ri javob: *${q.meaning}*`, { parse_mode: 'Markdown' });
  }
  activeQuiz.index++;
  await askNextQuizQuestion();
}
async function handleQuizSkip() {
  if (!activeQuiz) return;
  activeQuiz.index++;
  await askNextQuizQuestion();
}
async function finishQuiz() {
  if (!activeQuiz) return;
  const { chatId, correct, questions, title } = activeQuiz;
  await bot.sendMessage(chatId, `🏁 *${title}* quiz tugadi!\nNatija: ${correct}/${questions.length} to'g'ri.`, { parse_mode: 'Markdown' });
  activeQuiz = null;
  await processQuizQueue();
}
async function processQuizQueue() {
  if (activeQuiz || conv.mode || quizQueue.length === 0) return;
  const next = quizQueue.shift();
  const pairs = await extractWordPairs(path.join(uploadDir, next.filename), next.file_type);
  await startQuizFromPairs(CHAT_ID, pairs, next.title || next.original_name);
}

// SRS: muddati kelgan so'zlarni topib, navbatga qo'yadi (2/5/8/... soatlik moslashuvchan interval)
async function checkDueSrsWords() {
  if (!bot) return;
  if (activeQuiz || conv.mode) return;
  const due = db.getDueWords(8);
  if (!due.length) return;
  await startSrsQuiz(CHAT_ID, due, `🔁 Takrorlash vaqti (${due.length} ta so'z)`);
}

// ==========================================================================
// BOTDAN FAYL YUKLASH
// ==========================================================================
async function beginUploadFlow(chatId) {
  conv.mode = 'choosing_upload_section';
  const rows = Object.keys(SECTION_KINDS).map((s) => [{ text: SECTION_LABELS[s], callback_data: `up_sec:${s}` }]);
  await bot.sendMessage(chatId, "📤 Qaysi bo'limga fayl yuklaymiz?", { reply_markup: { inline_keyboard: rows } });
}
async function chooseUploadKind(chatId, section) {
  conv.uploadSection = section;
  const kinds = SECTION_KINDS[section];
  const rows = kinds.map(([kind, label]) => [{ text: label, callback_data: `up_kind:${kind}` }]);
  await bot.sendMessage(chatId, `"${SECTION_LABELS[section]}" — qaysi turga?`, { reply_markup: { inline_keyboard: rows } });
}
async function awaitUploadFile(chatId, kind) {
  conv.uploadKind = kind;
  conv.mode = 'awaiting_upload_file';
  let hint = '';
  if (conv.uploadSection === 'speaking' && kind === 'content') hint = "\n\n🎤 Ovozli xabar (voice) yoki audio fayl ham yuborishingiz mumkin.";
  if (kind === 'vocabulary') hint += "\n\n🖼 So'zlar rasmini (screenshot/foto) ham yuborishingiz mumkin — undan matn avtomatik o'qiladi.";
  await bot.sendMessage(chatId, `📎 Endi faylni (PDF yoki HTML) yuboring.${hint}`);
}

function detectFileType(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (['.mp3', '.m4a', '.ogg', '.oga', '.wav'].includes(ext)) return 'audio';
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return 'image';
  return null;
}

async function saveIncomingFile(chatId, localPath, originalName, section, kind) {
  const ext = path.extname(originalName) || '';
  const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
  const destPath = path.join(uploadDir, uniqueName);
  fs.renameSync(localPath, destPath);
  const fileType = detectFileType(originalName) || 'image';
  const rec = db.addMaterial({
    section, date: todayStr(), kind, file_type: fileType,
    filename: uniqueName, original_name: originalName, title: originalName.replace(/\.[^.]+$/, ''),
  });
  conv.mode = null; conv.uploadSection = null; conv.uploadKind = null;
  await bot.sendMessage(chatId, `✅ Fayl saqlandi: *${rec.title}* (${SECTION_LABELS[section] || section})`, { parse_mode: 'Markdown' });

  const wordEligible = ['vocabulary', 'keyword'].includes(rec.kind) || (section === 'grammar' && rec.kind === 'content');
  if (wordEligible) {
    extractWordPairs(destPath, fileType).then((pairs) => db.addWordsFromMaterial(rec, pairs)).catch((e) => console.error(e.message));
  }
}

// ==========================================================================
// HANDLERLAR
// ==========================================================================
function registerHandlers() {
  if (!bot) return;

  async function showTasksEntry(msg, withWelcome) {
    conv.mode = null;
    activeQuiz = null;
    const s = db.getSettings();
    const header = withWelcome
      ? `✅ *Last Chance* bot ishga tushdi!\n\nHar kuni:\n• ${s.times.daily} — kunlik tasklar\n• ${s.times.vocab} — so'z/keyword eslatmalari\n• ${s.times.evening_review} — kechki takrorlash\n• ${s.times.evening_summary} — kunlik natija\n• Yakshanba 00:00 — haftalik hisobot\n• Har 30 daqiqada — muddati kelgan so'zlar SRS quizi\n\nBuyruqlar: /bugun /stats /mashq /qiyin /grammatika /soz /vaqt /maqsad /yuklash\n\nBugungi tasklar:`
      : `📋 Bugungi tasklar:`;
    await sendTasksMessage(msg.chat.id, header);
  }

  bot.onText(/\/start/, (msg) => showTasksEntry(msg, true));
  bot.onText(/\/bugun/, (msg) => showTasksEntry(msg, false));

  bot.onText(/\/stats/, async (msg) => {
    const s = db.computeStats(todayStr());
    const goal = db.getSettings().daily_goal_minutes;
    const pct = goal ? Math.min(100, Math.round((s.todayMinutes / goal) * 100)) : 0;
    const badgeLine = s.badge ? `${s.badge.emoji} Daraja: *${s.badge.name}*` : "🎗 Daraja: hali yo'q";
    const nextLine = s.nextBadge ? `\n👉 Keyingi (${s.nextBadge.emoji} ${s.nextBadge.name}) gacha: ${s.nextBadge.daysLeft} kun` : '';
    const text = `📊 *Statistika*\n\n🔥 Streak: ${s.streak} kun\n${badgeLine}${nextLine}\n✅ Bugun: ${s.todayDone}/${s.todayTotal}\n🎯 Kunlik maqsad: ${s.todayMinutes}/${goal} daq (${pct}%)\n📈 Jami bajarilgan tasklar: ${s.totalCompleted}\n⏱ Jami vaqt: ${Math.floor(s.totalMinutes / 60)} soat ${s.totalMinutes % 60} daqiqa`;
    await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/qiyin/, async (msg) => {
    if (activeQuiz || conv.mode) return bot.sendMessage(msg.chat.id, "Hozir boshqa amal davom etmoqda, avval uni tugating.");
    const words = db.getDifficultWords(8);
    if (!words.length) return bot.sendMessage(msg.chat.id, "🎉 Hozircha 'qiyin' deb belgilangan so'z yo'q — ketma-ket 2+ marta xato qilingan so'zlar shu yerda chiqadi.");
    await startSrsQuiz(msg.chat.id, words, `⚠️ Qiyin so'zlar (${words.length} ta)`);
  });

  bot.onText(/\/vaqt(?:\s+(.+))?/, async (msg, match) => {
    const s = db.getSettings();
    if (!match[1]) {
      return bot.sendMessage(msg.chat.id,
        `⏰ *Joriy eslatma vaqtlari*\n\n` +
        `Kunlik tasklar: ${s.times.daily}\nSo'z eslatmasi: ${s.times.vocab}\nKechki takrorlash: ${s.times.evening_review}\nKunlik natija: ${s.times.evening_summary}\n\n` +
        `O'zgartirish uchun:\n\`/vaqt 03:00 08:00 20:30 22:00\`\n(tartib: kunlik, so'z, kechki takrorlash, natija)`,
        { parse_mode: 'Markdown' });
    }
    const parts = match[1].trim().split(/\s+/);
    if (parts.length !== 4 || !parts.every((p) => /^\d{1,2}:\d{2}$/.test(p))) {
      return bot.sendMessage(msg.chat.id, "Format noto'g'ri. Masalan: `/vaqt 03:00 08:00 20:30 22:00`", { parse_mode: 'Markdown' });
    }
    db.updateSettings({ times: { daily: parts[0], vocab: parts[1], evening_review: parts[2], evening_summary: parts[3] } });
    rescheduleTimeJobs();
    await bot.sendMessage(msg.chat.id, `✅ Vaqtlar yangilandi: ${parts.join(', ')}`);
  });

  bot.onText(/\/maqsad(?:\s+(\d+))?/, async (msg, match) => {
    const s = db.getSettings();
    if (!match[1]) {
      return bot.sendMessage(msg.chat.id, `🎯 Joriy kunlik maqsad: *${s.daily_goal_minutes} daqiqa*\n\nO'zgartirish uchun: \`/maqsad 90\``, { parse_mode: 'Markdown' });
    }
    db.updateSettings({ daily_goal_minutes: Number(match[1]) });
    await bot.sendMessage(msg.chat.id, `✅ Kunlik maqsad ${match[1]} daqiqaga o'rnatildi.`);
  });

  bot.onText(/\/soz(?:\s+(.+))?/, async (msg, match) => {
    if (!match[1]) return bot.sendMessage(msg.chat.id, "Qidirish uchun: `/soz testament`", { parse_mode: 'Markdown' });
    const results = db.searchWords(match[1].trim()).slice(0, 8);
    if (!results.length) return bot.sendMessage(msg.chat.id, `"${match[1]}" bo'yicha hech narsa topilmadi.`);
    const text = `🔎 *"${match[1]}"* bo'yicha topilganlar:\n\n` +
      results.map((w) => `• *${w.word}* — ${w.meaning} _(${SECTION_LABELS[w.section] || w.section})_`).join('\n');
    await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/grammatika/, async (msg) => {
    if (activeQuiz || conv.mode) return bot.sendMessage(msg.chat.id, "Hozir boshqa amal davom etmoqda, avval uni tugating.");
    const words = db.getWordsBySection('grammar').sort(() => Math.random() - 0.5).slice(0, 10);
    if (!words.length) return bot.sendMessage(msg.chat.id, "Hali grammar bo'yicha so'z/qoida yig'ilmagan. Grammar bo'limiga material yuklang.");
    await startSrsQuiz(msg.chat.id, words, `📐 Grammar quiz (${words.length} ta)`);
  });

  bot.onText(/\/mashq/, async (msg) => {
    if (activeQuiz || conv.mode) return bot.sendMessage(msg.chat.id, "Hozir boshqa amal davom etmoqda, avval uni tugating.");
    const vocabPool = db.getReminderEligibleMaterials().sort(() => Math.random() - 0.5).slice(0, 5);
    const grammarPool = db.getAllGrammarMaterials().sort(() => Math.random() - 0.5).slice(0, 2);
    const files = [...vocabPool, ...grammarPool];
    if (!files.length) return bot.sendMessage(msg.chat.id, "Hali hech qanday vocabulary, keyword yoki grammar fayli yuklanmagan.");
    await bot.sendMessage(msg.chat.id, `🎯 Mashq tayyorlanmoqda, ${files.length} ta fayldan so'zlar yig'ilyapti...`);
    let allPairs = [];
    for (const f of files) allPairs = allPairs.concat(await extractWordPairs(path.join(uploadDir, f.filename), f.file_type));
    await startQuizFromPairs(msg.chat.id, allPairs.sort(() => Math.random() - 0.5), 'Umumiy mashq');
  });

  bot.onText(/\/yuklash/, (msg) => beginUploadFlow(msg.chat.id));

  bot.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;
    if (!data || data === 'noop') return bot.answerCallbackQuery(query.id);

    if (data === 'addtask') {
      conv.mode = 'awaiting_task';
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(chatId,
        "✏️ Yangi task nomini yozib yuboring.\n\nNecha kun davom etishini belgilash uchun:\n`Task nomi | 30`\n\nFaqat nom — bugungi kun uchun bir martalik task.",
        { parse_mode: 'Markdown' });
    }
    if (data.startsWith('snooze:')) {
      const kind = data.split(':')[1];
      await bot.answerCallbackQuery(query.id, { text: '1 soatdan keyin qayta eslatiladi' });
      if (snoozeTimers[kind]) clearTimeout(snoozeTimers[kind]);
      snoozeTimers[kind] = setTimeout(() => {
        delete snoozeTimers[kind];
        if (kind === 'evening') sendEveningSummary().catch(console.error);
        else if (kind === 'vocab') checkVocabReminders().catch(console.error);
      }, 60 * 60 * 1000);
      return;
    }
    if (data === 'quiz_skip') { await bot.answerCallbackQuery(query.id); return handleQuizSkip(); }
    if (data.startsWith('quizans:')) {
      await bot.answerCallbackQuery(query.id);
      return handleQuizButtonAnswer(Number(data.split(':')[1]));
    }
    if (data.startsWith('up_sec:')) { await bot.answerCallbackQuery(query.id); return chooseUploadKind(chatId, data.split(':')[1]); }
    if (data.startsWith('up_kind:')) { await bot.answerCallbackQuery(query.id); return awaitUploadFile(chatId, data.split(':')[1]); }

    const [action, taskIdStr] = data.split(':');
    const task = db.getTaskById(taskIdStr);
    if (!task) return bot.answerCallbackQuery(query.id, { text: 'Task topilmadi' });
    const label = taskDisplayLabel(task);

    if (action === 'start') {
      const updated = db.startTask(task.id);
      await bot.answerCallbackQuery(query.id, { text: updated ? `${label} boshlandi!` : 'Amal bajarilmadi' });
    } else if (action === 'pause') {
      const updated = db.pauseTask(task.id);
      await bot.answerCallbackQuery(query.id, { text: updated ? `${label} pauza qilindi` : 'Amal bajarilmadi' });
    } else if (action === 'resume') {
      const updated = db.resumeTask(task.id);
      await bot.answerCallbackQuery(query.id, { text: updated ? `${label} davom etmoqda` : 'Amal bajarilmadi' });
    } else if (action === 'finish') {
      const updated = db.finishTask(task.id);
      await bot.answerCallbackQuery(query.id, { text: updated ? `${label} yakunlandi! (${fmtMinutes(updated.duration_seconds)} daq)` : 'Amal bajarilmadi' });
    } else if (action === 'restart') {
      db.restartTask(task.id);
      await bot.answerCallbackQuery(query.id, { text: `${label} qayta boshlandi` });
    } else if (action === 'delete') {
      db.deleteTaskInstance(task.id);
      await bot.answerCallbackQuery(query.id, { text: `${label} o'chirildi` });
    } else {
      return bot.answerCallbackQuery(query.id);
    }
    await refreshAllTaskMessages(task.date);
  });

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    if (conv.mode === 'awaiting_task') {
      conv.mode = null;
      const parts = msg.text.split('|').map((s) => s.trim());
      const title = parts[0];
      const days = parts[1] ? Number(parts[1]) : null;
      if (!title) return bot.sendMessage(msg.chat.id, "Task nomi bo'sh bo'lishi mumkin emas.");
      const custom = db.addCustomTask({ title, duration_days: days || null, start_date: todayStr() });
      db.ensureCustomTaskInstance(custom.id, todayStr());
      await bot.sendMessage(msg.chat.id, `✅ Task qo'shildi: *${title}*${days ? ` (${days} kun)` : ' (bir martalik)'}`, { parse_mode: 'Markdown' });
      return sendTasksMessage(msg.chat.id, "Yangilangan tasklar:");
    }

    if (conv.mode === 'awaiting_upload_file') {
      return bot.sendMessage(msg.chat.id, "📎 Iltimos, fayl (PDF/HTML/audio/rasm) yuboring, matn emas.");
    }
  });

  bot.on('document', async (msg) => {
    if (conv.mode !== 'awaiting_upload_file') return;
    const doc = msg.document;
    const fileType = detectFileType(doc.file_name);
    if (!fileType) return bot.sendMessage(msg.chat.id, "Faqat PDF, HTML, audio yoki rasm fayl qabul qilinadi.");
    try {
      const localPath = await bot.downloadFile(doc.file_id, uploadDir);
      await saveIncomingFile(msg.chat.id, localPath, doc.file_name, conv.uploadSection, conv.uploadKind);
    } catch (e) { console.error(e); await bot.sendMessage(msg.chat.id, "Faylni saqlashda xatolik yuz berdi."); }
  });

  bot.on('photo', async (msg) => {
    if (conv.mode !== 'awaiting_upload_file') return;
    try {
      const sizes = msg.photo;
      const best = sizes[sizes.length - 1];
      const localPath = await bot.downloadFile(best.file_id, uploadDir);
      await saveIncomingFile(msg.chat.id, localPath, 'rasm.jpg', conv.uploadSection, conv.uploadKind);
    } catch (e) { console.error(e); await bot.sendMessage(msg.chat.id, "Rasmni saqlashda xatolik yuz berdi."); }
  });

  bot.on('voice', async (msg) => {
    if (conv.mode !== 'awaiting_upload_file') return;
    try {
      const localPath = await bot.downloadFile(msg.voice.file_id, uploadDir);
      await saveIncomingFile(msg.chat.id, localPath, 'ovozli_xabar.ogg', conv.uploadSection, conv.uploadKind);
    } catch (e) { console.error(e); await bot.sendMessage(msg.chat.id, "Ovozli xabarni saqlashda xatolik yuz berdi."); }
  });

  bot.on('audio', async (msg) => {
    if (conv.mode !== 'awaiting_upload_file') return;
    try {
      const name = msg.audio.file_name || 'audio.mp3';
      const localPath = await bot.downloadFile(msg.audio.file_id, uploadDir);
      await saveIncomingFile(msg.chat.id, localPath, name, conv.uploadSection, conv.uploadKind);
    } catch (e) { console.error(e); await bot.sendMessage(msg.chat.id, "Audio faylni saqlashda xatolik yuz berdi."); }
  });
}

function hmToCron(hm) {
  const [h, m] = hm.split(':').map(Number);
  return `${m} ${h} * * *`;
}

const timeJobs = {}; // { daily, vocab, evening_review, evening_summary } -> cron ScheduledTask

function scheduleTimeJobs() {
  Object.values(timeJobs).forEach((job) => job && job.stop());
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
  console.log(`Cron jadval o'rnatildi (timezone: ${TZ}): sozlanadigan vaqtlar (/vaqt bilan o'zgartiriladi), yakshanba 00:00 haftalik, har 30 daq SRS so'z tekshiruvi, har daqiqa vaqt yangilash`);
}

module.exports = {
  bot, scheduleJobs, rescheduleTimeJobs, sendDailyTasks, sendEveningSummary, checkVocabReminders, todayStr,
};
