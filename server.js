require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { scheduleJobs, todayStr } = require('./bot');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const AUDIO_EXTS = ['.mp3', '.m4a', '.ogg', '.oga', '.wav'];
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf' || ext === '.html' || ext === '.htm' || AUDIO_EXTS.includes(ext)) return cb(null, true);
    cb(new Error('Faqat PDF, HTML yoki audio fayllarga ruxsat berilgan'));
  },
});
function detectFileType(originalname) {
  const ext = path.extname(originalname).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  return 'html';
}

const VALID_SECTIONS = ['reading', 'listening', 'writing', 'speaking', 'grammar'];

// =========================================================
// TASKS
// =========================================================
app.get('/api/tasks', (req, res) => {
  const date = req.query.date || todayStr();
  const tasks = date === todayStr() ? db.ensureTodayTasks(date) : db.getTasksByDate(date);
  res.json(tasks.map((t) => ({ ...t, label: db.taskLabel(t) })));
});

app.get('/api/tasks/history', (req, res) => {
  res.json(db.allTasksHistory(200).map((t) => ({ ...t, label: db.taskLabel(t) })));
});

app.get('/api/stats', (req, res) => {
  res.json(db.computeStats(todayStr()));
});

function respondTask(res, updated, label, errorMsg) {
  if (!updated) return res.status(400).json({ error: errorMsg });
  res.json({ ...updated, label });
}

app.post('/api/tasks/:id/start', (req, res) => {
  const task = db.getTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task topilmadi' });
  respondTask(res, db.startTask(task.id), db.taskLabel(task), 'Task allaqachon boshlangan yoki tugagan');
});
app.post('/api/tasks/:id/pause', (req, res) => {
  const task = db.getTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task topilmadi' });
  respondTask(res, db.pauseTask(task.id), db.taskLabel(task), 'Task jarayonda emas');
});
app.post('/api/tasks/:id/resume', (req, res) => {
  const task = db.getTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task topilmadi' });
  respondTask(res, db.resumeTask(task.id), db.taskLabel(task), 'Task pauzada emas');
});
app.post('/api/tasks/:id/finish', (req, res) => {
  const task = db.getTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task topilmadi' });
  respondTask(res, db.finishTask(task.id), db.taskLabel(task), 'Task boshlanmagan yoki pauzada emas');
});
app.post('/api/tasks/:id/restart', (req, res) => {
  const task = db.getTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task topilmadi' });
  res.json({ ...db.restartTask(task.id), label: db.taskLabel(task) });
});
app.delete('/api/tasks/:id', (req, res) => {
  const task = db.getTaskById(req.params.id);
  if (task && task.custom_task_id) db.deleteCustomTaskAndToday(task.custom_task_id, task.date);
  res.json({ ok: true });
});

// =========================================================
// CUSTOM TASKS
// =========================================================
app.get('/api/custom-tasks', (req, res) => res.json(db.getActiveCustomTasks()));

app.post('/api/custom-tasks', (req, res) => {
  const { title, duration_days } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Task nomi kerak' });
  const rec = db.addCustomTask({ title: title.trim(), duration_days: duration_days ? Number(duration_days) : null, start_date: todayStr() });
  db.ensureCustomTaskInstance(rec.id, todayStr());
  res.json(rec);
});

app.delete('/api/custom-tasks/:id', (req, res) => {
  db.deleteCustomTaskAndToday(req.params.id, todayStr());
  res.json({ ok: true });
});

// =========================================================
// MATERIALS
// =========================================================
app.post('/api/materials/:section', upload.single('file'), (req, res) => {
  const { section } = req.params;
  if (!VALID_SECTIONS.includes(section)) return res.status(400).json({ error: "Noto'g'ri bo'lim" });
  const { date, kind, title } = req.body;
  if (!req.file) return res.status(400).json({ error: 'Fayl yuklanmadi (PDF, HTML yoki audio)' });
  const rec = db.addMaterial({
    section, date: date || todayStr(), kind: kind || 'content', file_type: detectFileType(req.file.originalname),
    filename: req.file.filename, original_name: req.file.originalname, title: title || '',
  });
  res.json(rec);
});

app.get('/api/materials/:section', (req, res) => {
  res.json(db.getMaterials(req.params.section, req.query.kind));
});

app.delete('/api/materials/:id', (req, res) => {
  const row = db.getMaterialById(req.params.id);
  if (row) {
    const filePath = path.join(uploadDir, row.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.deleteMaterial(req.params.id);
  }
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Xatolik yuz berdi' });
  next();
});

// =========================================================
// DAILY RESULTS
// =========================================================
app.get('/api/results', (req, res) => res.json(db.getResultsByDate(req.query.date || todayStr())));

app.post('/api/results/:section', (req, res) => {
  const { date, notes } = req.body;
  res.json(db.upsertResult(date || todayStr(), req.params.section, notes || ''));
});

// =========================================================
// START
// =========================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Last Chance server ${PORT}-portda ishga tushdi`);
  scheduleJobs();
});
