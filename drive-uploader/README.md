# drive-uploader

Ứng dụng Node.js tải file từ một đường link (HTTP/HTTPS) rồi upload lên **Google Drive**.
File được **stream trực tiếp** từ nguồn lên Drive, không lưu tạm ra ổ đĩa, nên tải được file lớn mà không tốn dung lượng.

Có 2 cách dùng:
- **CLI**: `node src/cli.js <url>`
- **Web/API**: `npm start` → mở `http://localhost:3000`

## Yêu cầu
- Node.js >= 18

## Cài đặt
```bash
cd drive-uploader
npm install
cp .env.example .env
```

## Cấu hình Google Drive

### Cách 1 — OAuth2 (upload vào Drive cá nhân, khuyên dùng)
1. Vào [Google Cloud Console](https://console.cloud.google.com/) → tạo project → **APIs & Services → Library** → bật **Google Drive API**.
2. **OAuth consent screen**: chọn *External*, thêm email của bạn vào *Test users*.
3. **Credentials → Create credentials → OAuth client ID** → loại **Desktop app**. Copy *Client ID* và *Client secret* vào `.env`.
4. Chạy:
   ```bash
   npm run auth
   ```
   Mở link được in ra, đăng nhập và cấp quyền. Copy `GOOGLE_REFRESH_TOKEN=...` vào `.env`.

### Cách 2 — Service Account
1. Tạo Service Account, tải file JSON key, đặt `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json`.
2. Share thư mục đích (hoặc Shared Drive) cho email của service account và đặt `DRIVE_FOLDER_ID`.

> Lưu ý: Service Account không có dung lượng lưu trữ riêng, nên phải upload vào **Shared Drive** hoặc thư mục được share. Với Drive cá nhân hãy dùng Cách 1.

## Sử dụng

### CLI
```bash
# Upload 1 file
node src/cli.js https://example.com/file.zip

# Đặt tên và thư mục đích
node src/cli.js https://example.com/file.zip --name backup.zip --folder <FOLDER_ID>

# Nhiều link cùng lúc
node src/cli.js https://a.com/1.pdf https://b.com/2.mp4
```

### Web / API
```bash
npm start
```
Mở `http://localhost:3000` để dùng giao diện web, hoặc gọi API:

```bash
# Tạo job
curl -X POST http://localhost:3000/api/upload \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <API_KEY>" \
  -d '{"url":"https://example.com/file.zip","name":"file.zip","folderId":"<FOLDER_ID>"}'
# => {"jobId":"...","statusUrl":"/api/jobs/..."}

# Xem tiến độ
curl http://localhost:3000/api/jobs/<jobId> -H "Authorization: Bearer <API_KEY>"
# => {"status":"running|done|error","loaded":...,"total":...,"file":{"id","name","webViewLink",...}}
```

### Dùng như thư viện
```js
import { uploadFromUrl } from './src/drive.js';
const file = await uploadFromUrl('https://example.com/a.pdf', { folderId: '...' });
console.log(file.webViewLink);
```

## Biến môi trường
| Biến | Mô tả |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Thông tin OAuth2 |
| `GOOGLE_APPLICATION_CREDENTIALS` | Đường dẫn file key Service Account |
| `DRIVE_FOLDER_ID` | Thư mục Drive mặc định (tùy chọn) |
| `PORT` | Cổng web server (mặc định 3000) |
| `API_KEY` | Nếu đặt, API yêu cầu header `Authorization: Bearer <API_KEY>` |

## Bảo mật
- Nếu public server ra Internet, **hãy đặt `API_KEY`**, vì server sẽ tải bất kỳ URL nào được gửi tới (có thể bị lạm dụng để truy cập mạng nội bộ — SSRF).
- Không commit file `.env`, file key JSON (đã có trong `.gitignore`).
- Scope dùng là `drive.file`: app chỉ truy cập được các file do chính nó tạo ra.
