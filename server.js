const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'ui');

function minutesAgo(m) { return Date.now() - m * 60_000; }
function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(data));
}
function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  };
}
const sseClients = new Set();
function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}
const services = [
  { name: 'API Servers', category: 'internal', status: 'up', lastChecked: minutesAgo(12), location: 'eu-west-1' },
  { name: 'Live Investor', category: 'internal', status: 'degraded', lastChecked: minutesAgo(7), location: 'eu-west-1' },
  { name: 'Live Admin', category: 'internal', status: 'up', lastChecked: minutesAgo(8), location: 'eu-west-1' },
  { name: 'Web Servers', category: 'internal', status: 'up', lastChecked: minutesAgo(3), location: 'eu-west-1' },
  { name: 'Live website', category: 'internal', status: 'up', lastChecked: minutesAgo(3), location: 'eu-west-1' },
  { name: 'Live Web-app', category: 'internal', status: 'down', lastChecked: minutesAgo(2), location: 'eu-west-1' },
  { name: 'Onfido Services', category: 'external', status: 'up', lastChecked: minutesAgo(14), vendor: 'Onfido' },
  { name: 'Mangopay Services', category: 'external', status: 'up', lastChecked: minutesAgo(14), vendor: 'Mangopay' },
  { name: 'Hubspot Services', category: 'external', status: 'up', lastChecked: minutesAgo(10), vendor: 'Hubspot' },
  { name: 'Twiillo Services', category: 'external', status: 'up', lastChecked: minutesAgo(9), vendor: 'Twilio' },
  { name: 'Sendgrid Services', category: 'external', status: 'degraded', lastChecked: minutesAgo(5), vendor: 'SendGrid' },
  { name: 'DocuSIgn Services', category: 'external', status: 'up', lastChecked: minutesAgo(22), vendor: 'DocuSign' },
  { name: 'MongoDB services', category: 'internal', status: 'up', lastChecked: minutesAgo(4), location: 'atlas' },
  { name: 'Vercel Services', category: 'external', status: 'up', lastChecked: minutesAgo(11), vendor: 'Vercel' },
];
const logs = [
  { service: 'API Servers', level: 'info', message: 'Health check OK: 200 in 120ms', timestamp: Date.now() - 12 * 60_000 },
  { service: 'Live Investor', level: 'warn', message: 'Elevated error rate: 2.1%', timestamp: Date.now() - 7 * 60_000 },
  { service: 'Live Web-app', level: 'error', message: 'Ping failed: timeout', timestamp: Date.now() - 2 * 60_000 },
  { service: 'Sendgrid Services', level: 'warn', message: 'Rate-limited on email API', timestamp: Date.now() - 5 * 60_000 },
  { service: 'DocuSIgn Services', level: 'info', message: 'Webhook delivered', timestamp: Date.now() - 22 * 60_000 },
  { service: 'MongoDB services', level: 'info', message: 'Replica set healthy', timestamp: Date.now() - 4 * 60_000 },
  { service: 'Web Servers', level: 'info', message: 'Response time normal: p95=220ms', timestamp: Date.now() - 3 * 60_000 },
  { service: 'Twiillo Services', level: 'info', message: 'SMS sent successfully', timestamp: Date.now() - 9 * 60_000 },
  { service: 'Vercel Services', level: 'info', message: 'Deployment succeeded', timestamp: Date.now() - 11 * 60_000 },
  { service: 'Live Admin', level: 'info', message: 'Health check OK', timestamp: Date.now() - 8 * 60_000 },
];

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    default: return 'text/plain; charset=utf-8';
  }
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath);

  if (urlPath === '/api/services') {
    json(res, { services });
    return;
  }
  if (urlPath === '/api/logs') {
    json(res, { logs: logs.sort((a, b) => b.timestamp - a.timestamp) });
    return;
  }
  if (urlPath === '/api/events') {
    res.writeHead(200, sseHeaders());
    sseClients.add(res);
    res.write('retry: 10000\n\n');
    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  if (urlPath === '/' || !path.extname(filePath)) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Server Error');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': getContentType(filePath) });
    res.end(content);
  });
});

setInterval(() => {
  const idx = Math.floor(Math.random() * services.length);
  const s = services[idx];
  const states = ['up', 'degraded', 'down'];
  const next = states[Math.floor(Math.random() * states.length)];
  s.status = next;
  s.lastChecked = Date.now();
  broadcast({ type: 'service_update', service: s });
  const level = next === 'down' ? 'error' : next === 'degraded' ? 'warn' : 'info';
  const message = next === 'down' ? 'Health check failed' : next === 'degraded' ? 'Latency elevated' : 'Health check OK';
  const entry = { service: s.name, level, message, timestamp: Date.now() };
  logs.unshift(entry);
  broadcast({ type: 'log_new', log: entry });
}, 20000);

server.listen(PORT, () => {
  console.log(`Monitoring UI server running at http://localhost:${PORT}/`);
});
