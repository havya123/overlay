/**
 * Guitar Island — overlay logic.
 *
 * URL params:
 *   ?pos=top|bottom|center   island position (default top)
 *   ?scale=1.25              scale the whole island
 *   ?preview                 preview mode (used inside control panel; never opens mic)
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const PREVIEW = params.has('preview');

  const root = document.documentElement;
  const stage = $('stage');
  const island = $('island');
  const core = $('core');
  const vinyl = $('vinyl');
  const label = $('label');
  const wave = $('wave');
  const info = $('info');
  const titleWrap = $('titleWrap');
  const titleEl = $('title');
  const titleClone = $('titleClone');
  const artistEl = $('artist');
  const timeEl = $('time');

  stage.dataset.pos = params.get('pos') || 'top';
  // Base size is a bit smaller than the original design; ?scale multiplies on top
  const BASE_SCALE = 0.86;
  const scale = parseFloat(params.get('scale'));
  root.style.setProperty('--scale', BASE_SCALE * (scale > 0 ? scale : 1));

  /* ---------------- Bars ---------------- */
  const N = 32;
  const bars = [];
  for (let i = 0; i < N; i++) {
    const b = document.createElement('div');
    b.className = 'bar';
    wave.appendChild(b);
    bars.push(b);
  }

  function colorBars(palette) {
    const mix = (a, b, t) => Math.round(a + (b - a) * t);
    bars.forEach((b, i) => {
      // symmetric gradient: a1 at the edges → a2 in the center
      const t = 1 - Math.abs(i - (N - 1) / 2) / ((N - 1) / 2);
      const c = palette.a1.map((v, k) => mix(v, palette.a2[k], t));
      b.style.background = `rgb(${c})`;
      b.style.boxShadow = `0 0 6px rgba(${c}, 0.45)`;
    });
  }

  /* ---------------- State handling ---------------- */
  let current = null;
  let playing = false;   // drives vinyl + bars (slightly delayed vs. state)
  let expandTimer = null;
  let playTimer = null;

  function setExpanded(v) { island.dataset.expanded = String(v); }
  function setPlaying(v) { playing = v; island.dataset.playing = String(v); }

  function bump() {
    if (!core.animate) return;
    core.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.045, 1.08)' },
        { transform: 'scale(0.985)' },
        { transform: 'scale(1)' },
      ],
      { duration: 650, easing: 'cubic-bezier(.22,1,.36,1)' }
    );
  }

  const INFO_WIDTH = 168; // keep in sync with .info width in CSS

  function setText(s, animate) {
    titleEl.textContent = s.title || '';
    titleClone.textContent = s.title || '';
    artistEl.textContent = s.artist || '';

    // Marquee if title is too long
    titleWrap.classList.remove('marquee');
    requestAnimationFrame(() => {
      const w = titleEl.offsetWidth;
      if (w > INFO_WIDTH) {
        titleWrap.style.setProperty('--marquee-dur', `${Math.max(7, (w + 40) / 28)}s`);
        titleWrap.classList.add('marquee');
      }
    });

    if (animate) {
      info.classList.remove('swap');
      void info.offsetWidth; // restart animation
      info.classList.add('swap');
      if (island.dataset.expanded === 'true') bump();
    }
  }

  /* ---------------- Cover art ---------------- */
  const vinylWrap = $('vinylWrap');
  const art = $('art');
  const backdrop = $('backdrop');
  let coverPalette = null;   // accent colors from the cover (or null)
  let coverMesh = null;      // backdrop colors from the cover (or null)
  let hasCover = false;
  let coverToken = 0;

  function preload(url, cors) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (cors) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  function clearCover() {
    vinylWrap.classList.remove('has-cover');
    hasCover = false;
    coverPalette = null;
    coverMesh = null;
    updatePalette();
  }

  async function setCover(url, animate) {
    const token = ++coverToken;
    if (!url) return clearCover();

    // Preload first so the swap never flashes an empty disc
    let img;
    try {
      try { img = await preload(url, true); }
      catch { img = await preload(url); }
    }
    catch {
      console.warn('[Guitar Island] Không tải được ảnh bìa:', url);
      if (token === coverToken) clearCover();
      return;
    }
    if (token !== coverToken) return;

    Island.setCoverBackground(art, url, img);
    vinylWrap.classList.add('has-cover');
    hasCover = true;

    if (animate && art.animate) {
      art.animate(
        [
          { opacity: 0, transform: 'scale(0.55) rotate(-120deg)', filter: 'blur(4px)' },
          { opacity: 1, transform: 'none', filter: 'blur(0)' },
        ],
        { duration: 800, easing: 'cubic-bezier(.22,1,.36,1)' }
      );
    }

    // Colors from the artwork (needs a readable image; falls back to theme)
    let colors = null;
    try { colors = await extractColors(url); } catch { colors = null; }
    if (token !== coverToken) return;
    coverPalette = colors && colors.accent;
    coverMesh = colors && colors.mesh;
    updatePalette();
  }

  /* ---- Color extraction ---- */
  function rgbToHsl([r, g, b]) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }

  function hslToRgb([h, s, l]) {
    const f = (n) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  }

  // Make a color glow-friendly: saturated and mid-bright
  function vivid(rgb01, hueShift = 0) {
    let [h, s, l] = rgbToHsl(rgb01);
    h = (h + hueShift / 360 + 1) % 1;
    s = Math.max(s, 0.72);
    l = Math.min(0.68, Math.max(0.56, l));
    return hslToRgb([h, s, l]);
  }

  // Backdrop tone: keep the hue, tame saturation, map into a consistent dark range
  function meshTone(rgb01, lo = 0.13, span = 0.17) {
    let [h, s, l] = rgbToHsl(rgb01);
    s = s < 0.08 ? s : Math.min(0.6, s * 1.05);
    l = lo + l * span;
    return `rgb(${hslToRgb([h, s, l])})`;
  }

  async function extractColors(url) {
    const img = await preload(url, true);
    const S = 40;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const crop = Island.coverCrop(img);
    ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, S, S);
    const d = ctx.getImageData(0, 0, S, S).data; // throws if canvas is tainted

    // --- Accent: dominant vivid hues ---
    const BINS = 24;
    const bins = Array.from({ length: BINS }, (_, i) => ({ i, w: 0, r: 0, g: 0, b: 0 }));
    let total = 0;

    // --- Mesh: one saturation-weighted color per region ---
    // c1 = left third, c2 = top-middle, c3 = bottom-middle, c4 = right third, base = whole
    const regions = Array.from({ length: 5 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    const add = (reg, r, g, b, w) => { reg.w += w; reg.r += r * w; reg.g += g * w; reg.b += b * w; };

    for (let p = 0, px = 0; p < d.length; p += 4, px++) {
      const x = px % S, y = Math.floor(px / S);
      const r = d[p] / 255, g = d[p + 1] / 255, b = d[p + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max ? (max - min) / max : 0;

      // Vivid pixels dominate, but grey regions still produce a (grey) color
      const wm = 0.05 + sat * sat * max;
      const ri = x < S / 3 ? 0 : x >= (2 * S) / 3 ? 3 : y < S / 2 ? 1 : 2;
      add(regions[ri], r, g, b, wm);
      add(regions[4], r, g, b, 1);

      if (max < 0.18 || sat < 0.2) continue; // skip near-black / greys for accents
      const dl = max - min;
      let h = max === r ? ((g - b) / dl) % 6 : max === g ? (b - r) / dl + 2 : (r - g) / dl + 4;
      h = (h * 60 + 360) % 360;
      const w = sat * sat * max;
      add(bins[Math.floor((h / 360) * BINS) % BINS], r, g, b, w);
      total += w;
    }

    const avg = (b) => [b.r / b.w, b.g / b.w, b.b / b.w];

    const mesh = {
      c1: meshTone(avg(regions[0])),
      c2: meshTone(avg(regions[1]), 0.16),
      c3: meshTone(avg(regions[2]), 0.11),
      c4: meshTone(avg(regions[3])),
      base: meshTone(avg(regions[4]), 0.04, 0.05),
    };

    let accent = null;
    if (total >= S * S * 0.01) {
      const ranked = bins.filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
      const dist = (a, b) => { const x = Math.abs(a - b); return Math.min(x, BINS - x); };
      const first = ranked[0];
      const second = ranked.find((b) => dist(b.i, first.i) >= 3 && b.w > first.w * 0.08);
      accent = {
        a1: vivid(avg(first)),
        a2: second ? vivid(avg(second)) : vivid(avg(first), 38),
      };
    }

    return { accent, mesh };
  }

  // Used when the cover can't be read (e.g. external image without CORS)
  function meshFromPalette(p) {
    const n = (rgb) => rgb.map((v) => v / 255);
    return {
      c1: meshTone(n(p.a1), 0.1, 0.15),
      c2: meshTone(n(p.a2), 0.1, 0.14),
      c3: meshTone(n(p.a1), 0.08, 0.12),
      c4: meshTone(n(p.a2), 0.09, 0.14),
      base: 'rgb(8, 8, 12)',
    };
  }

  function applyMesh(mesh) {
    if (!mesh) return backdrop.classList.remove('on');
    for (const k of ['c1', 'c2', 'c3', 'c4', 'base']) backdrop.style.setProperty(`--${k}`, mesh[k]);
    backdrop.classList.add('on');
  }

  function updatePalette() {
    if (!current) return;
    const useCover = current.autoColor !== false && coverPalette;
    const p = useCover ? coverPalette : Island.PALETTES[current.theme] || Island.PALETTES.aurora;
    Island.applyPalette(root, p);
    colorBars(p);
    // No cover → pure black island (like the real Dynamic Island)
    applyMesh(hasCover ? coverMesh || meshFromPalette(p) : null);
  }

  /* ---------------- Up next ---------------- */
  const nextEl = $('next');
  const nextThumb = $('nextThumb');
  const nextTitle = $('nextTitle');
  const nextArtist = $('nextArtist');
  let nextKey = '';

  function updateNext(s) {
    const n = s.showNext !== false ? Island.displayNextSong(s) : null;
    const key = n ? `${n.title}|${n.artist || ''}|${n.cover || ''}` : '';
    if (n && key !== nextKey) {
      const wasShown = nextKey && nextEl.dataset.show === 'true';
      nextTitle.textContent = n.title;
      nextArtist.textContent = n.artist || '';
      Island.setCoverBackground(nextThumb, n.cover);
      if (wasShown) {
        nextEl.classList.remove('swap');
        void nextEl.offsetWidth; // restart animation
        nextEl.classList.add('swap');
      }
    }
    nextKey = key; // when hidden, the old text stays so it can fade out
    nextEl.dataset.show = String(!!n && s.visible !== false);
    island.dataset.next = String(!!n); // taller island with a "Next" footer row
  }

  function apply(s) {
    const first = !current;
    const prev = current || {};
    current = s;

    if (first || s.sync?.source !== prev.sync?.source || s.theme !== prev.theme || s.autoColor !== prev.autoColor) updatePalette();
    if (first || s.title !== prev.title || s.artist !== prev.artist) setText(s, !first);
    if (first || s.cover !== prev.cover) setCover(s.cover, !first);
    updateNext(s);

    // Visibility (small delay on first load for a nice entrance)
    if (first) setTimeout(() => (island.dataset.visible = String(s.visible !== false)), 120);
    else island.dataset.visible = String(s.visible !== false);

    // Play / pause choreography
    if (s.playing !== prev.playing || first) {
      clearTimeout(expandTimer);
      clearTimeout(playTimer);
      if (s.playing) {
        // 1) island expands  2) tonearm drops + vinyl spins up
        setExpanded(true);
        playTimer = setTimeout(() => setPlaying(true), first ? 400 : 280);
      } else {
        // 1) tonearm lifts + vinyl spins down  2) island collapses
        setPlaying(false);
        expandTimer = setTimeout(() => setExpanded(false), first ? 0 : 1400);
      }
    }

    // Audio source
    if (s.mode === 'mic' && !PREVIEW) startMic();
    else stopMic();
  }

  /* ---------------- Microphone (optional) ---------------- */
  let audioCtx = null;
  let analyser = null;
  let micStream = null;
  let freqData = null;
  let timeData = null;
  let micStarting = false;

  async function startMic() {
    if (analyser || micStarting) return;
    micStarting = true;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;
      src.connect(analyser);
      freqData = new Uint8Array(analyser.frequencyBinCount);
      timeData = new Uint8Array(analyser.fftSize);
    } catch (err) {
      console.warn('[Guitar Island] Không mở được micro, dùng soundwave giả lập.', err);
      stopMic();
    } finally {
      micStarting = false;
    }
  }

  function stopMic() {
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    if (audioCtx) audioCtx.close().catch(() => {});
    micStream = audioCtx = analyser = null;
  }

  // Log-spaced frequency bands, mirrored from the center (bass in the middle)
  const HALF = N / 2;
  const bands = [];
  (function buildBands() {
    const fMin = 70, fMax = 7000;
    for (let i = 0; i <= HALF; i++) bands.push(fMin * Math.pow(fMax / fMin, i / HALF));
  })();

  function fillFromMic(targets) {
    analyser.getByteFrequencyData(freqData);
    const binHz = audioCtx.sampleRate / analyser.fftSize;
    for (let i = 0; i < HALF; i++) {
      const a = Math.max(1, Math.floor(bands[i] / binHz));
      const b = Math.max(a + 1, Math.floor(bands[i + 1] / binHz));
      let sum = 0;
      for (let k = a; k < b; k++) sum += freqData[k];
      let v = sum / (b - a) / 255;
      v = Math.min(1, Math.pow(v, 1.6) * (1.4 + i * 0.06)); // tilt: lift highs a bit
      targets[HALF - 1 - i] = v;
      targets[HALF + i] = v;
    }
  }

  /* ---------------- Simulated guitar-ish soundwave ---------------- */
  const phase = Array.from({ length: N }, () => Math.random() * Math.PI * 2);
  const speed = Array.from({ length: N }, () => 2 + Math.random() * 4);
  let strum = 0;
  let nextStrum = 0;
  let simT = 0;

  function fillSim(targets, dt) {
    simT += dt;
    // Strums: random impulses that decay like a plucked string
    nextStrum -= dt;
    if (nextStrum <= 0) {
      strum = Math.min(1.2, strum + 0.55 + Math.random() * 0.5);
      nextStrum = 0.32 + Math.random() * 0.9;
    }
    strum *= Math.exp(-dt * 2.4);

    const c = (N - 1) / 2;
    for (let i = 0; i < N; i++) {
      const d = (i - c) / (N * 0.34);
      const env = 0.3 + 0.7 * Math.exp(-d * d);
      const n =
        0.5 + 0.5 * Math.sin(simT * speed[i] + phase[i]) * Math.sin(simT * speed[i] * 0.37 + phase[i] * 1.7);
      const v = env * (0.18 + 0.32 * n + 0.62 * strum * (0.55 + 0.45 * n));
      targets[i] = Math.min(1, v);
    }
  }

  /* ---------------- Render loop ---------------- */
  const values = new Float32Array(N);
  const targets = new Float32Array(N);

  const MAX_RPM_DEG = 200; // deg/s at full speed
  let angle = 0;
  let vel = 0;
  let glow = 0;
  let ring = 0;
  let level = 0;
  let last = performance.now();
  let timeAcc = 0;

  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;

    // Vinyl: spin up quickly, coast down slowly like a real turntable
    const targetVel = playing ? MAX_RPM_DEG : 0;
    const k = playing ? 2.6 : 1.15;
    vel += (targetVel - vel) * (1 - Math.exp(-k * dt));
    if (!playing && vel < 0.4) vel = 0;
    angle = (angle + vel * dt) % 360;
    vinyl.style.transform = `rotate(${angle.toFixed(2)}deg)`;

    // Bars
    if (!playing) targets.fill(0);
    else if (analyser) fillFromMic(targets);
    else fillSim(targets, dt);

    const H = wave.clientHeight || 14;
    const MIN = 3;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const tg = targets[i];
      const v = values[i];
      const rate = tg > v ? 22 : 6; // fast attack, soft release
      values[i] = v + (tg - v) * (1 - Math.exp(-rate * dt));
      sum += values[i];
      bars[i].style.height = `${(MIN + values[i] * (H - MIN)).toFixed(1)}px`;
    }
    level += (sum / N - level) * (1 - Math.exp(-8 * dt));

    // Glow + rim intensity
    const on = playing ? 1 : 0;
    ring += (on * 0.85 - ring) * (1 - Math.exp(-3 * dt));
    glow += (on * (0.18 + level * 0.75) - glow) * (1 - Math.exp(-6 * dt));
    root.style.setProperty('--ring', ring.toFixed(3));
    root.style.setProperty('--glow', glow.toFixed(3));

    // Timer text (4x per second is plenty)
    timeAcc += dt;
    if (timeAcc > 0.25 && current) {
      timeAcc = 0;
      const media = current.sync && current.sync.source === 'youtube' ? current.media : null;
      const position = media ? Island.mediaPosition(current) : null;
      const duration = media ? Island.formatDuration(media.durationSec) : '';
      timeEl.textContent = position === null ? Island.formatTime(Island.elapsed(current)) : `${Island.formatTime(position * 1000)}${duration ? ` / ${duration}` : ''}`;
    }

    requestAnimationFrame(frame);
  }

  /* ---------------- Boot ---------------- */
  Island.subscribe(apply);
  requestAnimationFrame(frame);

  // Keyboard fallback (OBS "Interact" window or a normal browser tab)
  if (!PREVIEW) {
    addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); Island.actions.toggle(); }
    });
  }
})();
