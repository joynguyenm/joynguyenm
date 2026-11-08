#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { uploadFromUrl } from './drive.js';
import { closeBrowser } from './browser.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string', short: 'n' },
    folder: { type: 'string', short: 'f' },
    browser: { type: 'string', short: 'b' },
    cookie: { type: 'string', short: 'c' },
    'user-agent': { type: 'string' },
    header: { type: 'string', short: 'H', multiple: true },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || positionals.length === 0) {
  console.log(`Cách dùng: node src/cli.js <url> [url2 ...] [--name <tên file>] [--folder <folderId>]

  -n, --name     Tên file trên Drive (chỉ áp dụng khi có 1 URL)
  -f, --folder   ID thư mục Drive đích (mặc định: DRIVE_FOLDER_ID trong .env)
  -b, --browser  auto | always | never — dùng Chromium để qua Cloudflare (mặc định: auto)
  -c, --cookie   Chuỗi Cookie gửi kèm khi tải
      --user-agent  User-Agent gửi kèm
  -H, --header   Header thêm, dạng "Tên: giá trị" (lặp lại được)
  -h, --help     Hiển thị trợ giúp`);
  process.exit(positionals.length === 0 && !values.help ? 1 : 0);
}

const headers = {};
for (const h of values.header ?? []) {
  const i = h.indexOf(':');
  if (i > 0) headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
}
if (values.cookie) headers.Cookie = values.cookie;
if (values['user-agent']) headers['User-Agent'] = values['user-agent'];
if (values.browser && !['auto', 'always', 'never'].includes(values.browser)) {
  console.error('--browser phải là auto, always hoặc never');
  process.exit(1);
}

const STATUS = { downloading: 'Đang tải', cloudflare: '🛡️  Đang qua xác thực Cloudflare bằng trình duyệt...', uploading: 'Đang upload' };
const fmt = (b) => (b / 1024 / 1024).toFixed(2) + ' MB';
let failed = 0;

for (const url of positionals) {
  console.log(`\n⬇️  ${url}`);
  let last = 0;
  try {
    const file = await uploadFromUrl(url, {
      name: positionals.length === 1 ? values.name : undefined,
      folderId: values.folder,
      headers,
      browser: values.browser,
      onStatus: (st) => st === 'cloudflare' && console.log('   ' + STATUS[st]),
      onProgress: ({ loaded, total }) => {
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        const pct = total ? ` (${((loaded / total) * 100).toFixed(1)}%)` : '';
        process.stdout.write(`\r   Đang chuyển: ${fmt(loaded)}${total ? ' / ' + fmt(total) : ''}${pct}   `);
      },
    });
    console.log(`\n✅ Đã upload: ${file.name} (${fmt(Number(file.size || 0))})`);
    console.log(`   ID:   ${file.id}`);
    console.log(`   Link: ${file.webViewLink}`);
  } catch (err) {
    failed++;
    console.error(`\n❌ Lỗi: ${err.message}`);
  }
}
await closeBrowser();
process.exit(failed ? 1 : 0);
