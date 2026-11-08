#!/usr/bin/env bash
# Cài drive-uploader trên Ubuntu 22.04/24.04 (không dùng Docker), chạy bằng systemd.
# Dùng: sudo bash deploy/install-ubuntu.sh   (chạy từ thư mục drive-uploader)
set -euo pipefail

APP_DIR=/opt/drive-uploader
APP_USER=driveup
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then echo "Hãy chạy bằng sudo"; exit 1; fi

# 1. Node.js 22 (nếu chưa có hoặc quá cũ)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y xvfb

# 2. User riêng + copy code
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  cp -r "$SRC_DIR"/{package.json,package-lock.json,src,public,deploy} "$APP_DIR"/
  [ -f "$SRC_DIR/.env" ] && [ ! -f "$APP_DIR/.env" ] && cp "$SRC_DIR/.env" "$APP_DIR/.env"
fi
[ -f "$APP_DIR/.env" ] || cp "$SRC_DIR/.env.example" "$APP_DIR/.env"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

# 3. Thư viện Node + Chromium (kèm thư viện hệ thống)
cd "$APP_DIR"
sudo -u "$APP_USER" PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev
npx --yes playwright@"$(node -p "require('./package.json').dependencies.playwright")" install-deps chromium
sudo -u "$APP_USER" npx playwright install chromium

# 4. systemd
cp deploy/drive-uploader.service /etc/systemd/system/drive-uploader.service
systemctl daemon-reload
systemctl enable --now drive-uploader

echo
echo "✅ Đã cài xong. Sửa cấu hình: sudo nano $APP_DIR/.env  rồi  sudo systemctl restart drive-uploader"
echo "   Xem log: journalctl -u drive-uploader -f"
