const API = '/api';

function todayStr() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 10);
}

function fmtDuration(sec) {
  if (!sec && sec !== 0) return '--:--';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function labelize(label) {
  const map = {
    reading: '📖 Reading', listening: '🎧 Listening', writing: '✍️ Writing',
    speaking: '🗣 Speaking', vocabulary: '📚 Vocabulary', grammar: '📐 Grammar',
  };
  return map[label] || `⭐ ${label}`;
}

// ---------------- Tabs ----------------
document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
});

document.querySelectorAll('.sub-tabs').forEach((group) => {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.sub-tab');
    if (!btn) return;
    group.querySelectorAll('.sub-tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    const panelParent = group.parentElement;

    if (btn.dataset.kind) {
      panelParent.querySelectorAll('.sub-panel[data-kind-panel]').forEach((p) => p.classList.remove('active'));
      panelParent.querySelector(`.sub-panel[data-kind-panel="${btn.dataset.kind}"]`).classList.add('active');
    } else if (btn.dataset.vocabSec) {
      panelParent.querySelectorAll('.sub-panel[data-vocab-panel]').forEach((p) => p.classList.remove('active'));
      panelParent.querySelector(`.sub-panel[data-vocab-panel="${btn.dataset.vocabSec}"]`).classList.add('active');
    }
  });
});

document.getElementById('today-pill').textContent = todayStr();

// ---------------- PROGRESS ----------------
let taskTimerInterval = null;

async function loadTasks() {
  const res = await fetch(`${API}/tasks?date=${todayStr()}`);
  const tasks = await res.json();
  renderTaskGrid(tasks);
  if (taskTimerInterval) clearInterval(taskTimerInterval);
  taskTimerInterval = setInterval(tickTimers, 1000);
}

function renderTaskGrid(tasks) {
  const grid = document.getElementById('task-grid');
  grid.innerHTML = '';
  tasks.forEach((task) => {
    const card = document.createElement('div');
    card.className = `task-card ${task.status}`;
    card.dataset.id = task.id;
    card.dataset.startTime = task.start_time || '';
    card.dataset.accumulated = task.accumulated_seconds || 0;

    let statusText = 'Boshlanmagan';
    let timerText = '00:00';
    let actionsHtml = `<button class="t-action" data-action="start">Start</button>`;

    if (task.status === 'in_progress') {
      statusText = 'Jarayonda...';
      timerText = fmtDuration(task.accumulated_seconds || 0);
      actionsHtml = `
        <div class="t-btn-row">
          <button class="t-action t-secondary" data-action="pause">⏸ Pause</button>
          <button class="t-action" data-action="finish">⏹ Finish</button>
        </div>`;
    } else if (task.status === 'paused') {
      statusText = 'Pauzada';
      timerText = fmtDuration(task.accumulated_seconds || 0);
      actionsHtml = `
        <div class="t-btn-row">
          <button class="t-action" data-action="resume">▶️ Resume</button>
          <button class="t-action t-secondary" data-action="finish">⏹ Finish</button>
        </div>`;
    } else if (task.status === 'done') {
      statusText = 'Bajarildi';
      timerText = fmtDuration(task.duration_seconds);
      actionsHtml = `<button class="t-action t-secondary" data-action="restart">🔄 Qayta boshlash</button>`;
    }

    const deleteBtn = `<button class="t-delete" data-action="delete" title="O'chirish">🗑</button>`;

    card.innerHTML = `
      ${deleteBtn}
      <div class="t-label">${labelize(task.label)}</div>
      <div class="t-status">${statusText}</div>
      <div class="t-timer">${timerText}</div>
      ${actionsHtml}
    `;
    card.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => handleTaskClick(task.id, btn.dataset.action));
    });
    grid.appendChild(card);
  });
}

function tickTimers() {
  document.querySelectorAll('.task-card.in_progress').forEach((card) => {
    const start = new Date(card.dataset.startTime).getTime();
    const accumulated = Number(card.dataset.accumulated) || 0;
    const sec = accumulated + Math.max(0, Math.floor((Date.now() - start) / 1000));
    const timerEl = card.querySelector('.t-timer');
    if (timerEl) timerEl.textContent = fmtDuration(sec);
  });
}

async function handleTaskClick(id, action) {
  if (action === 'delete') {
    if (!confirm("Bu taskni o'chirasizmi?")) return;
    await fetch(`${API}/tasks/${id}`, { method: 'DELETE' });
    return loadTasks();
  }
  const res = await fetch(`${API}/tasks/${id}/${action}`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error || 'Xatolik yuz berdi');
    return;
  }
  loadTasks();
  loadStats();
}

