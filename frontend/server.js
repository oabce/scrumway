const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8001;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // Prevent directory traversal
  let safeUrl = req.url.split('?')[0];
  if (safeUrl === '/') safeUrl = '/index.html';
  const filePath = path.join(PUBLIC_DIR, safeUrl);
  const relative = path.relative(PUBLIC_DIR, filePath);
  const isSafe = !relative.startsWith('..') && !path.isAbsolute(relative);
  
  if (!isSafe) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Access Denied');
    return;
  }
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Not Found');
      return;
    }
    
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
