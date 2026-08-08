const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const db = require('./db');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TZ = process.env.TIMEZONE || 'Asia/Tashkent';

const SECTION_LABELS = {
  reading: '📖 Reading',
  listening: '🎧 Listening',
  writing: '✍️ Writing',
  speaking: '🗣 Speaking',
  vocabulary: '📚 Vocabulary',
  grammar: '📐 Grammar',
};
const REMINDER_STAGES = [3, 7, 14, 23, 30];

let bot = null;
if (TOKEN && CHAT_ID) {
  bot = new TelegramBot(TOKEN, { polling: true });
} else {
  console.log("⚠️  TELEGRAM_BOT_TOKEN yoki TELEGRAM_CHAT_ID topilmadi — bot ishga tushmadi, faqat sayt ishlaydi.");
}

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

function buildKeyboard(date) {
  const tasks = db.getTasksByDate(date);
  const rows = tasks.map((task) => {
    const label = taskDisplayLabel(task);
    if (task.status === 'pending') {
      return [{ text: `▶️ Start — ${label}`, callback_data: `start:${task.id}` }];
    } else if (task.status === 'in_progress') {
      return [{ text: `⏹ Finish — ${label} (ketmoqda...)`, callback_data: `finish:${task.id}` }];
    } else {
      const mins = Math.round((task.duration_seconds || 0) / 60);
      return [{ text: `✅ ${label} — bajarildi (${mins} daq)`, callback_data: 'noop' }];
    }
  });
  return { inline_keyboard: rows };
}

async function sendDailyTasks() {
  if (!bot) return;
  const date = todayStr();
  db.ensureTodayTasks(date);

  const text = `⏰ *Last Chance* — ${date}\n\nBugungi tasklar tayyor. Har birini boshlash uchun tugmani bosing:`;
  const msg = await bot.sendMessage(CHAT_ID, text, {
    parse_mode: 'Markdown',
    reply_markup: buildKeyboard(date),
  });
  db.getTasksByDate(date).forEach((t) => db.updateTask(t.id, { message_id: msg.message_id }));
}

async function refreshKeyboard(date, messageId) {
  if (!bot) return;
  try {
    await bot.editMessageReplyMarkup(buildKeyboard(date), { chat_id: CHAT_ID, message_id: messageId });
  } catch (e) {
    // "message not modified" kabi xatolarni e'tiborsiz qoldiramiz
  }
}

async function sendEveningSummary() {
  if (!bot) return;
  const date = todayStr();
  const tasks = db.getTasksByDate(date);

  let done = [];
  let missed = [];
  tasks.forEach((t) => {
    const label = taskDisplayLabel(t);
    if (t.status === 'done') {
      const mins = Math.round((t.duration_seconds || 0) / 60);
      done.push(`✅ ${label} — ${mins} daqiqa`);
    } else {
      missed.push(`❌ ${label}`);
    }
  });

  let text = `🌙 *Kunlik natija* — ${date}\n\n`;
  text += done.length ? done.join('\n') + '\n\n' : '';
  if (missed.length) {
    text += `*Qolib ketgan tasklar:*\n` + missed.join('\n');
  } else {
    text += `🎉 Barcha tasklar bajarildi! Ajoyib intizom.`;
  }

  await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
}

async function checkVocabReminders() {
  if (!bot) return;
  const all = db.getAllVocabMaterials();
  const buckets = {}; // section -> stage -> [materials]

  for (const n of REMINDER_STAGES) {
    const targetDate = daysAgoStr(n);
    const items = all.filter((m) => m.date === targetDate);
    for (const m of items) {
      const sent = m.reminders_sent || [];
      if (sent.includes(n)) continue;
      if (!buckets[m.section]) buckets[m.section] = {};
      if (!buckets[m.section][n]) buckets[m.section][n] = [];
      buckets[m.section][n].push(m);
    }
  }

  const sections = Object.keys(buckets);
  if (sections.length === 0) return;

  let text = `🔁 *So'z takrorlash vaqti keldi!*\n\n`;
  const updates = [];

  for (const section of sections) {
    text += `${SECTION_LABELS[section]}\n`;
    for (const n of Object.keys(buckets[section])) {
      const items = buckets[section][n];
      const names = items.map((m) => m.title || m.original_name).join(', ');
      text += `  _${n}-kunlik takrorlash:_ ${names}\n`;
      items.forEach((m) => {
        const sent = [...(m.reminders_sent || []), Number(n)];
        updates.push({ id: m.id, sent });
      });
    }
    text += '\n';
  }

  await bot.sendMessage(CHAT_ID, text, { parse_mode: 'Markdown' });
  updates.forEach((u) => db.updateMaterialReminders(u.id, u.sent));
}

function registerCallbacks() {
  if (!bot) return;
  bot.on('callback_query', async (query) => {
    const data = query.data;
    if (!data || data === 'noop') return bot.answerCallbackQuery(query.id);

    const [action, taskIdStr] = data.split(':');
    const task = db.getTaskById(taskIdStr);
    if (!task) return bot.answerCallbackQuery(query.id, { text: 'Task topilmadi' });
    const label = taskDisplayLabel(task);

    if (action === 'start') {
      if (task.status !== 'pending') {
        return bot.answerCallbackQuery(query.id, { text: 'Bu task allaqachon boshlangan yoki tugagan' });
      }
      db.updateTask(task.id, { status: 'in_progress', start_time: new Date().toISOString() });
      await bot.answerCallbackQuery(query.id, { text: `${label} boshlandi!` });
    } else if (action === 'finish') {
      if (task.status !== 'in_progress') {
        return bot.answerCallbackQuery(query.id, { text: 'Bu task hali boshlanmagan' });
      }
      const start = new Date(task.start_time);
      const finish = new Date();
      const durationSeconds = Math.max(0, Math.round((finish - start) / 1000));
      db.updateTask(task.id, { status: 'done', finish_time: finish.toISOString(), duration_seconds: durationSeconds });
      await bot.answerCallbackQuery(query.id, { text: `${label} yakunlandi! (${Math.round(durationSeconds / 60)} daq)` });
    }

    const refreshed = db.getTaskById(task.id);
    if (refreshed && refreshed.message_id) await refreshKeyboard(refreshed.date, refreshed.message_id);
  });
}

function scheduleJobs() {
  if (!bot) { console.log('Bot ishlamayapti, cron jadval o\'rnatilmadi.'); return; }
  registerCallbacks();
  cron.schedule('0 3 * * *', () => { sendDailyTasks().catch(console.error); }, { timezone: TZ });
  cron.schedule('0 22 * * *', () => { sendEveningSummary().catch(console.error); }, { timezone: TZ });
  cron.schedule('0 8 * * *', () => { checkVocabReminders().catch(console.error); }, { timezone: TZ });
  console.log(`Cron jadval o'rnatildi (timezone: ${TZ}): 03:00 tasklar, 08:00 vocab eslatma, 22:00 natija`);
}

module.exports = { bot, scheduleJobs, sendDailyTasks, sendEveningSummary, checkVocabReminders, todayStr };
