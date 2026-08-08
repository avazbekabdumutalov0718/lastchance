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
const QUIZ_HOUR_STAGES = [2, 5, 8, 14, 24];

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
let activeQuiz = null;
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
function fmtMinutes(sec) {
  return Math.round((sec || 0) / 60);
}

function buildKeyboard(date) {
  const tasks = db.getTasksByDate(date);
  const rows = [];
  tasks.forEach((task) => {
    const label = taskDisplayLabel(task);
    const isCustom = !!task.custom_task_id;
    let row = [];
    if (task.status === 'pending') {
      row = [{ text: `▶️ Start — ${label}`, callback_data: `start:${task.id}` }];
    } else if (task.status === 'in_progress') {
      rows.push([{ text: `🔵 ${label} — ketmoqda`, callback_data: 'noop' }]);
      row = [
        { text: `⏸ Pause`, callback_data: `pause:${task.id}` },
        { text: `⏹ Finish`, callback_data: `finish:${task.id}` },
      ];
    } else if (task.status === 'paused') {
      rows.push([{ text: `⏸ ${label} — pauzada`, callback_data: 'noop' }]);
      row = [
        { text: `▶️ Resume`, callback_data: `resume:${task.id}` },
        { text: `⏹ Finish`, callback_data: `finish:${task.id}` },
        { text: `🔄`, callback_data: `restart:${task.id}` },
      ];
    } else {
      const mins = fmtMinutes(task.duration_seconds);
      rows.push([{ text: `✅ ${label} — bajarildi (${mins} daq)`, callback_data: 'noop' }]);
      row = [{ text: `🔄 Qayta boshlash`, callback_data: `restart:${task.id}` }];
    }
    if (isCustom) row.push({ text: '🗑', callback_data: `delete:${task.id}` });
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
    else if (t.status === 'in_progress' || t.status === 'paused') unfinished.push(`⏳ ${label} (boshlangan, lekin tugallanmagan)`);
    else notStarted.push(`❌ ${label}`);
  });
  let text = `🌙 *Kunlik natija* — ${date}\n\n`;
  if (done.length) text += done.join('\n') + '\n\n';
  if (unfinished.length) text += `*Tugallanmagan (Start bosilgan, Finish qilinmagan):*\n` + unfinished.join('\n') + '\n\n';
  if (notStarted.length) text += `*Boshlanmagan tasklar:*\n` + notStarted.join('\n');
  if (!unfinished.length && !notStarted.length) text += `🎉 Barcha tasklar bajarildi! Ajoyib intizom.`;
  await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
}

async function checkVocabReminders() {
  if (!bot) return;
  const all = db.getAllVocabMaterials();
  const buckets = {};
  for (const n of REMINDER_STAGES) {
    const targetDate = daysAgoStr(n);
    all.filter((m) => m.date === targetDate).forEach((m) => {
      const sent = m.reminders_sent || [];
      if (sent.includes(n)) return;
      buckets[m.section] = buckets[m.section] || {};
      buckets[m.section][n] = buckets[m.section][n] || [];
      buckets[m.section][n].push(m);
    });
  }
  const sections = Object.keys(buckets);
  if (!sections.length) return;
  let text = `🔁 *So'z takrorlash vaqti keldi!*\n\n`;
  const updates = [];
  for (const section of sections) {
    text += `${SECTION_LABELS[section]}\n`;
    for (const n of Object.keys(buckets[section])) {
      const items = buckets[section][n];
      text += `  _${n}-kunlik takrorlash:_ ${items.map((m) => m.title || m.original_name).join(', ')}\n`;
      items.forEach((m) => updates.push({ id: m.id, sent: [...(m.reminders_sent || []), Number(n)] }));
    }
    text += '\n';
  }
  await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
  updates.forEach((u) => db.updateMaterialReminders(u.id, u.sent));
}

