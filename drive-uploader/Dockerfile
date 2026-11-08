# Image Playwright đã có sẵn Node.js, Chromium và đủ thư viện hệ thống.
# Phiên bản phải trùng với "playwright" trong package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

# Xvfb: màn hình ảo để chạy Chromium có giao diện (Cloudflare hay chặn headless)
# x11vnc + noVNC: (tùy chọn) xem/thao tác trình duyệt từ xa khi Cloudflare bắt bấm "Verify you are human"
RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY docker/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
 && mkdir -p /app/data /app/tmp \
 && chown -R pwuser:pwuser /app/data /app/tmp

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    BROWSER_PROFILE_DIR=/app/data/browser-profile \
    DOWNLOAD_TMP_DIR=/app/tmp

USER pwuser
EXPOSE 3000 6080
ENTRYPOINT ["/entrypoint.sh"]
