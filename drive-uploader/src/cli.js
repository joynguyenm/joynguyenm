#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { uploadFromUrl } from './drive.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string', short: 'n' },
    folder: { type: 'string', short: 'f' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || positionals.length === 0) {
  console.log(`Cách dùng: node src/cli.js <url> [url2 ...] [--name <tên file>] [--folder <folderId>]

  -n, --name     Tên file trên Drive (chỉ áp dụng khi có 1 URL)
  -f, --folder   ID thư mục Drive đích (mặc định: DRIVE_FOLDER_ID trong .env)
  -h, --help     Hiển thị trợ giúp`);
  process.exit(positionals.length === 0 && !values.help ? 1 : 0);
}

const fmt = (b) => (b / 1024 / 1024).toFixed(2) + ' MB';
let failed = 0;

for (const url of positionals) {
  console.log(`\n⬇️  ${url}`);
  let last = 0;
  try {
    const file = await uploadFromUrl(url, {
      name: positionals.length === 1 ? values.name : undefined,
      folderId: values.folder,
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
process.exit(failed ? 1 : 0);