async function sendEveningReview() {
  if (!bot) return;
  const pool = [...db.getAllVocabMaterials(), ...db.getAllGrammarMaterials()];
  if (!pool.length) return;
  const shuffled = pool.sort(() => Math.random() - 0.5).slice(0, 5);
  let text = `📝 *Kechki takrorlash* (20:30)\n\nQuyidagilarni ko'rib chiqing:\n\n`;
  shuffled.forEach((m, i) => {
    text += `${i + 1}. ${SECTION_LABELS[m.section] || m.section} — *${m.title || m.original_name}* (${m.date})\n`;
  });
  await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
}

async function startQuizFromPairs(chatId, pairs, title) {
  if (!bot) return;
  if (!pairs.length) {
    await bot.sendMessage(chatId, `⚠️ *${title}* faylidan so'zlarni ajratib bo'lmadi (format tanilmadi).`, { parse_mode: 'Markdown' });
    return processQuizQueue();
  }
  const shuffled = pairs.sort(() => Math.random() - 0.5).slice(0, 10);
  activeQuiz = { chatId, words: shuffled, index: 0, correct: 0, title };
  conv.mode = 'quiz_active';
  await bot.sendMessage(chatId, `🧠 *Quiz boshlandi:* ${title}\n${shuffled.length} ta so'z.`, { parse_mode: 'Markdown' });
  await askNextQuizQuestion();
}

async function askNextQuizQuestion() {
  if (!activeQuiz) return;
  const { chatId, words, index } = activeQuiz;
  if (index >= words.length) return finishQuiz();
  const w = words[index];
  await bot.sendMessage(chatId, `${index + 1}/${words.length}. *${w.word}* — ma'nosi?`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: "⏭ O'tkazib yuborish", callback_data: 'quiz_skip' }]] },
  });
}

