'use strict';
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
// Railway: attach a Volume and its mount path is used automatically.
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SITE_FILE = path.join(DATA_DIR, 'site.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('wecompany:' + ADMIN_PASSWORD).digest('hex');
const SESSION_DAYS = 14;
const COOKIE = 'wc_admin';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(SITE_FILE)) fs.copyFileSync(path.join(__dirname, 'default-site.json'), SITE_FILE);
if (!ADMIN_PASSWORD) console.warn('[wecompany] ADMIN_PASSWORD is not set: admin login is disabled.');

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

function readSite() { return JSON.parse(fs.readFileSync(SITE_FILE, 'utf8')); }
function writeSite(data) {
  const tmp = SITE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, SITE_FILE);
}

// ---- admin session (signed cookie, no extra dependencies) ----
function sign(v) { return crypto.createHmac('sha256', SECRET).update(v).digest('hex'); }
function makeToken() { const exp = Date.now() + SESSION_DAYS * 864e5; return exp + '.' + sign('admin:' + exp); }
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function isAdmin(req) {
  if (!ADMIN_PASSWORD) return false;
  const t = parseCookies(req)[COOKIE]; if (!t) return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign('admin:' + exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: '로그인이 필요합니다.', code: 'unauthorized' });
}
function setCookie(res, value, maxAgeSec) {
  const secure = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`);
}

// ---- uploads ----
const TYPES = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf'
};
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + TYPES[file.mimetype])
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, !!TYPES[file.mimetype])
});

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.get('/api/site', (req, res) => res.json(readSite()));
app.get('/api/me', (req, res) => res.json({ admin: isAdmin(req), loginEnabled: !!ADMIN_PASSWORD }));

let lastFail = 0;
app.post('/api/login', express.json({ limit: '10kb' }), (req, res) => {
  const pw = String((req.body && req.body.password) || '');
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'ADMIN_PASSWORD 환경 변수가 설정되지 않았습니다.', code: 'disabled' });
  const wait = Math.max(0, lastFail + 1000 - Date.now());
  setTimeout(() => {
    const a = crypto.createHash('sha256').update(pw).digest();
    const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
    if (!crypto.timingSafeEqual(a, b)) { lastFail = Date.now(); return res.status(401).json({ error: '비밀번호가 맞지 않습니다.', code: 'bad_password' }); }
    setCookie(res, makeToken(), SESSION_DAYS * 86400);
    res.json({ ok: true });
  }, wait);
});
app.post('/api/logout', (req, res) => { setCookie(res, '', 0); res.json({ ok: true }); });

app.put('/api/site', requireAdmin, express.json({ limit: '2mb' }), (req, res) => {
  const d = req.body;
  if (!d || typeof d !== 'object' || !d.info || !Array.isArray(d.factory) || !Array.isArray(d.products)) {
    return res.status(400).json({ error: '잘못된 데이터입니다.', code: 'invalid_request' });
  }
  writeSite(d);
  res.json({ ok: true });
});

app.post('/api/upload', requireAdmin, (req, res) => {
  upload.single('file')(req, res, err => {
    if (err) {
      const code = err.code === 'LIMIT_FILE_SIZE' ? 'too_large' : 'upstream_error';
      return res.status(code === 'too_large' ? 413 : 400).json({ error: err.message, code });
    }
    if (!req.file) return res.status(415).json({ error: 'JPG, PNG, WEBP, GIF, PDF만 올릴 수 있습니다.', code: 'unsupported_type' });
    res.json({ id: req.file.filename, url: '/uploads/' + req.file.filename, sizeBytes: req.file.size, contentType: req.file.mimetype });
  });
});

app.delete('/api/upload/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  if (!/^[a-f0-9]{32}\.(jpg|png|webp|gif|pdf)$/.test(id)) return res.status(400).json({ error: 'invalid id', code: 'invalid_request' });
  fs.unlink(path.join(UPLOAD_DIR, id), () => res.json({ deleted: true }));
});

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false }));

// Serve the page with the current content embedded, so it renders without waiting on the API.
function page(req, res) {
  const json = JSON.stringify(readSite()).replace(/</g, '\\u003c');
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(TEMPLATE.replace('__SITE_STATE__', () => json));
}
app.get('/', page);
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use((req, res) => res.status(404).type('text').send('Not found'));

app.listen(PORT, () => console.log(`[wecompany] listening on ${PORT}, data in ${DATA_DIR}`));
