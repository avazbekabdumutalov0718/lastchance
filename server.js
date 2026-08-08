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

// ---- File upload setup ----
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf' || ext === '.html' || ext === '.htm') return cb(null, true);
    cb(new Error('Faqat PDF yoki HTML fayllarga ruxsat berilgan'));
  },
});

const VALID_SECTIONS = ['reading', 'listening', 'writing', 'speaking', 'grammar'];

// =========================================================
// TASKS (Progress bo'limi: standart 6 ta + custom tasklar)
// =========================================================
app.get('/api/tasks', (req, res) => {
  const date = req.query.date || todayStr();
  const tasks = db.ensureTodayTasks(date === todayStr() ? date : date);
  // faqat bugungi sana uchun avtomatik yaratamiz; boshqa sanalar uchun mavjudlarini qaytaramiz
  const list = date === todayStr() ? tasks : db.getTasksByDate(date);
  const withLabels = list.map((t) => ({ ...t, label: db.taskLabel(t) }));
  res.json(withLabels);
});

app.get('/api/tasks/history', (req, res) => {
  const rows = db.allTasksHistory(200).map((t) => ({ ...t, label: db.taskLabel(t) }));
  res.json(rows);
});

app.post('/api/tasks/:id/start', (req, res) => {
  const task = db.getTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task topilmadi' });
  if (task.status !== 'pending') return res.status(400).json({ error: 'Task allaqachon boshlangan yoki tugagan' });
  const updated = db.updateTask(task.id, { status: 'in_progress', start_time: new Date().toISOString() });
  res.json({ ...updated, label: db.taskLabel(updated) });
});

app.post('/api/tasks/:id/finish', (req, res) => {
  const task = db.getTaskById(req.params.id);
  if (!task || task.status !== 'in_progress') return res.status(400).json({ error: 'Task hali boshlanmagan' });
  const start = new Date(task.start_time);
  const finish = new Date();
  const durationSeconds = Math.max(0, Math.round((finish - start) / 1000));
  const updated = db.updateTask(task.id, { status: 'done', finish_time: finish.toISOString(), duration_seconds: durationSeconds });
  res.json({ ...updated, label: db.taskLabel(updated) });
});

// =========================================================
// CUSTOM TASKS (foydalanuvchi o'zi qo'shadigan, ixtiyoriy N kunlik)
// =========================================================
app.get('/api/custom-tasks', (req, res) => {
  res.json(db.getActiveCustomTasks());
});

app.post('/api/custom-tasks', (req, res) => {
  const { title, duration_days } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Task nomi kerak' });
  const rec = db.addCustomTask({
    title: title.trim(),
    duration_days: duration_days ? Number(duration_days) : null,
    start_date: todayStr(),
  });
  // bugungi kun uchun darhol instansiya yaratamiz
  db.ensureCustomTaskInstance(rec.id, todayStr());
  res.json(rec);
});

app.delete('/api/custom-tasks/:id', (req, res) => {
  db.deactivateCustomTask(req.params.id);
  res.json({ ok: true });
});

// =========================================================
// MATERIALS (Reading/Listening/Writing/Speaking/Grammar)
// kind: content | keyword | model_answer | vocabulary
// =========================================================
app.post('/api/materials/:section', upload.single('file'), (req, res) => {
  const { section } = req.params;
  if (!VALID_SECTIONS.includes(section)) return res.status(400).json({ error: "Noto'g'ri bo'lim" });
  const { date, kind, title } = req.body;
  if (!req.file) return res.status(400).json({ error: 'Fayl yuklanmadi (faqat PDF yoki HTML)' });
  const fileType = path.extname(req.file.originalname).toLowerCase() === '.pdf' ? 'pdf' : 'html';
  const rec = db.addMaterial({
    section, date: date || todayStr(), kind: kind || 'content', file_type: fileType,
    filename: req.file.filename, original_name: req.file.originalname, title: title || '',
  });
  res.json(rec);
});

app.get('/api/materials/:section', (req, res) => {
  const { section } = req.params;
  const { kind } = req.query;
  res.json(db.getMaterials(section, kind));
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

// Multer xatoliklarini chiroyli qaytarish
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Xatolik yuz berdi' });
  next();
});

// =========================================================
// DAILY RESULTS
// =========================================================
app.get('/api/results', (req, res) => {
  const date = req.query.date || todayStr();
  res.json(db.getResultsByDate(date));
});

app.post('/api/results/:section', (req, res) => {
  const { section } = req.params;
  const { date, notes } = req.body;
  const rec = db.upsertResult(date || todayStr(), section, notes || '');
  res.json(rec);
});

// =========================================================
// START SERVER + BOT
// =========================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Last Chance server ${PORT}-portda ishga tushdi`);
  scheduleJobs();
});
