import { Readable, Transform } from 'node:stream';
import path from 'node:path';
import { google } from 'googleapis';
import 'dotenv/config';

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

/**
 * Tải file từ URL và stream thẳng lên Google Drive (không ghi ra đĩa).
 * @param {string} url
 * @param {object} [opts]
 * @param {string} [opts.name]      Tên file trên Drive (mặc định đoán từ URL/header)
 * @param {string} [opts.folderId]  ID thư mục Drive đích
 * @param {(p:{loaded:number,total:number|null})=>void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{id:string,name:string,mimeType:string,size:string,webViewLink:string}>}
 */
export async function uploadFromUrl(url, opts = {}) {
  const drive = opts.drive ?? getDriveClient();
  const target = validateUrl(url);

  const res = await fetch(target, { redirect: 'follow', signal: opts.signal });
  if (!res.ok || !res.body) {
    throw new Error(`Tải file thất bại: HTTP ${res.status} ${res.statusText}`);
  }

  const total = Number(res.headers.get('content-length')) || null;
  const mimeType = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
  const name = opts.name || guessFileName(res.url || target, res.headers.get('content-disposition'));
  const folderId = opts.folderId || process.env.DRIVE_FOLDER_ID || undefined;

  let loaded = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      loaded += chunk.length;
      opts.onProgress?.({ loaded, total });
      cb(null, chunk);
    },
  });
  const body = Readable.fromWeb(res.body).pipe(counter);

  const { data } = await drive.files.create(
    {
      requestBody: { name, mimeType, ...(folderId ? { parents: [folderId] } : {}) },
      media: { mimeType, body },
      fields: 'id,name,mimeType,size,webViewLink',
      supportsAllDrives: true,
    },
    { signal: opts.signal }
  );
  return data;
}
