// Tải file qua trình duyệt Chromium thật (Playwright) để đi qua trang xác thực Cloudflare
// ("Just a moment..."). Trình duyệt dùng profile lưu trên đĩa nên cookie cf_clearance được
// giữ lại giữa các lần tải => những lần sau thường không phải chờ xác thực nữa.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import 'dotenv/config';

const PROFILE_DIR = path.resolve(process.env.BROWSER_PROFILE_DIR || './data/browser-profile');
const TMP_ROOT = path.resolve(process.env.DOWNLOAD_TMP_DIR || os.tmpdir());
const CF_TIMEOUT_MS = Number(process.env.CF_TIMEOUT_MS) || 120_000;
const IDLE_CLOSE_MS = Number(process.env.BROWSER_IDLE_CLOSE_MS) || 5 * 60_000;
const MAX_BROWSER_JOBS = Number(process.env.MAX_BROWSER_JOBS) || 2;

/** Response có phải trang thử thách của Cloudflare không? (dùng được cho fetch Response lẫn Playwright Response) */
export function isCloudflareChallenge(status, getHeader) {
  if (getHeader('cf-mitigated') === 'challenge') return true;
  const server = (getHeader('server') || '').toLowerCase();
  return server.includes('cloudflare') && [403, 429, 503].includes(status);
}

// ---------- Quản lý 1 trình duyệt dùng chung ----------
let ctxPromise = null;
let active = 0;
let idleTimer = null;
const waiters = [];

async function acquire() {
  if (active >= MAX_BROWSER_JOBS) await new Promise((r) => waiters.push(r));
  active++;
  clearTimeout(idleTimer);
}

function release() {
  active--;
  waiters.shift()?.();
  if (active === 0) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(closeBrowser, IDLE_CLOSE_MS);
    idleTimer.unref();
  }
}

export async function closeBrowser() {
  const p = ctxPromise;
  ctxPromise = null;
  if (p) await (await p.catch(() => null))?.close().catch(() => {});
}

async function getContext() {
  if (!ctxPromise) {
    // Cloudflare dễ phát hiện chế độ headless, nên mặc định chạy có giao diện
    // (trên VPS dùng màn hình ảo Xvfb — xem README).
    const headless = process.env.BROWSER_HEADLESS
      ? process.env.BROWSER_HEADLESS === 'true'
      : !process.env.DISPLAY;
    if (headless && !process.env.BROWSER_HEADLESS) {
      console.warn('⚠️  Không có DISPLAY → chạy Chromium headless, Cloudflare có thể chặn. Nên chạy bằng xvfb-run.');
    }
    const { chromium } = await import('playwright');
    ctxPromise = fs
      .mkdir(PROFILE_DIR, { recursive: true })
      // Xóa file khóa còn sót nếu lần trước Chromium bị tắt đột ngột (chỉ app này dùng profile)
      .then(() =>
        Promise.all(
          // Lịch sử tải về cũ (Default/History) làm Chromium crash khi tải file mới → xóa luôn.
          // Cookie (cf_clearance) nằm ở file khác nên vẫn được giữ.
          ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'Default/History', 'Default/History-journal'].map(
            (f) => fs.rm(path.join(PROFILE_DIR, f), { force: true })
          )
        )
      )
      .then(() =>
        chromium.launchPersistentContext(PROFILE_DIR, {
          headless,
          executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
          acceptDownloads: true,
          viewport: { width: 1280, height: 720 },
          locale: 'en-US',
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
        })
      )
      .then((ctx) => {
        ctx.on('close', () => (ctxPromise = null));
        return ctx;
      })
      .catch((err) => {
        ctxPromise = null;
        throw err;
      });
  }
  return ctxPromise;
}

/**
 * Mở URL trong trình duyệt, chờ Cloudflare xác thực xong rồi:
 *  - nếu trình duyệt tự tải file  -> { kind: 'file', filePath, name, url, contentDisposition, contentType, cleanup }
 *  - nếu là file hiển thị inline  -> { kind: 'cookies', headers } (để tải lại bằng fetch với cookie)
 * @param {string} url
 * @param {{onStatus?:(s:string)=>void, signal?:AbortSignal}} [opts]
 */
export async function openInBrowser(url, opts = {}) {
  await acquire();
  let page;
  try {
    opts.onStatus?.('cloudflare');
    const ctx = await getContext();
    page = await ctx.newPage();
    const abort = () => page?.close().catch(() => {});
    opts.signal?.addEventListener('abort', abort, { once: true });

    // Chờ response "thật" (không phải trang thử thách) của khung chính
    let onResponse;
    let lastHeaders = {};
    const cleared = new Promise((resolve) => {
      onResponse = (res) => {
        if (res.frame() !== page.mainFrame() || !res.request().isNavigationRequest()) return;
        const h = res.headers();
        if (isCloudflareChallenge(res.status(), (k) => h[k])) return;
        lastHeaders = h;
        resolve(res);
      };
      page.on('response', onResponse);
    });
    const download = page.waitForEvent('download', { timeout: CF_TIMEOUT_MS }).catch(() => null);
    const timeout = new Promise((_, rej) =>
      setTimeout(
        () => rej(new Error(`Hết ${CF_TIMEOUT_MS / 1000}s mà chưa qua được xác thực Cloudflare`)),
        CF_TIMEOUT_MS
      ).unref()
    );

    // goto báo lỗi "Download is starting" khi link là file tải về — bỏ qua
    page.goto(url, { waitUntil: 'commit', timeout: CF_TIMEOUT_MS }).catch(() => {});

    let first = await Promise.race([download.then((d) => (d ? { d } : new Promise(() => {}))), cleared.then((r) => ({ r })), timeout]);

    if (first?.r) {
      const ct = (first.r.headers()['content-type'] || '').toLowerCase();
      const isAttachment = /attachment/i.test(first.r.headers()['content-disposition'] || '');
      if (ct.includes('text/html') && !isAttachment) {
        throw new Error(
          'Sau khi qua Cloudflare, link mở ra trang HTML chứ không phải file. Hãy dùng link tải trực tiếp.'
        );
      }
      // File: chờ một chút xem trình duyệt có tự tải không
      const d = await Promise.race([download, new Promise((r) => setTimeout(r, 5000, null))]);
      if (d) first = { d };
    }

    if (first?.d) {
      opts.onStatus?.('downloading');
      const dir = await fs.mkdtemp(path.join(TMP_ROOT, 'drive-uploader-'));
      const cleanup = () => fs.rm(dir, { recursive: true, force: true });
      const name = first.d.suggestedFilename();
      const filePath = path.join(dir, 'file');
      try {
        await first.d.saveAs(filePath);
        const failure = await first.d.failure();
        if (failure) throw new Error('Trình duyệt tải file thất bại: ' + failure);
      } catch (err) {
        await cleanup();
        throw err;
      }
      return {
        kind: 'file',
        filePath,
        name,
        url: first.d.url(),
        contentDisposition: lastHeaders['content-disposition'] || null,
        contentType: lastHeaders['content-type'] || null,
        cleanup,
      };
    }

    // File hiển thị inline (video, ảnh, pdf...) → lấy cookie + User-Agent để tải bằng fetch
    const cookies = await ctx.cookies(url);
    const userAgent = await page.evaluate(() => navigator.userAgent);
    return {
      kind: 'cookies',
      headers: {
        'User-Agent': userAgent,
        Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      },
    };
  } finally {
    if (page) {
      // Đóng trang khi đang tải dở có thể bị treo → chờ tải xong (tối đa 5s) và giới hạn thời gian đóng
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      await Promise.race([page.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000).unref())]);
    }
    release();
  }
}
