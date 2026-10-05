/**
 * Guitar Island — shared state + sync layer.
 *
 * Two transport modes:
 *  - Server mode (page served over http by server.js): state lives on the server,
 *    updates arrive via Server-Sent Events. Works across OBS docks, browser
 *    sources and even your phone on the same Wi-Fi.
 *  - Local mode (page opened as file://): falls back to BroadcastChannel +
 *    localStorage. Handy for quick testing in a single browser.
 */
(function (global) {
  'use strict';

  const KEY = 'guitar-island:state';
  const CHANNEL = 'guitar-island';
  const SERVER = location.protocol.startsWith('http');
  const TOKEN = new URLSearchParams(location.search).get('token') || '';
  const authHeaders = () => TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

  const PALETTES = {
    aurora: { name: 'Aurora', a1: [124, 92, 255], a2: [0, 224, 255] },
    sunset: { name: 'Sunset', a1: [255, 94, 58], a2: [255, 190, 92] },
    mint:   { name: 'Mint',   a1: [0, 230, 150], a2: [0, 190, 255] },
    rose:   { name: 'Rose',   a1: [255, 64, 129], a2: [255, 170, 140] },
    amber:  { name: 'Amber',  a1: [235, 140, 40], a2: [255, 226, 140] },
    mono:   { name: 'Mono',   a1: [170, 170, 185], a2: [255, 255, 255] },
  };

  const DEFAULT_STATE = {
    playing: false,
    visible: true,
    title: 'Acoustic Session',
    artist: 'Live Guitar',
    cover: '',
    theme: 'aurora',
    autoColor: true,      // derive accent colors from the cover art
    mode: 'sim',          // 'sim' | 'mic'
    startedAt: 0,         // timestamp when current play run started
    elapsedBefore: 0,     // ms accumulated before current run
    setlist: [],
    showNext: true,       // show the "Up next" bubble under the island
    nextOverrideId: '',   // user-selected Next, independent from the current media source
    syncEnabled: true,
    sync: { source: 'manual', ownerId: '', tabId: 0, leaseUntil: 0, revision: 0 },
    media: null,          // YouTube snapshot: seconds, observedAt is server time
  };

  let state = { ...DEFAULT_STATE };
  let lastRaw = '';
  let clockOffset = 0;    // serverTime - Date.now()
  const listeners = new Set();
  let channel = null;
  let started = false;

  const now = () => Date.now() + clockOffset;

  function emit(next) {
    const raw = JSON.stringify(next);
    if (raw === lastRaw) return;
    lastRaw = raw;
    state = { ...DEFAULT_STATE, ...next };
    listeners.forEach((cb) => cb(state));
  }

  function resolveTokens(patch) {
    const out = { ...patch };
    if (out.startedAt === 'now') out.startedAt = now();
    return out;
  }

  /* ---------------- Local transport ---------------- */
  function readLocal() {
    try { return { ...DEFAULT_STATE, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
    catch { return { ...DEFAULT_STATE }; }
  }

  function startLocal() {
    try { channel = new BroadcastChannel(CHANNEL); } catch { channel = null; }
    if (channel) channel.onmessage = (e) => { try { emit(JSON.parse(e.data)); } catch {} };
    addEventListener('storage', (e) => { if (e.key === KEY) emit(readLocal()); });
    setInterval(() => emit(readLocal()), 600); // safety net
    emit(readLocal());
  }

  function writeLocal(patch) {
    const next = { ...state, ...resolveTokens(patch) };
    const raw = JSON.stringify(next);
    try { localStorage.setItem(KEY, raw); } catch {}
    if (channel) channel.postMessage(raw);
    emit(next);
  }

  /* ---------------- Server transport ---------------- */
  function handleServer(data) {
    if (typeof data.serverTime === 'number') clockOffset = data.serverTime - Date.now();
    const { serverTime, ...rest } = data;
    emit({ ...DEFAULT_STATE, ...rest });
  }

  function startServer() {
    const es = new EventSource('/api/events' + (TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : ''));
    es.onmessage = (e) => { try { handleServer(JSON.parse(e.data)); } catch {} };
    es.onopen = () => setConnection(true);
    es.onerror = () => setConnection(false);
  }

  function writeServer(patch) {
    // Optimistic local update so UI feels instant.
    emit({ ...state, ...resolveTokens(patch) });
    fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(patch), // server resolves 'now' with its own clock
    }).catch(() => setConnection(false));
  }

  /* ---------------- Connection status ---------------- */
  let connected = !SERVER;
  const connListeners = new Set();
  function setConnection(v) {
    if (connected === v) return;
    connected = v;
    connListeners.forEach((cb) => cb(v));
  }

  /* ---------------- Public API ---------------- */
  function start() {
    if (started) return;
    started = true;
    SERVER ? startServer() : startLocal();
  }

  function subscribe(cb) {
    start();
    listeners.add(cb);
    if (lastRaw) cb(state);
    return () => listeners.delete(cb);
  }

  function write(patch) {
    start();
    SERVER ? writeServer(patch) : writeLocal(patch);
  }

  function elapsed(s = state) {
    return Math.max(0, (s.elapsedBefore || 0) + (s.playing && s.startedAt ? now() - s.startedAt : 0));
  }

  // Position of a source media player, interpolated between extension snapshots.
  function mediaPosition(s = state) {
    const m = s.media;
    if (!m || !Number.isFinite(m.positionSec)) return null;
    let position = m.positionSec;
    if (s.sync && s.sync.source === 'youtube' && s.playing && Number.isFinite(m.observedAt)) {
      position += Math.max(0, now() - m.observedAt) / 1000 * (Number.isFinite(m.playbackRate) ? m.playbackRate : 1);
    }
    if (Number.isFinite(m.durationSec) && m.durationSec >= 0) position = Math.min(position, m.durationSec);
    return Math.max(0, position);
  }

  function formatDuration(seconds) {
    return Number.isFinite(seconds) ? formatTime(Math.max(0, seconds * 1000)) : '';
  }

  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }

  function applyPalette(el, p) {
    el.style.setProperty('--a1', `rgb(${p.a1})`);
    el.style.setProperty('--a2', `rgb(${p.a2})`);
    el.style.setProperty('--a1-rgb', p.a1.join(','));
    el.style.setProperty('--a2-rgb', p.a2.join(','));
    return p;
  }

  function applyTheme(el, theme) {
    return applyPalette(el, PALETTES[theme] || PALETTES.aurora);
  }

  // Normalize metadata for setlist matching without treating distinct duplicate titles as equal.
  const key = (v) => String(v || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/\s*[\[\(](official (music )?video|official audio|lyrics?|live|hd|4k)[^\]\)]*[\]\)]/gi, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  const mediaVideoId = (s) => s.sync?.source === 'youtube' ? s.media?.videoId : '';

  // Index of the song currently on the overlay inside the setlist (-1 if not there)
  function currentIndex(s = state) {
    const list = s.setlist || [];
    const videoId = mediaVideoId(s);
    if (videoId) {
      const byVideo = list.findIndex((x) => x.youtubeVideoId === videoId);
      if (byVideo >= 0) return byVideo;
    }
    const title = key(s.title);
    const artist = key(s.artist);
    const exact = list.findIndex((x) => key(x.title) === title && key(x.artist) === artist);
    if (exact >= 0) return exact;
    const byTitle = list.map((x, i) => key(x.title) === title ? i : -1).filter((i) => i >= 0);
    return byTitle.length === 1 ? byTitle[0] : -1;
  }

  // Song after the current one; if the current song isn't in the setlist, the first one
  function nextSong(s = state) {
    const list = s.setlist || [];
    if (!list.length) return null;
    const i = currentIndex(s);
    return i < 0 ? list[0] : list[i + 1] || null;
  }

  // Explicit selection wins over the automatic successor; stale IDs safely fall back.
  function displayNextSong(s = state) {
    const override = s.nextOverrideId && (s.setlist || []).find((x) => x.id === s.nextOverrideId);
    return override || nextSong(s);
  }

  /* YouTube thumbnails can contain black letterboxing inside the image itself.
     Find symmetric dark margins before fitting the artwork to a round record. */
  function coverCrop(img) {
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const full = { x: 0, y: 0, width, height };
    if (!width || !height || width <= height) return full;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = Math.round(160 * height / width);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      // Ignore thin frames along the sides and isolated horizontal divider lines.
      const left = 6, right = canvas.width - 6;
      const bright = (row) => {
        let count = 0;
        for (let x = left; x < right; x++) {
          const p = (row * canvas.width + x) * 4;
          if (Math.max(pixels[p], pixels[p + 1], pixels[p + 2]) > 24) count++;
        }
        return count > (right - left) * 0.08;
      };
      const margin = (bottom) => {
        for (let i = 0; i < canvas.height / 4; i++) {
          const y = bottom ? canvas.height - 1 - i : i;
          if (bright(y) && bright(y + (bottom ? -1 : 1))) return i;
        }
        return 0;
      };
      const top = margin(false), bottom = margin(true);
      if (Math.min(top, bottom) < canvas.height * 0.03 || Math.abs(top - bottom) > 2) return full;
      const inset = Math.max(top, bottom) * height / canvas.height;
      return { x: 0, y: inset, width, height: height - inset * 2 };
    } catch {
      // Cross-origin images without CORS remain usable as ordinary backgrounds.
      return full;
    }
  }

  const coverSizes = new Map();
  const coverRequests = new WeakMap();
  function coverSize(img) {
    const crop = coverCrop(img);
    const height = img.naturalHeight || img.height;
    return crop.y ? `auto ${height / crop.height * 100}%` : 'cover';
  }

  function setCoverBackground(el, url, img) {
    coverRequests.set(el, url);
    el.style.backgroundImage = url ? `url("${String(url).replace(/"/g, '%22')}")` : '';
    el.style.backgroundSize = 'cover';
    if (!url) return;
    if (img) coverSizes.set(url, Promise.resolve(coverSize(img)));
    if (!coverSizes.has(url)) {
      coverSizes.set(url, new Promise((resolve) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(coverSize(image));
        image.onerror = () => resolve('cover');
        image.src = url;
      }));
    }
    coverSizes.get(url).then((size) => {
      if (coverRequests.get(el) === url) el.style.backgroundSize = size;
    });
    if (coverSizes.size > 100) coverSizes.delete(coverSizes.keys().next().value);
  }

  /* Common actions */
  const actions = {
    play() { write({ playing: true, startedAt: 'now' }); },
    pause() { write({ playing: false, elapsedBefore: elapsed(), startedAt: 0 }); },
    toggle() { state.playing ? actions.pause() : actions.play(); },
    resetTimer() { write({ elapsedBefore: 0, startedAt: state.playing ? 'now' : 0 }); },
  };

  global.Island = {
    SERVER, PALETTES, DEFAULT_STATE,
    subscribe, write, actions,
    get state() { return state; },
    get connected() { return connected; },
    onConnection(cb) { connListeners.add(cb); cb(connected); },
    now, elapsed, mediaPosition, formatTime, formatDuration, applyTheme, applyPalette, currentIndex, nextSong, displayNextSong,
    coverCrop, setCoverBackground,
  };
})(window);
