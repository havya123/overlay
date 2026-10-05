/**
 * Guitar Island — tiny zero-dependency server.
 * Serves the overlay/control pages and relays state via Server-Sent Events.
 *
 *   node server.js            -> http://localhost:7777
 *   PORT=8080 node server.js  -> custom port
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 7777;
const HOST = process.env.HOST || '0.0.0.0';
const OVERLAY_TOKEN = String(process.env.OVERLAY_TOKEN || '');
const ROOT = __dirname;
const STATE_FILE = path.join(ROOT, 'state.json');
const COVERS_DIR = path.join(ROOT, 'covers');
const MAX_UPLOAD = 10 * 1024 * 1024;
const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { state = {}; }
// Never resume "playing" from a stale file — the timer would be wrong.
if (state.playing) {
  state.elapsedBefore = (state.elapsedBefore || 0) + (state.startedAt ? Date.now() - state.startedAt : 0);
  state.playing = false;
  state.startedAt = 0;
}

const clients = new Set();
const YOUTUBE_LEASE_MS = 7000;

state.syncEnabled = state.syncEnabled !== false;
state.sync = {
  source: 'manual', ownerId: '', tabId: 0, leaseUntil: 0, revision: 0,
  ...(state.sync || {}),
};
if (!state.media || typeof state.media !== 'object') state.media = null;

function expireYouTubeOwner() {
  if (state.sync.source !== 'youtube' || !state.sync.leaseUntil || Date.now() <= state.sync.leaseUntil) return false;
  state.sync = { ...state.sync, source: 'manual', ownerId: '', tabId: 0, leaseUntil: 0, revision: state.sync.revision + 1 };
  if (state.media) state.media = { ...state.media, connected: false };
  if (state.playing) {
    state.elapsedBefore = 0;
    state.startedAt = 0;
    state.playing = false;
  }
  save();
  broadcast();
  return true;
}

function authorized(req, url) {
  if (!OVERLAY_TOKEN) return true;
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token');
  return token === OVERLAY_TOKEN;
}

function requireAuth(req, res, url) {
  if (authorized(req, url)) return true;
  sendJSON(res, 401, { error: 'Token không hợp lệ hoặc bị thiếu' });
  return false;
}

const payload = () => JSON.stringify({ ...state, serverTime: Date.now() });

function broadcast() {
  const msg = `data: ${payload()}\n\n`;
  for (const res of clients) res.write(msg);
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), () => {});
  }, 300);
}

function readBody(req, max = 1e6) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > max) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function readBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('File quá lớn (tối đa 10MB)')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ---------------- iTunes lookup (cached) ---------------- */
const searchCache = new Map(); // key -> { at, items }
const CACHE_TTL = 10 * 60 * 1000;

const artSize = (url, size) => String(url || '').replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`);

// "Song (Remastered 2013)" / "Song - 2011 Remaster" -> "Song"
const cleanTitle = (t) =>
  String(t || '')
    .replace(/\s*[\(\[][^\)\]]*remaster[^\)\]]*[\)\]]/gi, '')
    .replace(/\s+-\s+[^-]*remaster.*$/gi, '')
    .trim();

/* US + VN stores in parallel, interleaved so both English and Vietnamese songs rank well. */
async function itunesSearch(q, limit = 15) {
  const key = `${q.toLowerCase()}|${limit}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.items;

  const stores = ['US', 'VN'];
  const results = await Promise.allSettled(
    stores.map(async (country) => {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=${limit}&country=${country}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(`iTunes ${res.status}`);
      return (await res.json()).results || [];
    })
  );
  const lists = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!lists.length) throw new Error('iTunes không phản hồi');

  const items = [];
  for (let i = 0; i < Math.max(...lists.map((l) => l.length), 0); i++) {
    for (const l of lists) if (l[i] && l[i].artworkUrl100) items.push(l[i]);
  }
  searchCache.set(key, { at: Date.now(), items });
  if (searchCache.size > 300) searchCache.delete(searchCache.keys().next().value);
  return items;
}

