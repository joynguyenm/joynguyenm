import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uploadFromUrl, getDriveClient, validateUrl } from './drive.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.API_KEY;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Xác thực đơn giản bằng API key (nếu có cấu hình)
app.use('/api', (req, res, next) => {
  if (!API_KEY) return next();
  if (req.get('authorization') === `Bearer ${API_KEY}`) return next();
  res.status(401).json({ error: 'Unauthorized' });
});

/** Lưu trạng thái job trong bộ nhớ */
const jobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000;

let drive;
try {
  drive = getDriveClient();
} catch (err) {
  console.error('⚠️ ', err.message);
  process.exit(1);
}

// Tạo job tải + upload, trả về ngay jobId
app.post('/api/upload', (req, res) => {
  const { url, name, folderId } = req.body ?? {};
  try {
    validateUrl(url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const id = randomUUID();
  const job = { id, url, status: 'running', loaded: 0, total: null, file: null, error: null, createdAt: Date.now() };
  jobs.set(id, job);

  uploadFromUrl(url, {
    drive,
    name,
    folderId,
    onProgress: ({ loaded, total }) => Object.assign(job, { loaded, total }),
  })
    .then((file) => Object.assign(job, { status: 'done', file }))
    .catch((err) => Object.assign(job, { status: 'error', error: err.message }))
    .finally(() => setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref());

  res.status(202).json({ jobId: id, statusUrl: `/api/jobs/${id}` });
});

// Xem trạng thái job
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Không tìm thấy job' });
  res.json(job);
});

app.listen(PORT, () => console.log(`🚀 Server chạy tại http://localhost:${PORT}`));