async function loadTaskHistory() {
  const res = await fetch(`${API}/tasks/history`);
  const rows = await res.json();
  const el = document.getElementById('task-history');
  el.innerHTML = rows.slice(0, 40).map((r) => `
    <div class="history-row">
      <span>${r.date} — ${labelize(r.label)}</span>
      <span>${r.status === 'done' ? '✓ ' + fmtDuration(r.duration_seconds) : r.status}</span>
    </div>
  `).join('');
}

// ---- Custom task modal ----
const modalOverlay = document.getElementById('task-modal-overlay');
document.getElementById('add-task-btn').addEventListener('click', () => {
  document.getElementById('new-task-title').value = '';
  document.getElementById('new-task-days').value = '';
  modalOverlay.classList.add('active');
});
document.getElementById('cancel-task-btn').addEventListener('click', () => modalOverlay.classList.remove('active'));
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) modalOverlay.classList.remove('active'); });

document.getElementById('confirm-task-btn').addEventListener('click', async () => {
  const title = document.getElementById('new-task-title').value.trim();
  const days = document.getElementById('new-task-days').value;
  if (!title) return alert('Task nomini kiriting');
  await fetch(`${API}/custom-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, duration_days: days ? Number(days) : null }),
  });
  modalOverlay.classList.remove('active');
  loadTasks();
});

// ---------------- MATERIALS (Material / Keyword / Model Answer / Vocabulary) ----------------
function initMaterialPanels() {
  document.querySelectorAll('.sub-panel[data-kind-panel]').forEach((panel) => {
    const section = panel.dataset.sectionPanel;
    const kind = panel.dataset.kindPanel;
    if (kind === 'result') return;
    buildMaterialBlock(panel, section, kind);
  });
}

function buildMaterialBlock(panel, section, kind) {
  const tpl = document.getElementById('tpl-material-block').content.cloneNode(true);
  panel.appendChild(tpl);
  const dateInput = panel.querySelector('.date-input');
  dateInput.value = todayStr();

  panel.querySelector('.upload-btn').addEventListener('click', async () => {
    const fileInput = panel.querySelector('.file-input');
    if (!fileInput.files.length) return alert('Fayl tanlang (PDF yoki HTML)');
    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    fd.append('date', dateInput.value || todayStr());
    fd.append('kind', kind);
    fd.append('title', panel.querySelector('.title-input').value);
    const res = await fetch(`${API}/materials/${section}`, { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return alert(err.error || 'Yuklashda xatolik');
    }
    panel.querySelector('.title-input').value = '';
    fileInput.value = '';
    loadMaterials(panel, section, kind);
  });

  loadMaterials(panel, section, kind);
}

async function loadMaterials(panel, section, kind) {
  const res = await fetch(`${API}/materials/${section}?kind=${kind}`);
  const rows = await res.json();
  const list = panel.querySelector('.material-list');
  list.innerHTML = rows.map((r) => `
    <div class="material-item">
      <div class="meta">
        <span class="m-title">${r.title || r.original_name}</span>
        <span class="m-date">${r.date} · ${r.file_type.toUpperCase()}</span>
        ${r.file_type === 'audio' ? `<audio class="m-audio" controls src="/uploads/${r.filename}"></audio>` : ''}
        ${r.file_type === 'image' ? `<img class="m-image" src="/uploads/${r.filename}" alt="${r.title}">` : ''}
      </div>
      <div class="actions">
        ${r.file_type !== 'audio' && r.file_type !== 'image' ? `<a href="/uploads/${r.filename}" target="_blank" rel="noopener">Ochish</a>` : ''}
        ${r.file_type === 'image' ? `<a href="/uploads/${r.filename}" target="_blank" rel="noopener">Kattalashtirish</a>` : ''}
        <button class="btn-danger" data-id="${r.id}">O'chirish</button>
      </div>
    </div>
  `).join('') || `<p style="color:var(--text-muted); font-size:13px;">Hali fayl yuklanmagan.</p>`;

  list.querySelectorAll('.btn-danger').forEach((b) => {
    b.addEventListener('click', async () => {
      await fetch(`${API}/materials/${b.dataset.id}`, { method: 'DELETE' });
      loadMaterials(panel, section, kind);
    });
  });
}

// ---------------- RESULT blocks ----------------
const scoreCharts = {};
function initResultPanels() {
  document.querySelectorAll('.sub-panel[data-kind-panel="result"]').forEach((panel) => {
    const section = panel.dataset.sectionPanel;
    const tpl = document.getElementById('tpl-result-block').content.cloneNode(true);
    panel.appendChild(tpl);
    loadResult(panel, section);
    loadScoreChart(panel, section);

    panel.querySelector('.save-result-btn').addEventListener('click', async () => {
      const notes = panel.querySelector('.result-input').value;
      const score = panel.querySelector('.score-input').value;
      const imageInput = panel.querySelector('.result-image-input');
      const fd = new FormData();
      fd.append('date', todayStr());
      fd.append('notes', notes);
      if (score) fd.append('score', score);
      if (imageInput.files[0]) fd.append('image', imageInput.files[0]);
      await fetch(`${API}/results/${section}`, { method: 'POST', body: fd });
      const note = panel.querySelector('.saved-note');
      note.style.display = 'block';
      setTimeout(() => (note.style.display = 'none'), 1800);
      loadResult(panel, section);
      loadScoreChart(panel, section);
    });
  });
}

async function loadScoreChart(panel, section) {
  if (typeof Chart === 'undefined') return;
  const res = await fetch(`${API}/scores/${section}`);
  const rows = await res.json();
  const canvas = panel.querySelector('.score-chart');
  const wrap = panel.querySelector('.score-chart-wrap');
  if (!rows.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if (scoreCharts[section]) scoreCharts[section].destroy();
  scoreCharts[section] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: rows.map((r) => r.date.slice(5)),
      datasets: [{ label: 'Ball', data: rows.map((r) => r.score), borderColor: '#F2A93B', backgroundColor: 'rgba(242,169,59,0.15)', tension: 0.3, fill: true }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8B93A3', font: { size: 10 } }, grid: { display: false } },
        y: { min: 0, max: 9, ticks: { color: '#8B93A3', stepSize: 1 }, grid: { color: '#2E3542' } },
      },
    },
  });
}

async function loadResult(panel, section) {
  const res = await fetch(`${API}/results?date=${todayStr()}`);
  const rows = await res.json();
  const row = rows.find((r) => r.section === section);
  const preview = panel.querySelector('.result-image-preview');
  if (row) {
    panel.querySelector('.result-input').value = row.notes || '';
    panel.querySelector('.score-input').value = row.score != null ? row.score : '';
    if (row.image) {
      preview.innerHTML = `<img src="/uploads/${row.image}" alt="natija rasmi">`;
      preview.style.display = 'block';
    } else {
      preview.style.display = 'none';
      preview.innerHTML = '';
    }
  }
}

// ---------------- VOCABULARY main tab (4 sections, fayl yuklash) ----------------
function initVocabularyTab() {
  ['reading', 'listening', 'writing', 'speaking'].forEach((section) => {
    const panel = document.querySelector(`.sub-panel[data-vocab-panel="${section}"]`);
    buildMaterialBlock(panel, section, 'vocabulary');
  });
}

// ---------------- STATS ----------------
let currentGoal = 120;
async function loadStats() {
  const res = await fetch(`${API}/stats`);
  const s = await res.json();
  const el = document.getElementById('stats-bar');
  const hours = Math.floor(s.totalMinutes / 60);
  const mins = s.totalMinutes % 60;
  el.innerHTML = `
    <div class="stat-chip">🔥 <b>${s.streak}</b> kunlik streak</div>
    <div class="stat-chip">✅ Bugun <b>${s.todayDone}/${s.todayTotal}</b></div>
    <div class="stat-chip">⏱ Jami <b>${hours}s ${mins}d</b></div>
    ${s.badge ? `<div class="stat-chip badge-chip">${s.badge.emoji} <b>${s.badge.name}</b></div>` : ''}
    ${s.nextBadge ? `<div class="stat-chip">👉 ${s.nextBadge.emoji} ${s.nextBadge.name} gacha <b>${s.nextBadge.daysLeft}</b> kun</div>` : ''}
  `;

  const settingsRes = await fetch(`${API}/settings`);
  const settings = await settingsRes.json();
  currentGoal = settings.daily_goal_minutes || 120;
  const pct = currentGoal ? Math.min(100, Math.round((s.todayMinutes / currentGoal) * 100)) : 0;
  document.getElementById('goal-bar-fill').style.width = pct + '%';
  document.getElementById('goal-label').textContent = `${s.todayMinutes} / ${currentGoal} daqiqa (${pct}%)`;
}

document.getElementById('edit-goal-btn').addEventListener('click', () => {
  document.getElementById('goal-input').value = currentGoal;
  document.getElementById('goal-modal-overlay').classList.add('active');
});
document.getElementById('cancel-goal-btn').addEventListener('click', () => {
  document.getElementById('goal-modal-overlay').classList.remove('active');
});
document.getElementById('confirm-goal-btn').addEventListener('click', async () => {
  const val = Number(document.getElementById('goal-input').value);
  if (!val || val < 1) return alert("To'g'ri qiymat kiriting");
  await fetch(`${API}/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daily_goal_minutes: val }),
  });
  document.getElementById('goal-modal-overlay').classList.remove('active');
  loadStats();
});

