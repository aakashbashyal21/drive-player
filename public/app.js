// Drive Player frontend: folder browser, streaming playback, and offline downloads (IndexedDB).
const $ = (sel) => document.querySelector(sel);
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const VIDEO_RE = /\.(mp4|m4v|webm|mov|mkv|avi)$/i;
const AUDIO_RE = /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i;

const state = { stack: [{ id: 'root', name: 'My Drive' }], pageToken: null };
let offlineIds = new Set();
let objectUrl = null;

const isFolder = (f) => f.mimeType === FOLDER_MIME;
const isVideo = (f) => f.mimeType?.startsWith('video/') || VIDEO_RE.test(f.name);
const isAudio = (f) => f.mimeType?.startsWith('audio/') || AUDIO_RE.test(f.name);
const isPlayable = (f) => !isFolder(f) && (isVideo(f) || isAudio(f));
const mediaUrl = (id) => `/api/drive/files/${encodeURIComponent(id)}/media`;

function fmtSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = Number(bytes);
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function button(label, onClick, cls = 'btn ghost small') {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function setStatus(msg) { $('#status').textContent = msg; }

async function api(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

// ---------- IndexedDB (offline copies) ----------
const DB_NAME = 'drive-player';
const STORE = 'downloads';

function dbRun(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE, mode);
      const r = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(r.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
const dbPut = (rec) => dbRun('readwrite', (s) => s.put(rec));
const dbDelete = (id) => dbRun('readwrite', (s) => s.delete(id));
const dbAll = () => dbRun('readonly', (s) => s.getAll());

// ---------- Boot and navigation ----------
function show(section) {
  for (const id of ['login', 'connect', 'browser']) $(`#${id}`).classList.toggle('hidden', id !== section);
}

async function boot() {
  let me;
  try {
    me = await api('/api/me');
  } catch {
    show('login');
    return;
  }
  if (!me.github) return show('login');

  $('#userName').textContent = `@${me.github.login}`;
  $('#userbox').classList.remove('hidden');
  if (!me.googleConnected) return show('connect');

  show('browser');
  await renderOffline();
  const saved = localStorage.getItem('lastFolder');
  if (saved) {
    try { openRoot(JSON.parse(saved)); return; } catch {}
  }
  await loadPage(true);
}

function openRoot(folder) {
  state.stack = [folder];
  loadPage(true);
}

async function openFolder(folder) {
  state.stack.push({ id: folder.id, name: folder.name });
  await loadPage(true);
}

async function goBack() {
  if (state.stack.length < 2) return;
  state.stack.pop();
  await loadPage(true);
}

function renderCrumbs() {
  $('#crumbs').textContent = state.stack.map((f) => f.name).join(' / ');
  $('#backBtn').hidden = state.stack.length < 2;
}

async function loadPage(reset) {
  const folder = state.stack.at(-1);
  if (reset) {
    state.pageToken = null;
    $('#files').replaceChildren();
  }
  renderCrumbs();
  setStatus('Loading...');
  try {
    const qs = state.pageToken ? `?pageToken=${encodeURIComponent(state.pageToken)}` : '';
    const data = await api(`/api/drive/folders/${encodeURIComponent(folder.id)}${qs}`);
    for (const f of data.files) $('#files').append(renderItem(f));
    state.pageToken = data.nextPageToken;
    $('#moreBtn').classList.toggle('hidden', !state.pageToken);
    setStatus($('#files').children.length ? '' : 'This folder is empty.');
  } catch (err) {
    handleError(err);
  }
}

function handleError(err) {
  if (err.status === 401) {
    show(/Google/.test(err.message) ? 'connect' : 'login');
    return;
  }
  setStatus(err.message);
}

// ---------- Rendering ----------
function renderItem(f) {
  const li = document.createElement('li');
  li.className = 'item';
  li._file = f;

  const info = document.createElement('div');
  info.className = 'info';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = (isFolder(f) ? '📁 ' : '') + f.name;
  const meta = document.createElement('div');
  meta.className = 'muted small';
  meta.textContent = isFolder(f) ? 'Folder' : [fmtSize(f.size), f.mimeType].filter(Boolean).join(' · ');
  info.append(name, meta);

  const actions = document.createElement('div');
  actions.className = 'actions';
  if (isFolder(f)) {
    actions.append(button('Open', () => openFolder(f)));
  } else if (isPlayable(f)) {
    actions.append(button('Play', () => play(f)));
    if (offlineIds.has(f.id)) {
      actions.append(button('Saved', () => {}));
      actions.lastChild.disabled = true;
    } else {
      actions.append(button('Download', (e) => download(f, e.currentTarget)));
    }
  }

  li.append(info, actions);
  return li;
}

async function renderOffline() {
  const list = (await dbAll()).sort((a, b) => b.savedAt - a.savedAt);
  offlineIds = new Set(list.map((r) => r.id));
  const ul = $('#offline');
  ul.replaceChildren();
  $('#offlineEmpty').classList.toggle('hidden', list.length > 0);

  for (const r of list) {
    const li = document.createElement('li');
    li.className = 'item';
    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = r.name;
    const meta = document.createElement('div');
    meta.className = 'muted small';
    meta.textContent = fmtSize(r.size);
    info.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      button('Play', () => play(r, r.blob)),
      button('Delete', async () => {
        await dbDelete(r.id);
        await renderOffline();
        renderCurrentPageButtons();
      }),
    );
    li.append(info, actions);
    ul.append(li);
  }
}

// Refreshes the Play/Download/Saved buttons on the visible list after offline changes.
function renderCurrentPageButtons() {
  const items = [...$('#files').children];
  const files = items.map((li) => li._file).filter(Boolean);
  if (!files.length) return;
  $('#files').replaceChildren(...files.map(renderItem));
}

// ---------- Playback ----------
function play(file, blob) {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  const useVideo = isVideo(file);
  const el = useVideo ? $('#video') : $('#audio');
  const other = useVideo ? $('#audio') : $('#video');
  other.pause();
  other.removeAttribute('src');
  other.load();
  other.hidden = true;

  if (blob) {
    objectUrl = URL.createObjectURL(blob);
    el.src = objectUrl;
  } else {
    el.src = mediaUrl(file.id); // Range requests are handled by the server, so seeking works
  }
  el.hidden = false;

  $('#nowName').textContent = file.name;
  $('#playerSource').textContent = blob ? 'Playing offline copy' : 'Streaming from Google Drive';
  $('#player').classList.remove('hidden');
  document.body.classList.add('has-player');
  el.play().catch(() => {});
}

function closePlayer() {
  for (const el of [$('#video'), $('#audio')]) {
    el.pause();
    el.removeAttribute('src');
    el.load();
    el.hidden = true;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  $('#player').classList.add('hidden');
  document.body.classList.remove('has-player');
}

// ---------- Offline download ----------
async function download(f, btn) {
  btn.disabled = true;
  btn.textContent = '0%';
  try {
    const res = await fetch(mediaUrl(f.id), { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);

    const total = Number(res.headers.get('content-length')) || Number(f.size) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      btn.textContent = total ? `${Math.floor((received / total) * 100)}%` : fmtSize(received);
    }

    const type = res.headers.get('content-type') || f.mimeType || 'application/octet-stream';
    const blob = new Blob(chunks, { type });
    await dbPut({ id: f.id, name: f.name, mimeType: type, size: blob.size, savedAt: Date.now(), blob });
    await renderOffline();
    renderCurrentPageButtons();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Retry';
    setStatus(err.message);
  }
}

// ---------- Events ----------
$('#folderForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = parseFolderId($('#folderInput').value);
  if (!id) return setStatus('Folder link ya ID milena.');
  const folder = { id, name: 'Shared folder' };
  localStorage.setItem('lastFolder', JSON.stringify(folder));
  openRoot(folder);
});

function parseFolderId(input) {
  const v = input.trim();
  if (v === 'root') return v;
  const m = v.match(/folders\/([\w-]+)/) || v.match(/[?&]id=([\w-]+)/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(v) ? v : null;
}

$('#moreBtn').addEventListener('click', () => loadPage(false));
$('#backBtn').addEventListener('click', goBack);
$('#closePlayer').addEventListener('click', closePlayer);
$('#logoutBtn').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
  localStorage.removeItem('lastFolder');
  location.reload();
});

boot();
