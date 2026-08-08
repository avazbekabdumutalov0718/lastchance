const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const filePath = path.join(dataDir, 'lastchance.json');

function loadRaw() {
  if (!fs.existsSync(filePath)) {
    const initial = { tasks: [], materials: [], daily_results: [], custom_tasks: [], _seq: {} };
    fs.writeFileSync(filePath, JSON.stringify(initial, null, 2));
    return initial;
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  parsed.tasks = parsed.tasks || [];
  parsed.materials = parsed.materials || [];
  parsed.daily_results = parsed.daily_results || [];
  parsed.custom_tasks = parsed.custom_tasks || [];
  parsed._seq = parsed._seq || {};
  return parsed;
}

const state = loadRaw();

function save() {
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

function nextId(table) {
  state._seq[table] = (state._seq[table] || 0) + 1;
  save();
  return state._seq[table];
}

function diffDays(dateA, dateB) {
  // dateA - dateB, in whole days, both 'YYYY-MM-DD'
  const a = new Date(dateA + 'T00:00:00Z').getTime();
  const b = new Date(dateB + 'T00:00:00Z').getTime();
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

// ==================================================================
// CUSTOM TASKS (foydalanuvchi o'zi qo'shadigan tasklar, N kun davomida)
// ==================================================================
function addCustomTask({ title, duration_days, start_date }) {
  const rec = {
    id: nextId('custom_tasks'),
    title,
    start_date,
    duration_days: duration_days || null, // null => faqat bitta kunlik
    active: true,
  };
  state.custom_tasks.push(rec);
  save();
  return rec;
}
function getActiveCustomTasks() {
  return state.custom_tasks.filter((c) => c.active);
}
function getCustomTaskById(id) {
  return state.custom_tasks.find((c) => c.id === Number(id));
}
function deactivateCustomTask(id) {
  const c = getCustomTaskById(id);
  if (c) { c.active = false; save(); }
  return c;
}
function customTaskAppliesToDate(customTask, date) {
  const offset = diffDays(date, customTask.start_date);
  if (offset < 0) return false;
  if (customTask.duration_days == null) return offset === 0;
  return offset < customTask.duration_days;
}

// ==================================================================
// TASKS (kunlik instansiyalar: 6 ta standart + custom tasklar)
// ==================================================================
const STANDARD_SECTIONS = ['reading', 'listening', 'writing', 'speaking', 'vocabulary', 'grammar'];

function getTasksByDate(date) {
  return state.tasks.filter((t) => t.date === date);
}
function getTaskById(id) {
  return state.tasks.find((t) => t.id === Number(id));
}
function getStandardTask(section, date) {
  return state.tasks.find((t) => t.section === section && t.date === date && !t.custom_task_id);
}
function ensureStandardTask(section, date) {
  let t = getStandardTask(section, date);
  if (!t) {
    t = {
      id: nextId('tasks'), section, custom_task_id: null, date, status: 'pending',
      start_time: null, finish_time: null, duration_seconds: null, message_id: null,
    };
    state.tasks.push(t);
    save();
  }
  return t;
}
function ensureCustomTaskInstance(customTaskId, date) {
  let t = state.tasks.find((x) => x.custom_task_id === Number(customTaskId) && x.date === date);
  if (!t) {
    t = {
      id: nextId('tasks'), section: null, custom_task_id: Number(customTaskId), date, status: 'pending',
      start_time: null, finish_time: null, duration_seconds: null, message_id: null,
    };
    state.tasks.push(t);
    save();
  }
  return t;
}
// Bugungi barcha tasklarni (standart 6 ta + faol custom tasklar) yaratib, ro'yxatini qaytaradi.
function ensureTodayTasks(date) {
  STANDARD_SECTIONS.forEach((s) => ensureStandardTask(s, date));
  getActiveCustomTasks().forEach((c) => {
    if (customTaskAppliesToDate(c, date)) ensureCustomTaskInstance(c.id, date);
  });
  return getTasksByDate(date);
}
function updateTask(id, fields) {
  const t = getTaskById(id);
  if (t) { Object.assign(t, fields); save(); }
  return t;
}
function allTasksHistory(limit = 200) {
  return [...state.tasks].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}
function taskLabel(task) {
  if (task.custom_task_id) {
    const c = getCustomTaskById(task.custom_task_id);
    return c ? c.title : 'Task';
  }
  return task.section;
}

// ==================================================================
// MATERIALS (Content / Keyword / Model Answer / Vocabulary — hammasi fayl)
// ==================================================================
function addMaterial(m) {
  const rec = { id: nextId('materials'), created_at: new Date().toISOString(), reminders_sent: [], ...m };
  state.materials.push(rec);
  save();
  return rec;
}
function getMaterials(section, kind) {
  let rows = state.materials.filter((m) => m.section === section);
  if (kind) rows = rows.filter((m) => m.kind === kind);
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}
function getMaterialById(id) {
  return state.materials.find((m) => m.id === Number(id));
}
function deleteMaterial(id) {
  state.materials = state.materials.filter((m) => m.id !== Number(id));
  save();
}
function getAllVocabMaterials() {
  return state.materials.filter((m) => m.kind === 'vocabulary');
}
function updateMaterialReminders(id, remindersSent) {
  const m = state.materials.find((m) => m.id === Number(id));
  if (m) { m.reminders_sent = remindersSent; save(); }
}

// ==================================================================
// DAILY RESULTS
// ==================================================================
function upsertResult(date, section, notes) {
  let r = state.daily_results.find((r) => r.date === date && r.section === section);
  if (r) { r.notes = notes; } else {
    r = { id: nextId('daily_results'), date, section, notes };
    state.daily_results.push(r);
  }
  save();
  return r;
}
function getResultsByDate(date) {
  return state.daily_results.filter((r) => r.date === date);
}

module.exports = {
  STANDARD_SECTIONS, diffDays,
  addCustomTask, getActiveCustomTasks, getCustomTaskById, deactivateCustomTask, customTaskAppliesToDate,
  getTasksByDate, getTaskById, getStandardTask, ensureStandardTask, ensureCustomTaskInstance,
  ensureTodayTasks, updateTask, allTasksHistory, taskLabel,
  addMaterial, getMaterials, getMaterialById, deleteMaterial, getAllVocabMaterials, updateMaterialReminders,
  upsertResult, getResultsByDate,
};
