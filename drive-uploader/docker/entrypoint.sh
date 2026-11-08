#!/bin/sh
set -e

# Màn hình ảo cho Chromium
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &
export DISPLAY=:99
i=0
while [ ! -e /tmp/.X11-unix/X99 ] && [ $i -lt 30 ]; do sleep 0.2; i=$((i + 1)); done

# (Tùy chọn) noVNC để xem trình duyệt qua web, cổng 6080
if [ "$ENABLE_VNC" = "true" ]; then
  if [ -z "$VNC_PASSWORD" ]; then
    echo "❌ ENABLE_VNC=true nhưng chưa đặt VNC_PASSWORD" >&2
    exit 1
  fi
  mkdir -p "$HOME/.vnc"
  x11vnc -storepasswd "$VNC_PASSWORD" "$HOME/.vnc/passwd" >/dev/null 2>&1
  x11vnc -display :99 -forever -shared -localhost -rfbport 5900 -rfbauth "$HOME/.vnc/passwd" -quiet >/dev/null 2>&1 &
  websockify --web /usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 &
  echo "🖥️  noVNC đang chạy ở cổng 6080 (mở /vnc.html)"
fi

exec node src/server.js
