import { Readable, Transform } from 'node:stream';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { google } from 'googleapis';
import 'dotenv/config';
import { isCloudflareChallenge } from './browser.js';

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

/**
 * Tạo Drive client.
 * - Ưu tiên OAuth2 (GOOGLE_CLIENT_ID / SECRET / REFRESH_TOKEN) -> upload vào Drive của bạn.
 * - Nếu không có, dùng Service Account (GOOGLE_APPLICATION_CREDENTIALS).
 */
export function getDriveClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_APPLICATION_CREDENTIALS } =
    process.env;

  let auth;
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
    auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  } else if (GOOGLE_APPLICATION_CREDENTIALS) {
    auth = new google.auth.GoogleAuth({ keyFile: GOOGLE_APPLICATION_CREDENTIALS, scopes: SCOPES });
  } else {
    throw new Error(
      'Chưa cấu hình xác thực Google. Đặt GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN ' +
        '(chạy `npm run auth`) hoặc GOOGLE_APPLICATION_CREDENTIALS trong file .env'
    );
  }
  return google.drive({ version: 'v3', auth });
}

/** Lấy tên file từ header Content-Disposition, nếu không có thì từ đường dẫn URL. */
export function guessFileName(url, contentDisposition) {
  if (contentDisposition) {
    const star = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/i.exec(contentDisposition);
    if (star) {
      try {
        return sanitize(decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')));
      } catch {
        /* bỏ qua, thử cách khác */
      }
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(contentDisposition);
    if (plain) return sanitize(plain[1].trim());
  }
  try {
    const base = path.posix.basename(new URL(url).pathname);
    if (base) return sanitize(decodeURIComponent(base));
  } catch {
    /* ignore */
  }
  return `download-${Date.now()}`;
}

function sanitize(name) {
  return name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 255) || `download-${Date.now()}`;
}

/** Kiểm tra URL hợp lệ, chỉ cho phép http/https. */
export function validateUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`URL không hợp lệ: ${raw}`);
  }
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error('Chỉ hỗ trợ URL http/https');
  }
  return u.toString();
}

const MIME_BY_EXT = {
  pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  mp4: 'video/mp4', mkv: 'video/x-matroska', mp3: 'audio/mpeg', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', gif: 'image/gif', txt: 'text/plain', apk: 'application/vnd.android.package-archive',
};
const mimeFromName = (n) => MIME_BY_EXT[path.extname(n).slice(1).toLowerCase()] || 'application/octet-stream';

/** Upload một stream lên Drive, có đếm tiến độ. */
async function uploadStream(drive, { stream, name, mimeType, total, folderId, onProgress, signal }) {
  let loaded = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      loaded += chunk.length;
      onProgress?.({ loaded, total });
      cb(null, chunk);
    },
  });
  const { data } = await drive.files.create(
    {
      requestBody: { name, mimeType, ...(folderId ? { parents: [folderId] } : {}) },
      media: { mimeType, body: stream.pipe(counter) },
      fields: 'id,name,mimeType,size,webViewLink',
      supportsAllDrives: true,
    },
    { signal }
  );
  return data;
}

/**
 * Tải file từ URL và upload lên Google Drive.
 * - Bình thường: stream thẳng từ nguồn lên Drive (không ghi đĩa).
 * - Nếu gặp Cloudflare: mở bằng Chromium thật để qua xác thực, rồi upload.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {string} [opts.name]      Tên file trên Drive (mặc định đoán từ URL/header)
 * @param {string} [opts.folderId]  ID thư mục Drive đích
 * @param {Record<string,string>} [opts.headers]  Header thêm khi tải (Cookie, User-Agent, Referer...)
 * @param {'auto'|'always'|'never'} [opts.browser]  Dùng trình duyệt: tự động khi gặp Cloudflare / luôn luôn / không bao giờ
 * @param {(p:{loaded:number,total:number|null})=>void} [opts.onProgress]
 * @param {(s:'downloading'|'cloudflare'|'uploading')=>void} [opts.onStatus]
 * @param {AbortSignal} [opts.signal]
 */
export async function uploadFromUrl(url, opts = {}) {
  const drive = opts.drive ?? getDriveClient();
  const target = validateUrl(url);
  const folderId = opts.folderId || process.env.DRIVE_FOLDER_ID || undefined;
  const mode = opts.browser || process.env.BROWSER_MODE || 'auto';
  const { onProgress, onStatus, signal } = opts;

  let headers = { ...(opts.headers || {}) };
  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'user-agent')) {
    headers['User-Agent'] =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  }

  let res = null;
  if (mode !== 'always') {
    onStatus?.('downloading');
    res = await fetch(target, { headers, redirect: 'follow', signal });
  }

  const blocked = !res || isCloudflareChallenge(res.status, (k) => res.headers.get(k));
  if (blocked && mode !== 'never') {
    await res?.body?.cancel().catch(() => {});
    const { openInBrowser } = await import('./browser.js');
    const r = await openInBrowser(target, { onStatus, signal });

    if (r.kind === 'file') {
      try {
        const { size } = await fs.stat(r.filePath);
        // Chromium không hiểu tên file dạng filename*=UTF-8''... nên ưu tiên đọc lại từ header
        const name =
          opts.name || (r.contentDisposition ? guessFileName(r.url, r.contentDisposition) : sanitize(r.name));
        let mimeType = (r.contentType || '').split(';')[0].trim();
        if (!mimeType || mimeType === 'application/octet-stream') mimeType = mimeFromName(name);
        onStatus?.('uploading');
        return await uploadStream(drive, {
          stream: createReadStream(r.filePath),
          name,
          mimeType,
          total: size,
          folderId,
          onProgress,
          signal,
        });
      } finally {
        await r.cleanup();
      }
    }
    // Tải lại bằng fetch với cookie Cloudflare vừa lấy được
    headers = { ...headers, ...r.headers };
    onStatus?.('downloading');
    res = await fetch(target, { headers, redirect: 'follow', signal });
    if (isCloudflareChallenge(res.status, (k) => res.headers.get(k))) {
      throw new Error('Cloudflare vẫn chặn khi tải bằng cookie. Thử lại với browser="always".');
    }
  }

  if (!res.ok || !res.body) {
    if (blocked) throw new Error(`Bị Cloudflare chặn (HTTP ${res.status}). Bật chế độ trình duyệt (BROWSER_MODE=auto).`);
    throw new Error(`Tải file thất bại: HTTP ${res.status} ${res.statusText}`);
  }

  const total = Number(res.headers.get('content-length')) || null;
  const name = opts.name || guessFileName(res.url || target, res.headers.get('content-disposition'));
  let mimeType = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!mimeType || mimeType === 'application/octet-stream') mimeType = mimeFromName(name);

  onStatus?.('uploading');
  return uploadStream(drive, {
    stream: Readable.fromWeb(res.body),
    name,
    mimeType,
    total,
    folderId,
    onProgress,
    signal,
  });
}
