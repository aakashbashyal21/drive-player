// Zero-dependency server: GitHub login, Google Drive OAuth, folder listing and media proxy.
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const ID_RE = /^[\w-]+$/;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
};

// Minimal .env loader so there is no dotenv dependency.
try {
  const lines = (await readFile('.env', 'utf8')).split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {}

const env = process.env;
const PORT = Number(env.PORT || 3000);
const BASE_URL = (env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ALLOWED = (env.ALLOWED_GITHUB_LOGINS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

for (const key of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
  if (!env[key]) {
    console.error(`Missing ${key}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

// In-memory sessions: fine for a personal app. Restarting the server asks you to log in again.
const sessions = new Map();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

function getSession(req, res) {
  const sid = /(?:^|;\s*)sid=([\w-]+)/.exec(req.headers.cookie || '')?.[1];
  if (sid && sessions.has(sid)) return { sid, data: sessions.get(sid) };
  const id = crypto.randomBytes(24).toString('base64url');
  const data = {};
  sessions.set(id, data);
  const secure = BASE_URL.startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`);
  return { sid: id, data };
}

// Each send/redirect returns true so the router knows the request was handled.
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
  return true;
}

function redirect(res, url) {
  res.writeHead(302, { Location: url });
  res.end();
  return true;
}

function requireGithub(s) {
  if (!s.github) throw new HttpError(401, 'Login with GitHub first');
}

// Returns a valid Google access token, refreshing it when it is close to expiry.
async function googleToken(s) {
  const g = s.google;
  if (!g) throw new HttpError(401, 'Google Drive not connected');
  if (g.expiresAt - Date.now() > 60_000) return g.accessToken;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: g.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await r.json();
  if (!r.ok) {
    delete s.google;
    throw new HttpError(401, 'Google session expired, connect Google Drive again');
  }
  g.accessToken = data.access_token;
  g.expiresAt = Date.now() + data.expires_in * 1000;
  return g.accessToken;
}

async function handleApi(req, res, url, s) {
  const p = url.pathname;

  if (req.method === 'GET' && p === '/api/me') {
    return send(res, 200, { github: s.data.github || null, googleConnected: Boolean(s.data.google) });
  }

  const folderMatch = /^\/api\/drive\/folders\/([\w-]+)$/.exec(p);
  if (req.method === 'GET' && folderMatch) {
    requireGithub(s.data);
    const token = await googleToken(s.data);
    const params = new URLSearchParams({
      q: `'${folderMatch[1]}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)',
      orderBy: 'folder,name',
      pageSize: '200',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (url.searchParams.get('pageToken')) params.set('pageToken', url.searchParams.get('pageToken'));

    const r = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await r.json();
    if (r.status === 401) {
      delete s.data.google;
      throw new HttpError(401, 'Google session expired, connect Google Drive again');
    }
    if (!r.ok) throw new HttpError(r.status, data.error?.message || 'Drive error');
    return send(res, 200, { files: data.files || [], nextPageToken: data.nextPageToken || null });
  }

  const mediaMatch = /^\/api\/drive\/files\/([\w-]+)\/media$/.exec(p);
  if (req.method === 'GET' && mediaMatch) {
    requireGithub(s.data);
    const token = await googleToken(s.data);
    const headers = { Authorization: `Bearer ${token}` };
    // Forward Range so the browser can seek and stream without downloading everything first.
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await fetch(
      `https://www.googleapis.com/drive/v3/files/${mediaMatch[1]}?alt=media&supportsAllDrives=true`,
      { headers },
    );
    if (!upstream.ok && upstream.status !== 206) {
      const data = await upstream.json().catch(() => ({}));
      throw new HttpError(upstream.status, data.error?.message || 'Could not read file');
    }

    res.statusCode = upstream.status;
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('Cache-Control', 'private, no-cache');
    if (!upstream.body) return res.end();

    const body = Readable.fromWeb(upstream.body);
    body.on('error', () => res.destroy());
    res.on('close', () => body.destroy());
    return body.pipe(res);
  }

  return false;
}

async function handleAuth(req, res, url, s) {
  const p = url.pathname;
  const base = `${BASE_URL}`;

  if (req.method === 'GET' && p === '/auth/github') {
    s.data.oauthState = crypto.randomBytes(16).toString('hex');
    const q = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      redirect_uri: `${base}/auth/github/callback`,
      scope: 'read:user',
      state: s.data.oauthState,
    });
    return redirect(res, `https://github.com/login/oauth/authorize?${q}`);
  }

  if (req.method === 'GET' && p === '/auth/github/callback') {
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.get('state') !== s.data.oauthState) {
      throw new HttpError(400, 'Invalid OAuth state, try logging in again');
    }
    delete s.data.oauthState;

    const tr = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${base}/auth/github/callback`,
      }),
    });
    const tok = await tr.json();
    if (!tok.access_token) throw new HttpError(400, `GitHub login failed: ${tok.error || 'no token'}`);

    const ur = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tok.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'drive-player',
      },
    });
    const user = await ur.json();
    if (ALLOWED.length && !ALLOWED.includes(user.login.toLowerCase())) {
      throw new HttpError(403, 'This GitHub account is not allowed to use the app');
    }
    s.data.github = { login: user.login, name: user.name, avatarUrl: user.avatar_url };
    return redirect(res, '/');
  }

  if (req.method === 'GET' && p === '/auth/google') {
    requireGithub(s.data);
    s.data.googleState = crypto.randomBytes(16).toString('hex');
    const q = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${base}/auth/google/callback`,
      response_type: 'code',
      scope: DRIVE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state: s.data.googleState,
    });
    return redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  }

  if (req.method === 'GET' && p === '/auth/google/callback') {
    requireGithub(s.data);
    if (url.searchParams.get('error')) throw new HttpError(400, `Google: ${url.searchParams.get('error')}`);
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.get('state') !== s.data.googleState) {
      throw new HttpError(400, 'Invalid OAuth state, try connecting again');
    }
    delete s.data.googleState;

    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${base}/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const data = await r.json();
    if (!r.ok || !data.refresh_token) {
      throw new HttpError(400, `Google token error: ${data.error_description || data.error || 'no refresh token'}`);
    }
    s.data.google = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return redirect(res, '/');
  }

  if (req.method === 'POST' && p === '/auth/logout') {
    sessions.delete(s.sid);
    res.setHeader('Set-Cookie', 'sid=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
    return send(res, 200, { ok: true });
  }

  return false;
}

async function serveStatic(url, res) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) throw new HttpError(403, 'Forbidden');
  try {
    await access(file);
  } catch {
    throw new HttpError(404, 'Not found');
  }
  const body = await readFile(file);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);
    if (req.method !== 'GET' && req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

    const s = getSession(req, res);
    if (await handleAuth(req, res, url, s)) return;
    if (await handleApi(req, res, url, s)) return;

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
      throw new HttpError(404, 'Not found');
    }
    return await serveStatic(url, res);
  } catch (err) {
    if (res.headersSent) return res.destroy();
    if (!(err instanceof HttpError)) console.error(err);
    send(res, err.status || 500, { error: err.expose ? err.message : 'Server error' });
  }
});

server.listen(PORT, () => console.log(`Drive Player running at ${BASE_URL}`));
