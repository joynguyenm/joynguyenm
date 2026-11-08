import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uploadFromUrl, getDriveClient, validateUrl } from './drive.js';
import { closeBrowser } from './browser.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const API_KEY = process.env.API_KEY;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.set('trust proxy', 'loopback');
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
  const { url, name, folderId, headers, browser } = req.body ?? {};
  try {
    validateUrl(url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (browser && !['auto', 'always', 'never'].includes(browser)) {
    return res.status(400).json({ error: 'browser phải là auto, always hoặc never' });
  }
  if (headers && (typeof headers !== 'object' || Object.values(headers).some((v) => typeof v !== 'string'))) {
    return res.status(400).json({ error: 'headers phải là object {tên: giá trị}' });
  }

  const id = randomUUID();
  const job = { id, url, status: 'running', phase: 'queued', loaded: 0, total: null, file: null, error: null, createdAt: Date.now() };
  jobs.set(id, job);

  uploadFromUrl(url, {
    drive,
    name,
    folderId,
    headers,
    browser,
    onStatus: (phase) => (job.phase = phase),
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

const server = app.listen(PORT, HOST, () => console.log(`🚀 Server chạy tại http://${HOST}:${PORT}`));

async function shutdown() {
  console.log('Đang tắt server...');
  server.close();
  await closeBrowser();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
