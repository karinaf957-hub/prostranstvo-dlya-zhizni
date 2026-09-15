// Только локальный сервер для браузерных проверок; приложение работает и без него.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!['index.html', 'style.css', 'app.js'].includes(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
  fs.createReadStream(path.join(root, name)).pipe(res);
}).listen(4186, '127.0.0.1', () => console.log('http://127.0.0.1:4186 — только тестовое хранилище'));