/* Song suggestions for the title autocomplete. */
async function searchSongs(q) {
  const seen = new Set();
  const out = [];
  for (const item of await itunesSearch(q)) {
    const title = cleanTitle(item.trackName);
    const key = `${title.toLowerCase()}|${String(item.artistName).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      artist: item.artistName || '',
      album: cleanTitle(item.collectionName),
      year: item.releaseDate ? new Date(item.releaseDate).getFullYear() : null,
      duration: item.trackTimeMillis || 0,
      genre: item.primaryGenreName || '',
      thumb: artSize(item.artworkUrl100, 120),
      cover: artSize(item.artworkUrl100, 600),
    });
  }
  return out.slice(0, 8);
}

/* Album art choices (one per album). */
async function searchCovers(q) {
  const seen = new Set();
  const out = [];
  for (const item of await itunesSearch(q, 10)) {
    const cover = artSize(item.artworkUrl100, 600);
    const key = item.collectionId || cover;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: item.trackName || '',
      artist: item.artistName || '',
      album: item.collectionName || '',
      thumb: artSize(item.artworkUrl100, 200),
      cover,
    });
  }
  return out.slice(0, 12);
}

function sendJSON(res, code, body) {
  res.writeHead(code, {
    'Content-Type': MIME['.json'],
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const YOUTUBE_MANUAL_KEYS = new Set(['syncEnabled', 'theme', 'autoColor', 'mode', 'showNext', 'visible', 'nextOverrideId', 'setlist']);

function isYouTubeSafePatch(patch) {
  return Object.keys(patch).every((key) => YOUTUBE_MANUAL_KEYS.has(key));
}
function text(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function finite(value, min, max, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function youtubePatch(input) {
  const ownerId = text(input.ownerId, 100);
  const tabId = finite(input.tabId, 0, 2 ** 31 - 1, 0);
  const videoId = text(input.videoId, 32);
  const sequence = finite(input.sequence, 0, Number.MAX_SAFE_INTEGER);
  if (!ownerId || !/^[\w-]{6,32}$/.test(videoId) || sequence === null) throw new Error('Dữ liệu YouTube không hợp lệ');

  const title = text(input.title, 200) || 'YouTube';
  const artist = text(input.artist, 160);
  const thumbnail = text(input.thumbnail, 1000);
  const videoUrl = text(input.videoUrl, 1000);
  const positionSec = finite(input.positionSec, 0, 60 * 60 * 24, 0);
  const rawDuration = input.durationSec === null ? null : finite(input.durationSec, 0, 60 * 60 * 24);
  const durationSec = rawDuration === null ? null : rawDuration;
  const playbackRate = finite(input.playbackRate, 0.1, 4, 1);
  const playing = input.playing === true;

  if (thumbnail && !/^https:\/\/i\.ytimg\.com\//i.test(thumbnail)) throw new Error('Thumbnail YouTube không hợp lệ');
  if (videoUrl && !/^https:\/\/(www\.)?youtube\.com\/watch\?/i.test(videoUrl)) throw new Error('URL YouTube không hợp lệ');

  return { ownerId, tabId, videoId, sequence, title, artist, thumbnail, videoUrl, positionSec, durationSec, playbackRate, playing };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  // --- SSE stream ---
  if (url.pathname === '/api/events') {
    if (!requireAuth(req, res, url)) return;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 1000\n\n');
    res.write(`data: ${payload()}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // --- Claim the single YouTube owner tab ---
  if (url.pathname === '/api/youtube/claim' && req.method === 'POST') {
    if (!requireAuth(req, res, url)) return;
    try {
      const input = JSON.parse((await readBody(req, 4 * 1024)) || '{}');
      if (state.syncEnabled === false) return sendJSON(res, 409, { error: 'Đồng bộ YouTube đang tắt' });
      const ownerId = text(input.ownerId, 100);
      if (!ownerId) return sendJSON(res, 422, { error: 'Thiếu ownerId' });
      const current = state.sync || {};
      if (current.source === 'youtube' && current.leaseUntil > Date.now() && current.ownerId && current.ownerId !== ownerId) {
        return sendJSON(res, 409, { error: 'Một tab YouTube khác đang điều khiển overlay' });
      }
      state.sync = {
        source: 'youtube', ownerId, tabId: finite(input.tabId, 0, 2 ** 31 - 1, 0),
        leaseUntil: Date.now() + YOUTUBE_LEASE_MS,
        revision: (state.sync?.revision || 0) + 1,
      };
      state.media = state.media ? { ...state.media, connected: false, sequence: -1 } : null;
      state.playing = false;
      state.startedAt = 0;
      broadcast();
      save();
      return sendJSON(res, 200, JSON.parse(payload()));
    } catch (err) {
      return sendJSON(res, 422, { error: String(err.message || err) });
    }
  }

  // --- Release the selected YouTube owner tab ---
  if (url.pathname === '/api/youtube/release' && req.method === 'POST') {
    if (!requireAuth(req, res, url)) return;
    try {
      const input = JSON.parse((await readBody(req, 4 * 1024)) || '{}');
      const ownerId = text(input.ownerId, 100);
      if (!ownerId || state.sync?.source !== 'youtube' || state.sync.ownerId !== ownerId) {
        return sendJSON(res, 409, { error: 'Tab này không sở hữu đồng bộ YouTube' });
      }
      state.sync = { ...state.sync, source: 'manual', ownerId: '', tabId: 0, leaseUntil: 0, revision: (state.sync.revision || 0) + 1 };
      state.playing = false;
      state.startedAt = 0;
      state.elapsedBefore = 0;
      state.media = state.media ? { ...state.media, connected: false } : null;
      broadcast();
      save();
      return sendJSON(res, 200, JSON.parse(payload()));
    } catch (err) {
      return sendJSON(res, 422, { error: String(err.message || err) });
    }
  }

  // --- YouTube extension sync (read-only source -> overlay) ---
  if (url.pathname === '/api/youtube/sync' && req.method === 'POST') {
    if (!requireAuth(req, res, url)) return;
    try {
      const media = youtubePatch(JSON.parse((await readBody(req, 16 * 1024)) || '{}'));
      const now = Date.now();
      const owner = state.sync || {};
      const ownerAlive = owner.source === 'youtube' && owner.leaseUntil > now;

      if (ownerAlive && owner.ownerId !== media.ownerId) {
        return sendJSON(res, 409, { error: 'Một tab YouTube khác đang điều khiển overlay' });
      }
      if (ownerAlive && media.sequence <= (state.media && state.media.sequence || -1)) {
        return sendJSON(res, 409, { error: 'Bản tin YouTube đã cũ' });
      }
      if (state.syncEnabled === false) return sendJSON(res, 409, { error: 'Đồng bộ YouTube đang tắt' });

      state.sync = {
        source: 'youtube', ownerId: media.ownerId, tabId: media.tabId,
        leaseUntil: now + YOUTUBE_LEASE_MS,
        revision: (owner.revision || 0) + 1,
      };
      state.media = { ...media, observedAt: now, connected: true };
      state.playing = media.playing;
      state.startedAt = 0;
      state.elapsedBefore = 0;
      state.title = media.title;
      state.artist = media.artist;
      if (media.thumbnail) state.cover = media.thumbnail;
      broadcast();
      save();
      return sendJSON(res, 200, JSON.parse(payload()));
    } catch (err) {
      return sendJSON(res, 422, { error: String(err.message || err) });
    }
  }

  // --- State API ---
  if (url.pathname === '/api/state') {
    if (!requireAuth(req, res, url)) return;
    if (req.method === 'GET') return sendJSON(res, 200, payload());
    if (req.method === 'POST') {
      try {
        const patch = JSON.parse((await readBody(req)) || '{}');
        expireYouTubeOwner();
        if (patch.syncEnabled === false && state.sync?.source === 'youtube') {
          state.sync = { ...state.sync, source: 'manual', ownerId: '', tabId: 0, leaseUntil: 0, revision: (state.sync.revision || 0) + 1 };
          state.playing = false;
          state.startedAt = 0;
          state.media = state.media ? { ...state.media, connected: false } : null;
        } else if (state.sync && state.sync.source === 'youtube' && state.sync.leaseUntil > Date.now() && !isYouTubeSafePatch(patch)) {
          return sendJSON(res, 409, { error: 'Hãy tắt đồng bộ YouTube trước khi chỉnh bài thủ công' });
        }
        if (patch.startedAt === 'now') patch.startedAt = Date.now();
        state = { ...state, ...patch };
        broadcast();
        save();
        return sendJSON(res, 200, payload());
      } catch (err) {
        return sendJSON(res, 400, { error: String(err.message || err) });
      }
    }
    return sendJSON(res, 405, { error: 'Method not allowed' });
  }

  // --- Cover upload (raw image body) ---
  if (url.pathname === '/api/upload' && req.method === 'POST') {
    try {
      const type = String(req.headers['content-type'] || '').split(';')[0].trim();
      const ext = IMAGE_EXT[type];
      if (!ext) return sendJSON(res, 415, { error: 'Chỉ hỗ trợ JPG, PNG, WEBP, GIF' });
      const buf = await readBuffer(req, MAX_UPLOAD);
      if (!buf.length) return sendJSON(res, 400, { error: 'File rỗng' });
      const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + ext;
      await fs.promises.mkdir(COVERS_DIR, { recursive: true });
      await fs.promises.writeFile(path.join(COVERS_DIR, name), buf);
      return sendJSON(res, 200, { url: `/covers/${name}` });
    } catch (err) {
      return sendJSON(res, 400, { error: String(err.message || err) });
    }
  }

  // --- Song suggestions (title autocomplete) ---
  if (url.pathname === '/api/song-search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) return sendJSON(res, 200, { results: [] });
    try {
      return sendJSON(res, 200, { results: await searchSongs(q) });
    } catch (err) {
      return sendJSON(res, 502, { error: 'Không tìm được bài hát (kiểm tra mạng)' });
    }
  }

  // --- Cover search ---
  if (url.pathname === '/api/cover-search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return sendJSON(res, 400, { error: 'Thiếu từ khóa' });
    try {
      return sendJSON(res, 200, { results: await searchCovers(q) });
    } catch (err) {
      return sendJSON(res, 502, { error: 'Không tìm được ảnh bìa (kiểm tra mạng)' });
    }
  }

  // --- Download an external cover into covers/ (same-origin + works offline) ---
  if (url.pathname === '/api/cover-fetch') {
    const src = (url.searchParams.get('url') || '').trim();
    if (!/^https?:\/\//i.test(src)) return sendJSON(res, 400, { error: 'URL không hợp lệ' });
    try {
      const r = await fetch(src, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 GuitarIsland' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const type = String(r.headers.get('content-type') || '').split(';')[0].trim();
      const ext = IMAGE_EXT[type];
      if (!ext) throw new Error('Không phải ảnh');
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_UPLOAD) throw new Error('Ảnh quá lớn');
      const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + ext;
      await fs.promises.mkdir(COVERS_DIR, { recursive: true });
      await fs.promises.writeFile(path.join(COVERS_DIR, name), buf);
      return sendJSON(res, 200, { url: `/covers/${name}` });
    } catch (err) {
      return sendJSON(res, 502, { error: `Không tải được ảnh: ${err.message || err}` });
    }
  }

  // --- Static files ---
  let rel = url.pathname === '/' ? '/control.html' : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || path.basename(file) === 'state.json') {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
});

// Keep SSE connections alive through proxies / sleeping tabs.
setInterval(() => { expireYouTubeOwner(); for (const res of clients) res.write(': ping\n\n'); }, 15000);

server.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

  console.log('\n  🎸 Guitar Island đang chạy\n');
  console.log(`  Host: ${HOST}`);
  console.log(`  Overlay (OBS Browser Source): http://localhost:${PORT}/overlay.html`);
  console.log(`  Control (OBS Custom Dock):    http://localhost:${PORT}/control.html`);
  if (OVERLAY_TOKEN) console.log('  API token: đã bật (OVERLAY_TOKEN)');

  lan.forEach((ip) => console.log(`  Điều khiển từ điện thoại:     http://${ip}:${PORT}/control.html`));
  console.log('\n  Nhấn Ctrl+C để dừng.\n');
});
