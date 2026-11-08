// Lấy refresh token OAuth2 cho tài khoản Google của bạn.
// Yêu cầu: GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET (OAuth client loại "Desktop app") trong .env
import http from 'node:http';
import { google } from 'googleapis';
import 'dotenv/config';

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('❌ Cần đặt GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET trong file .env trước.');
  process.exit(1);
}

const PORT = Number(process.env.AUTH_PORT) || 53682;
const redirectUri = `http://127.0.0.1:${PORT}/oauth2callback`;
const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive.file'],
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, redirectUri);
  if (u.pathname !== '/oauth2callback') return res.writeHead(404).end();
  const code = u.searchParams.get('code');
  if (!code) {
    res.end('Thiếu mã xác thực: ' + (u.searchParams.get('error') || ''));
    return;
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    res.end('Xác thực thành công! Quay lại terminal để lấy refresh token.');
    console.log('\n✅ Thêm dòng sau vào file .env:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } catch (err) {
    res.end('Lỗi: ' + err.message);
    console.error('❌', err.message);
  } finally {
    server.close();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Mở link sau trong trình duyệt và đăng nhập Google:\n');
  console.log(authUrl + '\n');
});