function normalize(s) {
  return (s || '').toLowerCase().trim().replace(/[.,!?;:'"()]/g, '');
}

async function handleQuizAnswer(text) {
  if (!activeQuiz) return;
  const w = activeQuiz.words[activeQuiz.index];
  const userAns = normalize(text);
  const correctAns = normalize(w.meaning);
  const isCorrect = userAns === correctAns || (userAns.length > 2 && (correctAns.includes(userAns) || userAns.includes(correctAns)));
  if (isCorrect) {
    activeQuiz.correct++;
    await bot.sendMessage(activeQuiz.chatId, `✅ To'g'ri!`);
  } else {
    await bot.sendMessage(activeQuiz.chatId, `❌ Noto'g'ri. To'g'ri javob: *${w.meaning}*`, { parse_mode: 'Markdown' });
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
  const { chatId, correct, words, title } = activeQuiz;
  await bot.sendMessage(chatId, `🏁 *${title}* quiz tugadi!\nNatija: ${correct}/${words.length} to'g'ri.`, { parse_mode: 'Markdown' });
  activeQuiz = null;
  conv.mode = null;
  await processQuizQueue();
}

async function processQuizQueue() {
  if (activeQuiz || conv.mode || quizQueue.length === 0) return;
  const next = quizQueue.shift();
  const pairs = await extractWordPairs(path.join(uploadDir, next.filename), next.file_type);
  await startQuizFromPairs(CHAT_ID, pairs, next.title || next.original_name);
}

async function checkPerFileQuizStages() {
  if (!bot) return;
  const all = db.getAllVocabMaterials();
  const now = Date.now();
  for (const m of all) {
    const uploadedAt = new Date(m.created_at).getTime();
    const hoursElapsed = (now - uploadedAt) / (1000 * 60 * 60);
    const sentStages = m.quiz_stages_sent || [];
    for (const stage of QUIZ_HOUR_STAGES) {
      if (hoursElapsed >= stage && !sentStages.includes(stage)) {
        db.updateMaterialQuizStages(m.id, [...sentStages, stage]);
        quizQueue.push(m);
      }
    }
  }
  await processQuizQueue();
}

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
  const hint = conv.uploadSection === 'speaking' && kind === 'content'
    ? "\n\n🎤 Ovozli xabar (voice) yoki audio fayl ham yuborishingiz mumkin."
    : '';
  await bot.sendMessage(chatId, `📎 Endi faylni (PDF yoki HTML) yuboring.${hint}`);
}

function detectFileType(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (['.mp3', '.m4a', '.ogg', '.oga', '.wav'].includes(ext)) return 'audio';
  return null;
}

async function saveIncomingFile(chatId, localPath, originalName, section, kind) {
  const ext = path.extname(originalName) || '';
  const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
  const destPath = path.join(uploadDir, uniqueName);
  fs.renameSync(localPath, destPath);
  const fileType = detectFileType(originalName) || 'audio';
  const rec = db.addMaterial({
    section, date: todayStr(), kind, file_type: fileType,
    filename: uniqueName, original_name: originalName, title: originalName.replace(/\.[^.]+$/, ''),
  });
  conv.mode = null;
  conv.uploadSection = null;
  conv.uploadKind = null;
  await bot.sendMessage(chatId, `✅ Fayl saqlandi: *${rec.title}* (${SECTION_LABELS[section] || section})`, { parse_mode: 'Markdown' });
}

function registerHandlers() {
  if (!bot) return;

  async function showTasksEntry(msg, withWelcome) {
    conv.mode = null;
    activeQuiz = null;
    const header = withWelcome
      ? `✅ *Last Chance* bot ishga tushdi!\n\nHar kuni:\n• 03:00 — kunlik tasklar\n• 08:00 — so'z takrorlash eslatmalari\n• 20:30 — kechki takrorlash\n• 22:00 — kunlik natija\n\nBugungi tasklar:`
      : `📋 Bugungi tasklar:`;
    await sendTasksMessage(msg.chat.id, header);
  }

  bot.onText(/\/start/, (msg) => showTasksEntry(msg, true));
  bot.onText(/\/bugun/, (msg) => showTasksEntry(msg, false));

  bot.onText(/\/stats/, async (msg) => {
    const s = db.computeStats(todayStr());
    const text = `📊 *Statistika*\n\n` +
      `🔥 Streak: ${s.streak} kun\n` +
      `✅ Bugun: ${s.todayDone}/${s.todayTotal} task bajarildi\n` +
      `📈 Jami bajarilgan tasklar: ${s.totalCompleted}\n` +
      `⏱ Jami sarflangan vaqt: ${Math.floor(s.totalMinutes / 60)} soat ${s.totalMinutes % 60} daqiqa`;
    await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/mashq/, async (msg) => {
    if (activeQuiz || conv.mode) {
      return bot.sendMessage(msg.chat.id, "Hozir boshqa amal davom etmoqda, avval uni tugating.");
    }
    const vocabPool = db.getAllVocabMaterials().sort(() => Math.random() - 0.5).slice(0, 5);
    const grammarPool = db.getAllGrammarMaterials().sort(() => Math.random() - 0.5).slice(0, 2);
    const files = [...vocabPool, ...grammarPool];
    if (!files.length) return bot.sendMessage(msg.chat.id, "Hali hech qanday vocabulary yoki grammar fayli yuklanmagan.");
    await bot.sendMessage(msg.chat.id, `🎯 Mashq tayyorlanmoqda, ${files.length} ta fayldan so'zlar yig'ilyapti...`);
    let allPairs = [];
    for (const f of files) {
      const pairs = await extractWordPairs(path.join(uploadDir, f.filename), f.file_type);
      allPairs = allPairs.concat(pairs);
    }
    allPairs = allPairs.sort(() => Math.random() - 0.5);
    await startQuizFromPairs(msg.chat.id, allPairs, 'Umumiy mashq');
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
    if (data === 'quiz_skip') {
      await bot.answerCallbackQuery(query.id);
      return handleQuizSkip();
    }
    if (data.startsWith('up_sec:')) {
      await bot.answerCallbackQuery(query.id);
      return chooseUploadKind(chatId, data.split(':')[1]);
    }
    if (data.startsWith('up_kind:')) {
      await bot.answerCallbackQuery(query.id);
      return awaitUploadFile(chatId, data.split(':')[1]);
    }

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
      if (task.custom_task_id) db.deleteCustomTaskAndToday(task.custom_task_id, task.date);
      await bot.answerCallbackQuery(query.id, { text: `${label} o'chirildi` });
    } else {
      return bot.answerCallbackQuery(query.id);
    }
    await refreshAllTaskMessages(task.date);
  });

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    if (conv.mode === 'quiz_active' && activeQuiz) return handleQuizAnswer(msg.text);

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
      return bot.sendMessage(msg.chat.id, "📎 Iltimos, fayl (PDF/HTML/audio) yuboring, matn emas.");
    }
  });

  bot.on('document', async (msg) => {
    if (conv.mode !== 'awaiting_upload_file') return;
    const doc = msg.document;
    const fileType = detectFileType(doc.file_name);
    if (!fileType) return bot.sendMessage(msg.chat.id, "Faqat PDF, HTML yoki audio fayl qabul qilinadi.");
    try {
      const localPath = await bot.downloadFile(doc.file_id, uploadDir);
      await saveIncomingFile(msg.chat.id, localPath, doc.file_name, conv.uploadSection, conv.uploadKind);
    } catch (e) {
      console.error(e);
      await bot.sendMessage(msg.chat.id, "Faylni saqlashda xatolik yuz berdi.");
    }
  });

  bot.on('voice', async (msg) => {
    if (conv.mode !== 'awaiting_upload_file') return;
    try {
      const localPath = await bot.downloadFile(msg.voice.file_id, uploadDir);
      await saveIncomingFile(msg.chat.id, localPath, 'ovozli_xabar.ogg', conv.uploadSection, conv.uploadKind);
    } catch (e) {
      console.error(e);
      await bot.sendMessage(msg.chat.id, "Ovozli xabarni saqlashda xatolik yuz berdi.");
    }
  });

  bot.on('audio', async (msg) => {
    if (conv.mode !== 'awaiting_upload_file') return;
    try {
      const name = msg.audio.file_name || 'audio.mp3';
      const localPath = await bot.downloadFile(msg.audio.file_id, uploadDir);
      await saveIncomingFile(msg.chat.id, localPath, name, conv.uploadSection, conv.uploadKind);
    } catch (e) {
      console.error(e);
      await bot.sendMessage(msg.chat.id, "Audio faylni saqlashda xatolik yuz berdi.");
    }
  });
}

function scheduleJobs() {
  if (!bot) { console.log("Bot ishlamayapti, cron jadval o'rnatilmadi."); return; }
  registerHandlers();
  cron.schedule('0 3 * * *', () => sendDailyTasks().catch(console.error), { timezone: TZ });
  cron.schedule('0 8 * * *', () => checkVocabReminders().catch(console.error), { timezone: TZ });
  cron.schedule('30 20 * * *', () => sendEveningReview().catch(console.error), { timezone: TZ });
  cron.schedule('0 22 * * *', () => sendEveningSummary().catch(console.error), { timezone: TZ });
  cron.schedule('*/15 * * * *', () => checkPerFileQuizStages().catch(console.error), { timezone: TZ });
  console.log(`Cron jadval o'rnatildi (timezone: ${TZ}): 03:00 tasklar, 08:00 vocab eslatma, 20:30 kechki takrorlash, 22:00 natija, har 15 daq fayl-quiz tekshiruvi`);
}

module.exports = { bot, scheduleJobs, sendDailyTasks, sendEveningSummary, checkVocabReminders, todayStr };
