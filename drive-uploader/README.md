# drive-uploader

Ứng dụng Node.js tải file từ một đường link (HTTP/HTTPS) rồi upload lên **Google Drive**.

- Link thường: file được **stream thẳng** từ nguồn lên Drive, không lưu ra ổ đĩa.
- Link có **Cloudflare** ("Just a moment...", "Checking your browser"): app tự mở link bằng **Chromium thật** (Playwright), chờ qua bước xác thực rồi mới tải và upload.
- Dùng được qua **CLI**, **giao diện web** và **API**. Có sẵn Docker, systemd và Nginx để chạy trên **VPS Linux**.

Mục lục: [Cài đặt local](#cài-đặt-local) · [Cấu hình Google Drive](#cấu-hình-google-drive) · [Sử dụng](#sử-dụng) · [Cloudflare](#link-có-cloudflare) · [Deploy lên VPS](#deploy-lên-vps-linux) · [Biến môi trường](#biến-môi-trường)

## Cài đặt local
Yêu cầu Node.js >= 18.

```bash
cd drive-uploader
npm install
npx playwright install chromium      # trình duyệt dùng cho link có Cloudflare
cp .env.example .env
```

## Cấu hình Google Drive

### Cách 1: OAuth2 (upload vào Drive cá nhân, khuyên dùng)
1. Vào [Google Cloud Console](https://console.cloud.google.com/), tạo project, rồi vào **APIs & Services → Library** và bật **Google Drive API**.
2. Vào **OAuth consent screen**: chọn *External*, thêm email của bạn vào *Test users*.
   > Khi app còn ở chế độ *Testing*, refresh token hết hạn sau 7 ngày. Bấm **Publish app** (chuyển sang *In production*) để token dùng được lâu dài. Vì đây là app cá nhân nên không cần Google duyệt.
3. Vào **Credentials → Create credentials → OAuth client ID** và chọn loại **Desktop app**. Copy *Client ID* và *Client secret* vào `.env`.
4. Chạy lệnh dưới **trên máy tính của bạn** (cần trình duyệt):
   ```bash
   npm run auth
   ```
   Mở link được in ra, đăng nhập và cấp quyền, rồi copy dòng `GOOGLE_REFRESH_TOKEN=...` vào `.env` (cả ở máy local lẫn trên VPS).
   > Nếu muốn chạy `npm run auth` ngay trên VPS: mở SSH tunnel bằng `ssh -L 53682:127.0.0.1:53682 user@vps`, rồi mở link trên trình duyệt ở máy bạn.

### Cách 2: Service Account
1. Tạo Service Account, tải file JSON key về, rồi đặt `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json`.
2. Share thư mục đích (hoặc Shared Drive) cho email của service account, rồi đặt `DRIVE_FOLDER_ID`.

> Service Account không có dung lượng lưu trữ riêng, nên phải upload vào **Shared Drive** hoặc thư mục đã được share. Với Drive cá nhân hãy dùng Cách 1.

## Sử dụng

### CLI
```bash
node src/cli.js https://example.com/file.zip
node src/cli.js https://example.com/file.zip --name backup.zip --folder <FOLDER_ID>
node src/cli.js https://a.com/1.pdf https://b.com/2.mp4          # nhiều link

# Link có Cloudflare: mặc định tự xử lý; ép luôn dùng trình duyệt:
node src/cli.js https://protected.example.com/file.zip --browser always

# Gửi kèm cookie / header (ví dụ link cần đăng nhập)
node src/cli.js https://site.com/f.zip -c "session=abc" -H "Referer: https://site.com/"
```

### Web / API
```bash
npm start            # máy có màn hình
npm run start:xvfb   # server Linux không có màn hình (cần gói xvfb)
```
Mở `http://localhost:3000` để dùng giao diện web, hoặc gọi API:

```bash
curl -X POST http://localhost:3000/api/upload \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <API_KEY>" \
  -d '{"url":"https://example.com/file.zip","name":"file.zip","folderId":"<FOLDER_ID>","browser":"auto","headers":{"Referer":"https://example.com/"}}'
# => {"jobId":"...","statusUrl":"/api/jobs/..."}

curl http://localhost:3000/api/jobs/<jobId> -H "Authorization: Bearer <API_KEY>"
# => {"status":"running|done|error","phase":"downloading|cloudflare|uploading","loaded":...,"total":...,"file":{...}}
```

## Link có Cloudflare

**Cách hoạt động**
1. App tải thử bằng request bình thường. Nếu nhận về trang thử thách của Cloudflare (header `cf-mitigated: challenge`, hoặc lỗi 403/503 từ `server: cloudflare`), app chuyển sang dùng trình duyệt.
2. Chromium (chạy có giao diện, trên VPS thì dùng màn hình ảo Xvfb) mở link và chờ Cloudflare xác thực xong (tối đa `CF_TIMEOUT_MS`).
3. Sau khi qua bước xác thực:
   - Nếu link là file tải về: trình duyệt tải file vào thư mục tạm, app upload lên Drive rồi **xóa file tạm**. Thư mục tạm cần đủ dung lượng chứa file.
   - Nếu file hiển thị ngay trong trình duyệt (video, ảnh, txt...): app lấy cookie `cf_clearance` và User-Agent của trình duyệt, rồi stream thẳng lên Drive.
   - Nếu link chỉ là một trang web chứ không phải file: app báo lỗi. Hãy dùng link tải trực tiếp.
4. Profile Chromium được lưu lại (`BROWSER_PROFILE_DIR`), nên những lần tải sau từ cùng trang thường không phải xác thực lại cho tới khi cookie hết hạn.

**Hạn chế**
- Với trang thử thách kiểu tự động ("Just a moment..." tự chuyển trang), app thường tự qua được. Nhưng nếu Cloudflare hiện ô **"Verify you are human"** bắt bấm tay (Turnstile tương tác), app **không tự giải**. IP của VPS/datacenter hay gặp trường hợp này. Cách xử lý:
  - Bật **noVNC** (`ENABLE_VNC=true`, xem bên dưới). Khi job hiện trạng thái *"Đang qua xác thực Cloudflare"*, bạn mở noVNC và tự bấm vào ô xác thực. Sau đó cookie được lưu lại cho các lần sau.
- Copy cookie `cf_clearance` từ trình duyệt trên máy bạn sang VPS **không dùng được**: cookie này gắn với IP và User-Agent của máy đã xác thực.
- Chỉ dùng cho các trang mà bạn được phép tải nội dung.

## Deploy lên VPS Linux

Cấu hình đề nghị: Ubuntu 22.04/24.04, **tối thiểu 1 vCPU / 2 GB RAM** (Chromium tốn khoảng 300 MB RAM cho mỗi job), ổ đĩa trống lớn hơn file lớn nhất bạn định tải qua Cloudflare.

### Cách A: Docker (khuyên dùng)
Image đã có sẵn Node, Chromium, Xvfb và noVNC.

```bash
# Trên VPS
curl -fsSL https://get.docker.com | sh                  # nếu chưa có Docker
git clone https://github.com/joynguyenm/joynguyenm.git
cd joynguyenm/drive-uploader
cp .env.example .env && nano .env                       # điền Google credentials, API_KEY...
docker compose up -d --build
docker compose logs -f
```
Dữ liệu (profile Chromium, file tạm) nằm trong Docker volume nên không mất khi rebuild. Cập nhật code mới bằng `git pull && docker compose up -d --build`.

### Cách B: Không dùng Docker (systemd)
```bash
git clone https://github.com/joynguyenm/joynguyenm.git
cd joynguyenm/drive-uploader
sudo bash deploy/install-ubuntu.sh          # cài Node 22, Xvfb, Chromium, tạo service
sudo nano /opt/drive-uploader/.env          # điền cấu hình
sudo systemctl restart drive-uploader
journalctl -u drive-uploader -f
```
Service chạy dưới user `driveup`, thư mục `/opt/drive-uploader`, và chỉ lắng nghe ở `127.0.0.1:3000`.

### HTTPS với Nginx + Let's Encrypt
Cả hai cách đều chỉ mở cổng 3000 trên `127.0.0.1`. Để truy cập từ ngoài, hãy đặt Nginx phía trước:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/drive-uploader
sudo nano /etc/nginx/sites-available/drive-uploader          # đổi server_name thành tên miền của bạn
sudo ln -s /etc/nginx/sites-available/drive-uploader /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d drive.example.com
sudo ufw allow 'Nginx Full' && sudo ufw allow OpenSSH && sudo ufw enable
```
**Bắt buộc đặt `API_KEY`** khi đưa app ra Internet.

Nếu không có tên miền, có thể dùng SSH tunnel thay cho Nginx: `ssh -L 3000:127.0.0.1:3000 user@vps`, rồi mở `http://localhost:3000` trên máy bạn.

### Xem trình duyệt từ xa bằng noVNC (khi Cloudflare bắt bấm tay)
Chỉ có ở cách A (Docker). Trong `.env`:
```
ENABLE_VNC=true
VNC_PASSWORD=mat-khau-manh
CF_TIMEOUT_MS=300000     # cho bạn 5 phút để bấm
```
Chạy `docker compose up -d`. Cổng 6080 chỉ mở trên localhost của VPS, nên hãy truy cập qua SSH tunnel:
```bash
ssh -L 6080:127.0.0.1:6080 user@vps
# mở http://localhost:6080/vnc.html và nhập VNC_PASSWORD
```
Khi một job ở trạng thái *"Đang qua xác thực Cloudflare"*, bạn sẽ thấy cửa sổ Chromium trong noVNC. Bấm vào ô xác thực, job sẽ tự chạy tiếp.

## Biến môi trường
| Biến | Mặc định | Mô tả |
|---|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | | Thông tin OAuth2 |
| `GOOGLE_APPLICATION_CREDENTIALS` | | Đường dẫn file key Service Account |
| `DRIVE_FOLDER_ID` | | Thư mục Drive mặc định |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Địa chỉ web server lắng nghe |
| `API_KEY` | | Nếu đặt, API yêu cầu header `Authorization: Bearer <API_KEY>` |
| `BROWSER_MODE` | `auto` | `auto` / `always` / `never`: khi nào dùng Chromium |
| `CF_TIMEOUT_MS` | `120000` | Thời gian tối đa chờ qua Cloudflare |
| `MAX_BROWSER_JOBS` | `2` | Số job dùng trình duyệt chạy cùng lúc |
| `BROWSER_IDLE_CLOSE_MS` | `300000` | Tắt Chromium sau khoảng thời gian không dùng |
| `BROWSER_PROFILE_DIR` | `./data/browser-profile` | Nơi lưu profile/cookie của Chromium |
| `DOWNLOAD_TMP_DIR` | thư mục tạm của hệ thống | Nơi lưu file tạm khi tải bằng trình duyệt |
| `BROWSER_HEADLESS` | tự động | `true`/`false`. Mặc định: có `DISPLAY` thì chạy có giao diện |
| `ENABLE_VNC`, `VNC_PASSWORD` | `false` | noVNC ở cổng 6080 (chỉ Docker) |

## Bảo mật
- Server tải **bất kỳ URL nào** được gửi tới, nên nếu bị lộ, người khác có thể lợi dụng để truy cập mạng nội bộ của VPS (SSRF) hoặc ghi vào Drive của bạn. Luôn đặt `API_KEY` và dùng HTTPS.
- Không commit `.env` hay file key JSON (đã có trong `.gitignore`).
- Scope `drive.file`: app chỉ truy cập được các file do chính nó tạo ra.
