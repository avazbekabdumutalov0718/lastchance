const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const filePath = path.join(dataDir, 'lastchance.json');

const STANDARD_SECTIONS = ['reading', 'listening', 'writing', 'speaking', 'vocabulary', 'grammar'];

function loadRaw() {
  if (!fs.existsSync(filePath)) {
    const initial = {
      tasks: [], materials: [], daily_results: [], custom_tasks: [], words: [],
      settings: { daily_goal_minutes: 120, times: { daily: '03:00', vocab: '08:00', evening_review: '20:30', evening_summary: '22:00' } },
      _seq: {},
    };
    fs.writeFileSync(filePath, JSON.stringify(initial, null, 2));
    return initial;
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  parsed.tasks = parsed.tasks || [];
  parsed.materials = parsed.materials || [];
  parsed.daily_results = parsed.daily_results || [];
  parsed.custom_tasks = parsed.custom_tasks || [];
  parsed.words = parsed.words || [];
  parsed.settings = parsed.settings || { daily_goal_minutes: 120, times: { daily: '03:00', vocab: '08:00', evening_review: '20:30', evening_summary: '22:00' } };
  parsed.settings.times = parsed.settings.times || { daily: '03:00', vocab: '08:00', evening_review: '20:30', evening_summary: '22:00' };
  return parsed;
}

function saveRaw(data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function nextId(data, key) {
  data._seq = data._seq || {};
  data._seq[key] = (data._seq[key] || 0) + 1;
  return data._seq[key];
}

function diffDays(d1, d2) {
  const a = new Date(d1 + 'T00:00:00Z');
  const b = new Date(d2 + 'T00:00:00Z');
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function taskLabel(t) {
  if (t.title) return t.title;
  const labels = {
    reading: '📖 Reading Passages', listening: '🎧 Listening Practice',
    writing: '✍️ Writing Essay', speaking: '🗣 Speaking Practice',
    vocabulary: '📚 Vocabulary Words', grammar: '📐 Grammar Lesson',
  };
  return labels[t.section] || t.section;
}

function customTaskAppliesToDate(ct, dateStr) {
  if (!ct.active) return false;
  const diff = diffDays(ct.start_date, dateStr);
  if (diff < 0) return false;
  if (ct.days_count && diff >= ct.days_count) return false;
  return true;
}

function ensureStandardTask(data, dateStr, section) {
  let found = data.tasks.find((t) => t.date === dateStr && t.section === section && !t.custom_task_id);
  if (!found) {
    found = {
      id: nextId(data, 'tasks'),
      date: dateStr,
      section,
      title: '',
      status: 'pending',
      start_time: null,
      end_time: null,
      duration_seconds: 0,
    };
    data.tasks.push(found);
  }
  return found;
}

function ensureCustomTaskInstance(data, dateStr, ct) {
  let found = data.tasks.find((t) => t.date === dateStr && t.custom_task_id === ct.id);
  if (!found) {
    found = {
      id: nextId(data, 'tasks'),
      date: dateStr,
      section: ct.section || 'vocabulary',
      title: ct.title,
      custom_task_id: ct.id,
      status: 'pending',
      start_time: null,
      end_time: null,
      duration_seconds: 0,
    };
    data.tasks.push(found);
  }
  return found;
}

function ensureTodayTasks(dateStr) {
  const data = loadRaw();
  STANDARD_SECTIONS.forEach((sec) => ensureStandardTask(data, dateStr, sec));
  (data.custom_tasks || []).forEach((ct) => {
    if (customTaskAppliesToDate(ct, dateStr)) {
      ensureCustomTaskInstance(data, dateStr, ct);
    }
  });
  saveRaw(data);
}

function getTasksByDate(dateStr) {
  ensureTodayTasks(dateStr);
  const data = loadRaw();
  return data.tasks.filter((t) => t.date === dateStr);
}

function getTaskById(id) {
  const data = loadRaw();
  return data.tasks.find((t) => t.id === Number(id));
}

function updateTask(id, patch) {
  const data = loadRaw();
  const idx = data.tasks.findIndex((t) => t.id === Number(id));
  if (idx === -1) return null;
  data.tasks[idx] = { ...data.tasks[idx], ...patch };
  saveRaw(data);
  return data.tasks[idx];
}

function startTask(id) {
  return updateTask(id, { status: 'in_progress', start_time: new Date().toISOString() });
}

function pauseTask(id, elapsedSec) {
  const task = getTaskById(id);
  if (!task) return null;
  const newDur = (task.duration_seconds || 0) + (elapsedSec || 0);
  return updateTask(id, { status: 'pending', start_time: null, duration_seconds: newDur });
}

function resumeTask(id) {
  return updateTask(id, { status: 'in_progress', start_time: new Date().toISOString() });
}

function finishTask(id, totalSec) {
  return updateTask(id, {
    status: 'done',
    end_time: new Date().toISOString(),
    duration_seconds: Math.round(totalSec || 0),
  });
}

function restartTask(id) {
  return updateTask(id, { status: 'pending', start_time: null, end_time: null, duration_seconds: 0 });
}

function addCustomTask(title, days_count, section, start_date) {
  const data = loadRaw();
  const ct = {
    id: nextId(data, 'custom_tasks'),
    title,
    days_count: days_count ? Number(days_count) : null,
    section: section || 'vocabulary',
    start_date: start_date || new Date().toISOString().slice(0, 10),
    active: true,
  };
  data.custom_tasks.push(ct);
  saveRaw(data);
  return ct;
}

function getActiveCustomTasks() {
  const data = loadRaw();
  return (data.custom_tasks || []).filter((ct) => ct.active);
}

function getCustomTaskById(id) {
  const data = loadRaw();
  return (data.custom_tasks || []).find((ct) => ct.id === Number(id));
}

function deactivateCustomTask(id) {
  const data = loadRaw();
  const ct = (data.custom_tasks || []).find((c) => c.id === Number(id));
  if (ct) {
    ct.active = false;
    saveRaw(data);
  }
}

function deleteCustomTaskAndToday(id, dateStr) {
  deactivateCustomTask(id);
  const data = loadRaw();
  data.tasks = data.tasks.filter((t) => !(t.custom_task_id === Number(id) && t.date === dateStr));
  saveRaw(data);
}

function deleteTaskInstance(id) {
  const data = loadRaw();
  data.tasks = data.tasks.filter((t) => t.id !== Number(id));
  saveRaw(data);
}

function allTasksHistory() {
  return loadRaw().tasks;
}

function computeStats(dateStr) {
  const tasks = getTasksByDate(dateStr);
  const done = tasks.filter((t) => t.status === 'done');
  const totalSec = done.reduce((sum, t) => sum + (t.duration_seconds || 0), 0);
  return {
    totalTasks: tasks.length,
    completedTasks: done.length,
    totalMinutes: Math.round(totalSec / 60),
    percent: tasks.length > 0 ? Math.round((done.length / tasks.length) * 100) : 0,
  };
}

function addMaterial(item) {
  const data = loadRaw();
  const m = {
    id: nextId(data, 'materials'),
    date: item.date,
    section: item.section,
    kind: item.kind,
    title: item.title || '',
    text_content: item.text_content || '',
    file_path: item.file_path || '',
    reminder_stage_index: 0,
    quiz_stage_index: 0,
  };
  data.materials.push(m);

  if (item.parsed_words && Array.isArray(item.parsed_words)) {
    data.words = data.words || [];
    item.parsed_words.forEach((pw) => {
      if (pw.word && pw.meaning && pw.word !== 'undefined' && pw.meaning !== 'undefined') {
        data.words.push({
          id: nextId(data, 'words'),
          material_id: m.id,
          section: item.section,
          word: pw.word,
          meaning: pw.meaning,
        });
      }
    });
  }
  saveRaw(data);
  return m;
}

function getMaterials(section, dateStr, kind) {
  const data = loadRaw();
  return data.materials.filter((m) => {
    if (m.section !== section) return false;
    if (dateStr && m.date !== dateStr) return false;
    if (kind && m.kind !== kind) return false;
    return true;
  });
}

function getMaterialById(id) {
  const data = loadRaw();
  return data.materials.find((m) => m.id === Number(id));
}

function deleteMaterial(id) {
  const data = loadRaw();
  data.materials = data.materials.filter((m) => m.id !== Number(id));
  data.words = (data.words || []).filter((w) => w.material_id !== Number(id));
  saveRaw(data);
}

function getAllVocabMaterials() {
  const data = loadRaw();
  return (data.materials || []).filter((m) => m.kind === 'vocabulary');
}

function getAllGrammarMaterials() {
  const data = loadRaw();
  return (data.materials || []).filter((m) => m.section === 'grammar');
}

function getReminderEligibleMaterials() {
  const data = loadRaw();
  const stages = [3, 7, 14, 23, 30];
  const today = new Date().toISOString().slice(0, 10);
  const eligible = [];

  (data.materials || []).forEach((m) => {
    if (m.kind !== 'vocabulary') return;
    const idx = m.reminder_stage_index || 0;
    if (idx >= stages.length) return;
    const targetDays = stages[idx];
    const diff = diffDays(m.date, today);
    if (diff === targetDays) {
      eligible.push({ ...m, stage_days: targetDays });
    }
  });

  return eligible;
}

function updateMaterialReminders(id, newIndex) {
  const data = loadRaw();
  const m = data.materials.find((x) => x.id === Number(id));
  if (m) {
    m.reminder_stage_index = newIndex;
    saveRaw(data);
  }
}

function updateMaterialQuizStages(id, newIndex) {
  const data = loadRaw();
  const m = data.materials.find((x) => x.id === Number(id));
  if (m) {
    m.quiz_stage_index = newIndex;
    saveRaw(data);
  }
}

function upsertResult(dateStr, section, notes, imageFilename, score) {
  const data = loadRaw();
  let found = data.daily_results.find((r) => r.date === dateStr && r.section === section);
  if (found) {
    if (notes !== undefined) found.notes = notes;
    if (imageFilename !== undefined) found.image = imageFilename;
    if (score !== undefined) found.score = score;
  } else {
    found = {
      id: nextId(data, 'daily_results'),
      date: dateStr,
      section,
      notes: notes || '',
      image: imageFilename || null,
      score: score || '',
    };
    data.daily_results.push(found);
  }
  saveRaw(data);
  return found;
}

function getResultsByDate(dateStr) {
  const data = loadRaw();
  return data.daily_results.filter((r) => r.date === dateStr);
}

function getScoreHistory(section) {
  const data = loadRaw();
  return data.daily_results
    .filter((r) => r.section === section && r.score)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getWordsBySection(section) {
  const data = loadRaw();
  return (data.words || []).filter((w) => !section || section === 'all' || w.section === section);
}

function computeWeeklyStats() {
  const data = loadRaw();
  const today = new Date();
  const dateList = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dateList.push(d.toISOString().slice(0, 10));
  }
  const tasks = data.tasks.filter((t) => dateList.includes(t.date));
  const done = tasks.filter((t) => t.status === 'done');
  const totalMinutes = Math.round(done.reduce((s, t) => s + (t.duration_seconds || 0), 0) / 60);
  const perDay = dateList.map((d) => {
    const dayTasks = tasks.filter((t) => t.date === d);
    const dayDone = dayTasks.filter((t) => t.status === 'done').length;
    return { date: d, done: dayDone, total: dayTasks.length };
  });
  const fullDays = perDay.filter((d) => d.total > 0 && d.done === d.total).length;
  return { totalCompleted: done.length, totalMinutes, perDay, fullDays };
}

function getSettings() {
  return loadRaw().settings;
}

function updateSettings(patch) {
  const data = loadRaw();
  data.settings = { ...data.settings, ...patch };
  saveRaw(data);
  return data.settings;
}

module.exports = {
  STANDARD_SECTIONS, diffDays, taskLabel,
  addCustomTask, getActiveCustomTasks, getCustomTaskById, deactivateCustomTask, customTaskAppliesToDate,
  getTasksByDate, getTaskById, getStandardTask, ensureStandardTask, ensureCustomTaskInstance,
  ensureTodayTasks, updateTask, startTask, pauseTask, resumeTask, finishTask, restartTask,
  deleteCustomTaskAndToday, deleteTaskInstance, allTasksHistory, computeStats,
  addMaterial, getMaterials, getMaterialById, deleteMaterial, getAllVocabMaterials, getAllGrammarMaterials,
  getReminderEligibleMaterials,
  updateMaterialReminders, updateMaterialQuizStages,
  upsertResult, getResultsByDate, computeWeeklyStats, getScoreHistory,
  getWordsBySection,
  getSettings, updateSettings,
};
