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
  const a = new Date(dateA + 'T00:00:00Z').getTime();
  const b = new Date(dateB + 'T00:00:00Z').getTime();
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
}

// ==================================================================
// CUSTOM TASKS
// ==================================================================
function addCustomTask({ title, duration_days, start_date }) {
  const rec = {
    id: nextId('custom_tasks'),
    title,
    start_date,
    duration_days: duration_days || null,
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
// TASKS — pending -> in_progress <-> paused -> done, + restart
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
function newTaskRecord(fields) {
  return {
    id: nextId('tasks'), section: null, custom_task_id: null, date: null,
    status: 'pending', start_time: null, finish_time: null,
    duration_seconds: null, accumulated_seconds: 0, message_id: null,
    ...fields,
  };
}
function ensureStandardTask(section, date) {
  let t = getStandardTask(section, date);
  if (!t) {
    t = newTaskRecord({ section, date });
    state.tasks.push(t);
    save();
  }
  return t;
}
function ensureCustomTaskInstance(customTaskId, date) {
  let t = state.tasks.find((x) => x.custom_task_id === Number(customTaskId) && x.date === date);
  if (!t) {
    t = newTaskRecord({ custom_task_id: Number(customTaskId), date });
    state.tasks.push(t);
    save();
  }
  return t;
}
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

function startTask(id) {
  const t = getTaskById(id);
  if (!t || t.status !== 'pending') return null;
  return updateTask(id, { status: 'in_progress', start_time: new Date().toISOString(), accumulated_seconds: 0 });
}
function pauseTask(id) {
  const t = getTaskById(id);
  if (!t || t.status !== 'in_progress') return null;
  const elapsed = Math.max(0, Math.round((Date.now() - new Date(t.start_time).getTime()) / 1000));
  return updateTask(id, { status: 'paused', start_time: null, accumulated_seconds: (t.accumulated_seconds || 0) + elapsed });
}
function resumeTask(id) {
  const t = getTaskById(id);
  if (!t || t.status !== 'paused') return null;
  return updateTask(id, { status: 'in_progress', start_time: new Date().toISOString() });
}
function finishTask(id) {
  const t = getTaskById(id);
  if (!t || (t.status !== 'in_progress' && t.status !== 'paused')) return null;
  let total = t.accumulated_seconds || 0;
  if (t.status === 'in_progress') {
    total += Math.max(0, Math.round((Date.now() - new Date(t.start_time).getTime()) / 1000));
  }
  return updateTask(id, { status: 'done', start_time: null, finish_time: new Date().toISOString(), duration_seconds: total });
}
function restartTask(id) {
  return updateTask(id, {
    status: 'pending', start_time: null, finish_time: null,
    duration_seconds: null, accumulated_seconds: 0,
  });
}
function deleteCustomTaskAndToday(customTaskId, date) {
  deactivateCustomTask(customTaskId);
  state.tasks = state.tasks.filter((t) => !(t.custom_task_id === Number(customTaskId) && t.date === date));
  save();
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
// STATISTIKA
// ==================================================================
function computeStats(todayStr) {
  const doneTasks = state.tasks.filter((t) => t.status === 'done');
  const totalMinutes = Math.round(doneTasks.reduce((sum, t) => sum + (t.duration_seconds || 0), 0) / 60);
  const todayTasks = getTasksByDate(todayStr);
  const todayDone = todayTasks.filter((t) => t.status === 'done').length;

  // streak: nechta kun ketma-ket barcha STANDARD tasklar bajarilgan (bugundan orqaga)
  let streak = 0;
  let cursor = todayStr;
  // agar bugun hali tugallanmagan bo'lsa, kechadan boshlab hisoblaymiz
  const todayAllDone = STANDARD_SECTIONS.every((s) => {
    const t = getStandardTask(s, todayStr);
    return t && t.status === 'done';
  });
  if (!todayAllDone) {
    cursor = new Date(new Date(todayStr + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
  }
  // eslatma: cheksiz aylanishning oldini olish uchun 400 kun bilan cheklaymiz
  for (let i = 0; i < 400; i++) {
    const allDone = STANDARD_SECTIONS.every((s) => {
      const t = getStandardTask(s, cursor);
      return t && t.status === 'done';
    });
    if (!allDone) break;
    streak++;
    cursor = new Date(new Date(cursor + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
  }

  return {
    totalCompleted: doneTasks.length,
    totalMinutes,
    todayDone,
    todayTotal: todayTasks.length,
    streak,
  };
}

// ==================================================================
// MATERIALS (Content / Keyword / Model Answer / Vocabulary — fayl)
// ==================================================================
function addMaterial(m) {
  const rec = {
    id: nextId('materials'), created_at: new Date().toISOString(),
    reminders_sent: [], quiz_stages_sent: [], ...m,
  };
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
function getAllGrammarMaterials() {
  return state.materials.filter((m) => m.section === 'grammar' && m.kind === 'content');
}
function updateMaterialReminders(id, remindersSent) {
  const m = state.materials.find((m) => m.id === Number(id));
  if (m) { m.reminders_sent = remindersSent; save(); }
}
function updateMaterialQuizStages(id, stagesSent) {
  const m = state.materials.find((m) => m.id === Number(id));
  if (m) { m.quiz_stages_sent = stagesSent; save(); }
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
  ensureTodayTasks, updateTask, startTask, pauseTask, resumeTask, finishTask, restartTask,
  deleteCustomTaskAndToday, allTasksHistory, taskLabel, computeStats,
  addMaterial, getMaterials, getMaterialById, deleteMaterial, getAllVocabMaterials, getAllGrammarMaterials,
  updateMaterialReminders, updateMaterialQuizStages,
  upsertResult, getResultsByDate,
};