// ---------------- HEATMAP ----------------
async function loadHeatmap() {
  const res = await fetch(`${API}/heatmap?days=180`);
  const days = await res.json();
  const el = document.getElementById('heatmap');
  el.innerHTML = days.map((d) => {
    let level = 0;
    if (d.total > 0) {
      const ratio = d.done / d.total;
      level = ratio >= 1 ? 4 : ratio >= 0.66 ? 3 : ratio >= 0.33 ? 2 : 1;
    }
    return `<div class="heat-cell heat-${level}" title="${d.date}: ${d.done}/${d.total}"></div>`;
  }).join('');
}

// ---------------- CHARTS ----------------
let sectionsChart = null, weekChart = null;
async function loadCharts() {
  if (typeof Chart === 'undefined') return;
  const [historyRes, heatmapRes] = await Promise.all([
    fetch(`${API}/tasks/history`), fetch(`${API}/heatmap?days=7`),
  ]);
  const history = await historyRes.json();
  const heatmap = await heatmapRes.json();

  // Bo'limlar bo'yicha vaqt (done tasklar)
  const bySection = {};
  history.filter((t) => t.status === 'done').forEach((t) => {
    const key = labelize(t.label).replace(/^\S+\s/, '');
    bySection[key] = (bySection[key] || 0) + Math.round((t.duration_seconds || 0) / 60);
  });
  const ctx1 = document.getElementById('chart-sections');
  if (sectionsChart) sectionsChart.destroy();
  sectionsChart = new Chart(ctx1, {
    type: 'doughnut',
    data: {
      labels: Object.keys(bySection),
      datasets: [{ data: Object.values(bySection), backgroundColor: ['#F2A93B', '#4CAF6D', '#E0554A', '#8B93A3', '#6b8cff', '#c084fc'] }],
    },
    options: { plugins: { legend: { labels: { color: '#ECEEF2', font: { size: 11 } } } } },
  });

  const ctx2 = document.getElementById('chart-week');
  if (weekChart) weekChart.destroy();
  weekChart = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: heatmap.map((d) => d.date.slice(5)),
      datasets: [{ label: 'Bajarilgan tasklar', data: heatmap.map((d) => d.done), backgroundColor: '#F2A93B' }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8B93A3', font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: '#8B93A3', stepSize: 1 }, grid: { color: '#2E3542' } },
      },
    },
  });
}

