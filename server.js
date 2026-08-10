/**
 * เซิร์ฟเวอร์เล็ก ๆ สำหรับเปิดเว็บใช้งานภายในร้าน (ไม่ต้องติดตั้งอะไรเพิ่ม)
 *
 *   node server.js            -> http://localhost:5173
 *   node server.js 8080       -> เปลี่ยนพอร์ต
 *
 * เครื่องอื่นในวง Wi-Fi เดียวกันเปิดได้ที่ http://<ไอพีเครื่องนี้>:5173
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 5173;
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);

  // กันการหลุดออกนอกโฟลเดอร์โปรเจกต์
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404</h1><p>ไม่พบไฟล์ ' + rel + '</p><p><a href="/">กลับหน้าแรก</a></p>');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  const nets = os.networkInterfaces();
  const lan = Object.values(nets).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);

  console.log('\n  🧁  Bakery Khunkai — ระบบสูตรและต้นทุนขนม');
  console.log('  ─────────────────────────────────────────');
  console.log('  เครื่องนี้      http://localhost:' + PORT);
  lan.forEach((ip) => console.log('  ในวง Wi-Fi     http://' + ip + ':' + PORT));
  console.log('\n  กด Ctrl+C เพื่อปิดเซิร์ฟเวอร์\n');
});