// ---------------- LUG'AT (word bank) ----------------
async function loadWords(query) {
  const res = await fetch(`${API}/words${query ? '?q=' + encodeURIComponent(query) : ''}`);
  const words = await res.json();
  const diffRes = await fetch(`${API}/words/difficult`);
  const difficult = await diffRes.json();
  document.getElementById('word-total-chip').innerHTML = `📚 <b>${words.length}</b> so'z`;
  document.getElementById('word-difficult-chip').innerHTML = `⚠️ <b>${difficult.length}</b> qiyin so'z`;

  const list = document.getElementById('word-list');
  list.innerHTML = words.map((w) => {
    const isDue = new Date(w.next_review_at) <= new Date();
    const isDifficult = w.wrong_streak >= 2;
    return `
      <div class="word-item ${isDifficult ? 'difficult' : ''}">
        <div class="word-main">
          <span class="w-word">${w.word}</span>
          <span class="w-meaning">${w.meaning}</span>
        </div>
        <div class="word-meta">
          <span class="w-section">${labelize(w.section)}</span>
          ${isDifficult ? '<span class="w-tag w-tag-danger">⚠️ qiyin</span>' : ''}
          ${isDue ? '<span class="w-tag w-tag-due">🔁 takrorlash vaqti</span>' : ''}
        </div>
      </div>`;
  }).join('') || `<p style="color:var(--text-muted); font-size:13px;">Hali so'z yo'q — Vocabulary/Keyword fayl yuklang.</p>`;
}
let wordSearchTimeout = null;
document.getElementById('word-search').addEventListener('input', (e) => {
  clearTimeout(wordSearchTimeout);
  wordSearchTimeout = setTimeout(() => loadWords(e.target.value.trim()), 250);
});

// ---------------- INIT ----------------
(function init() {
  loadTasks();
  loadTaskHistory();
  loadStats();
  loadHeatmap();
  loadCharts();
  loadWords();
  initMaterialPanels();
  initResultPanels();
  initVocabularyTab();
})();
