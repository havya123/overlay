/**
 * Guitar Island — control panel logic.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;

  const playBtn = $('playBtn');
  const stateText = $('stateText');
  const sourceText = $('sourceText');
  const timeText = $('timeText');
  const resetBtn = $('resetBtn');
  const visibleBtn = $('visibleBtn');
  const songForm = $('songForm');
  const titleInput = $('titleInput');
  const artistInput = $('artistInput');
  const coverInput = $('coverInput');
  const saveBtn = $('saveBtn');
  const linkYouTubeBtn = $('linkYouTubeBtn');
  const setlistEl = $('setlist');
  const setlistEmpty = $('setlistEmpty');
  const setlistSearch = $('setlistSearch');
  const clearSetlistSearchBtn = $('clearSetlistSearch');
  const setlistCount = $('setlistCount');
  const setlistPages = $('setlistPages');
  const setlistPrev = $('setlistPrev');
  const setlistNext = $('setlistNext');
  const setlistPageText = $('setlistPageText');
  const setlistHint = $('setlistHint');
  const swatchesEl = $('swatches');
  const modeSeg = $('modeSeg');
  const statusEl = $('status');
  const statusText = $('statusText');
  const toastEl = $('toast');
  const applyBtn = $('applyBtn');
  const coverThumb = $('coverThumb');
  const coverDrop = $('coverDrop');
  const fileInput = $('fileInput');
  const searchCoverBtn = $('searchCoverBtn');
  const uploadBtn = $('uploadBtn');
  const clearCoverBtn = $('clearCoverBtn');
  const coverResults = $('coverResults');
  const autoColorEl = $('autoColor');
  const nextBtn = $('nextBtn');
  const showNextEl = $('showNext');
  const syncEnabledEl = $('syncEnabled');

  const cssUrl = (u) => `url("${String(u).replace(/"/g, '%22')}")`;

  /* ---------------- Toast ---------------- */
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  /* ---------------- Swatches ---------------- */
  Object.entries(Island.PALETTES).forEach(([key, p]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.theme = key;
    b.id = `theme-${key}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', p.name);
    b.title = p.name;
    b.style.background = `linear-gradient(135deg, rgb(${p.a1}), rgb(${p.a2}))`;
    b.addEventListener('click', () => Island.write({ theme: key }));
    swatchesEl.appendChild(b);
  });

  /* ---------------- Mode ---------------- */
  modeSeg.querySelectorAll('button').forEach((b) => {
    b.id = `mode-${b.dataset.mode}`;
    b.addEventListener('click', () => Island.write({ mode: b.dataset.mode }));
  });

  /* ---------------- Transport ---------------- */
  playBtn.addEventListener('click', () => Island.actions.toggle());
  resetBtn.addEventListener('click', () => { Island.actions.resetTimer(); toast('Đã đặt lại thời gian'); });
  visibleBtn.addEventListener('click', () => {
    const v = Island.state.visible === false;
    Island.write({ visible: v });
    toast(v ? 'Đã hiện island' : 'Đã ẩn island');
  });

  addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea';
    if (e.code === 'Space' && !typing && tag !== 'button') {
      e.preventDefault();
      if (Island.state.sync?.source !== 'youtube') Island.actions.toggle();
    } else if (e.code === 'KeyN' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      playNext();
    }
  });

  nextBtn.addEventListener('click', () => playNext());

  function playNext() {
    if (Island.state.sync?.source === 'youtube') {
      toast('YouTube đang điều khiển bài hiện tại — bấm một bài setlist để chọn Next');
      return;
    }
    const n = Island.displayNextSong(Island.state);
    if (!n) { toast((Island.state.setlist || []).length ? 'Đã hết setlist' : 'Setlist đang trống'); return; }
    pickSong(n);
  }

  // Load a setlist song onto the overlay and into the form
  function pickSong(song) {
    loadSong(song, true);
    titleInput.value = song.title;
    artistInput.value = song.artist || '';
    setCoverValue(song.cover || '');
    autoValues.artist = song.artist || '';
    autoValues.cover = song.cover || '';
    toast(`▶ ${song.title}`);
  }

  /* ---------------- Song form ---------------- */
  const readForm = () => ({
    title: titleInput.value.trim() || 'Untitled',
    artist: artistInput.value.trim(),
    cover: coverInput.value.trim(),
  });

  function loadSong(song, resetTimer = true) {
    const patch = { title: song.title, artist: song.artist || '', cover: song.cover || '' };
    if (resetTimer) {
      patch.elapsedBefore = 0;
      patch.startedAt = Island.state.playing ? 'now' : 0;
    }
    Island.write(patch);
  }

  songForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = readForm();
    if (s.cover) {
      s.cover = await localize(s.cover);
      setCoverValue(s.cover);
    }
    const changed = s.title !== Island.state.title;
    loadSong(s, changed);
    toast('Đã cập nhật overlay');
    document.activeElement && document.activeElement.blur();
  });

  saveBtn.addEventListener('click', async () => {
    const s = readForm();
    if (!titleInput.value.trim()) { titleInput.focus(); toast('Nhập tên bài trước nhé'); return; }
    const list = [...(Island.state.setlist || [])];
    if (list.some((x) => x.title === s.title && x.artist === s.artist)) { toast('Bài này đã có trong setlist'); return; }
    if (s.cover) { s.cover = await localize(s.cover); setCoverValue(s.cover); }
    list.push({ id: Date.now().toString(36), ...s });
    Island.write({ setlist: list });
    toast('Đã lưu vào setlist');
  });

  linkYouTubeBtn.addEventListener('click', () => {
    const videoId = Island.state.media?.videoId;
    if (!videoId) return;
    const title = Island.state.title;
    const artist = Island.state.artist;
    const list = [...(Island.state.setlist || [])];
    const index = list.findIndex((x) => x.title === title && x.artist === artist);
    if (index < 0) { toast('Hãy lưu bài này vào setlist trước'); return; }
    list[index] = { ...list[index], youtubeVideoId: videoId };
    Island.write({ setlist: list });
    toast('Đã gắn video YouTube cho bài này');
  });

  /* ---------------- Cover picker ---------------- */
  function setThumb(url) {
    Island.setCoverBackground(coverThumb, url);
    coverThumb.classList.toggle('has-img', !!url);
  }

  function updateDirty() {
    const s = Island.state;
    const dirty =
      titleInput.value.trim() !== (s.title || '') ||
      artistInput.value.trim() !== (s.artist || '') ||
      coverInput.value.trim() !== (s.cover || '');
    applyBtn.classList.toggle('dirty', dirty);
    applyBtn.textContent = dirty ? 'Cập nhật lên overlay' : 'Cập nhật';
  }

  function setCoverValue(url) {
    coverInput.value = url;
    setThumb(url);
    updateDirty();
  }

  [titleInput, artistInput, coverInput].forEach((el) => el.addEventListener('input', updateDirty));
  coverInput.addEventListener('input', () => setThumb(coverInput.value.trim()));

  const busy = (el, v) => el.classList.toggle('busy', v);

  /* Copy external images into covers/ so the overlay works offline and can read colors */
  async function localize(url) {
    if (!Island.SERVER || !/^https?:\/\//i.test(url) || url.startsWith(location.origin)) return url;
    try {
      const res = await fetch('/api/cover-fetch?url=' + encodeURIComponent(url));
      const data = await res.json();
      return res.ok && data.url ? data.url : url;
    } catch {
      return url;
    }
  }

  async function drawScaled(file, max) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c;
  }

  async function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) { toast('File này không phải ảnh'); return; }
    busy(uploadBtn, true);
    coverThumb.classList.add('loading');
    try {
      // Local mode stores the image inside localStorage → keep it small
      const canvas = await drawScaled(file, Island.SERVER ? 800 : 400);
      let url;
      if (Island.SERVER) {
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
        const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Tải ảnh thất bại');
        url = data.url;
      } else {
        url = canvas.toDataURL('image/jpeg', 0.85);
      }
      setCoverValue(url);
      toast('Đã tải ảnh — bấm “Cập nhật” để lên overlay');
    } catch (err) {
      toast(err.message || 'Tải ảnh thất bại');
    } finally {
      busy(uploadBtn, false);
      coverThumb.classList.remove('loading');
    }
  }

  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { handleFile(fileInput.files[0]); fileInput.value = ''; });
  clearCoverBtn.addEventListener('click', () => { setCoverValue(''); coverResults.hidden = true; });

  // Drag & drop (files or image links dragged from a browser)
  ['dragenter', 'dragover'].forEach((ev) =>
    coverDrop.addEventListener(ev, (e) => { e.preventDefault(); coverDrop.classList.add('dragover'); })
  );
  coverDrop.addEventListener('dragleave', (e) => {
    if (!coverDrop.contains(e.relatedTarget)) coverDrop.classList.remove('dragover');
  });
  coverDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    coverDrop.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f) return handleFile(f);
    const link = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').trim();
    if (/^https?:\/\//i.test(link)) setCoverValue(link);
  });

  // Paste an image from the clipboard anywhere on the page
  addEventListener('paste', (e) => {
    const item = [...((e.clipboardData && e.clipboardData.items) || [])].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); handleFile(item.getAsFile()); }
  });

  // Auto search (iTunes via server)
  function resultsMessage(msg) {
    coverResults.hidden = false;
    coverResults.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'results-msg';
    p.textContent = msg;
    coverResults.appendChild(p);
  }

  function renderResults(list) {
    if (!list.length) return resultsMessage('Không tìm thấy. Thử sửa tên bài/nghệ sĩ hoặc tải ảnh lên.');
    coverResults.innerHTML = '';
    list.forEach((r, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'result';
      b.id = `cover-result-${i}`;
      b.style.backgroundImage = cssUrl(r.thumb);
      b.style.animationDelay = `${i * 0.03}s`;
      b.title = `${r.title} — ${r.artist}\n${r.album}`;
      const label = document.createElement('span');
      label.textContent = r.artist;
      b.appendChild(label);
      b.addEventListener('click', async () => {
        coverResults.hidden = true;
        setThumb(r.cover);
        coverThumb.classList.add('loading');
        const url = await localize(r.cover);
        coverThumb.classList.remove('loading');
        setCoverValue(url);
        if (!artistInput.value.trim()) { artistInput.value = r.artist; updateDirty(); }
        toast('Đã chọn ảnh bìa — bấm “Cập nhật”');
      });
      coverResults.appendChild(b);
    });
  }

  searchCoverBtn.addEventListener('click', async () => {
    // "Oasis · Fingerstyle" → search with "Oasis" only
    const artist = artistInput.value.trim().split(/\s+[-–|]\s+|[·•]/)[0].trim();
    const q = [titleInput.value.trim(), artist].filter(Boolean).join(' ');
    if (!q) { titleInput.focus(); toast('Nhập tên bài để tìm ảnh bìa'); return; }
    if (!Island.SERVER) { toast('Cần chạy server (node server.js) để tìm ảnh'); return; }
    busy(searchCoverBtn, true);
    resultsMessage(`Đang tìm “${q}”…`);
    try {
      const res = await fetch('/api/cover-search?q=' + encodeURIComponent(q));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      renderResults(data.results || []);
    } catch (err) {
      resultsMessage(err.message || 'Không tìm được ảnh bìa');
    } finally {
      busy(searchCoverBtn, false);
    }
  });

  /* ---------------- Title autocomplete ---------------- */
  const suggestList = $('suggestList');
  const suggestWrap = titleInput.closest('.suggest-wrap');
  const suggestCache = new Map();   // folded query -> results
  let suggestions = [];
  let activeIndex = -1;
  let suggestTimer = null;
  let suggestCtrl = null;
  let renderedFor = '';

  // Values that came from the shared state / an auto-fill. If a field still holds
  // one of these, it's safe to replace; anything the user typed is protected.
  const autoValues = { artist: null, cover: null };
  const replaceable = (input, key) => !input.value.trim() || input.value.trim() === (autoValues[key] || '').trim();

  // Accent-insensitive folding that keeps string length (for highlighting)
  const foldChar = (c) =>
    (c.normalize('NFD').replace(/[\u0300-\u036f]/g, '')[0] || c).replace(/[đĐ]/, 'd').toLowerCase()[0] || c;
  const fold = (s) => String(s || '').split('').map(foldChar).join('');
  const norm = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
  const fmtDur = (ms) => {
    if (!ms) return '';
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  function flash(el) {
    el.classList.remove('autofilled');
    void el.offsetWidth;
    el.classList.add('autofilled');
  }

  function openSuggest(open) {
    suggestList.hidden = !open;
    titleInput.setAttribute('aria-expanded', String(open));
    if (!open) {
      activeIndex = -1;
      titleInput.removeAttribute('aria-activedescendant');
    }
  }

  function highlight(text, q) {
    const frag = document.createDocumentFragment();
    const needle = fold(q.trim());
    const i = needle ? fold(text).indexOf(needle) : -1;
    if (i < 0) { frag.append(text); return frag; }
    const mark = document.createElement('mark');
    mark.textContent = text.slice(i, i + needle.length);
    frag.append(text.slice(0, i), mark, text.slice(i + needle.length));
    return frag;
  }

  function setActive(i) {
    activeIndex = i;
    suggestList.querySelectorAll('.suggest-item').forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    const li = $(`suggest-${i}`);
    if (li) {
      titleInput.setAttribute('aria-activedescendant', li.id);
      li.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderSuggestions(list, q) {
    suggestions = list;
    renderedFor = q;
    activeIndex = -1;
    suggestList.innerHTML = '';

    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'suggest-msg';
      li.setAttribute('role', 'presentation');
      li.textContent = 'Không tìm thấy bài nào — bạn vẫn có thể nhập tay.';
      suggestList.appendChild(li);
      return openSuggest(true);
    }

    list.forEach((s, i) => {
      const li = document.createElement('li');
      li.className = 'suggest-item';
      li.id = `suggest-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.style.animationDelay = `${i * 0.025}s`;

      const thumb = document.createElement('div');
      thumb.className = 'suggest-thumb';
      thumb.style.backgroundImage = cssUrl(s.thumb);

      const text = document.createElement('div');
      text.className = 'suggest-text';
      const title = document.createElement('div');
      title.className = 'suggest-title';
      title.appendChild(highlight(s.title, q));
      const sub = document.createElement('div');
      sub.className = 'suggest-sub';
      sub.textContent = [s.artist, s.album, s.year].filter(Boolean).join(' · ');
      text.append(title, sub);

      const dur = document.createElement('span');
      dur.className = 'suggest-dur';
      dur.textContent = fmtDur(s.duration);

      li.append(thumb, text, dur);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pickSuggestion(i); });
      li.addEventListener('mousemove', () => { if (activeIndex !== i) setActive(i); });
      suggestList.appendChild(li);
    });

    const foot = document.createElement('li');
    foot.className = 'suggest-foot';
    foot.setAttribute('role', 'presentation');
    foot.innerHTML =
      '<span>Nguồn: Apple Music</span><span><kbd>↑</kbd><kbd>↓</kbd> chọn · <kbd>Enter</kbd> điền · <kbd>Esc</kbd> đóng</span>';
    suggestList.appendChild(foot);
    openSuggest(true);
  }

  async function querySongs(q, signal) {
    const key = fold(q);
    if (suggestCache.has(key)) return suggestCache.get(key);
    const res = await fetch('/api/song-search?q=' + encodeURIComponent(q), { signal });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    suggestCache.set(key, data.results || []);
    return data.results || [];
  }

  async function fetchSuggestions(q) {
    if (suggestCtrl) suggestCtrl.abort();
    suggestCtrl = new AbortController();
    suggestWrap.classList.add('loading');
    try {
      const list = await querySongs(q, suggestCtrl.signal);
      // Ignore stale responses
      if (titleInput.value.trim() !== q || document.activeElement !== titleInput) return;
      renderSuggestions(list, q);
    } catch (err) {
      if (err.name !== 'AbortError') openSuggest(false);
    } finally {
      suggestWrap.classList.remove('loading');
    }
  }

  /**
   * Fill fields from a suggestion.
   * explicit = user picked it → overwrite everything.
   * otherwise (auto) → only touch fields the user hasn't edited by hand.
   */
  async function applySuggestion(s, explicit) {
    titleInput.value = s.title;
    if (explicit) flash(titleInput);

    if (explicit || replaceable(artistInput, 'artist')) {
      artistInput.value = s.artist;
      autoValues.artist = s.artist;
      flash(artistInput);
    }
    updateDirty();

    if (s.cover && (explicit || replaceable(coverInput, 'cover'))) {
      setThumb(s.cover);
      coverThumb.classList.add('loading');
      const url = await localize(s.cover);
      coverThumb.classList.remove('loading');
      if (norm(titleInput.value) !== norm(s.title)) return; // user moved on
      setCoverValue(url);
      autoValues.cover = url;
      flash(coverInput);
    }
  }

  function pickSuggestion(i) {
    const s = suggestions[i];
    if (!s) return;
    openSuggest(false);
    clearTimeout(suggestTimer);
    applySuggestion(s, true);
    toast(`Đã điền: ${s.title} — ${s.artist}`);
  }

  function exactMatch(list, q) {
    const n = norm(q);
    return n ? (list || []).find((x) => norm(x.title) === n) : null;
  }

  const needsFill = () => replaceable(artistInput, 'artist') || replaceable(coverInput, 'cover');

  /* Typed a title and moved on without picking → auto-fill on exact title match */
  async function autoFill() {
    const q = titleInput.value.trim();
    if (!Island.SERVER || q.length < 2 || q === Island.state.title || !needsFill()) return;
    let list;
    try { list = await querySongs(q); } catch { return; }
    if (titleInput.value.trim() !== q) return;
    const s = exactMatch(list, q);
    if (!s) return;
    const before = artistInput.value;
    await applySuggestion(s, false);
    if (artistInput.value !== before) toast(`Tự điền: ${s.artist}`);
  }

  titleInput.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const q = titleInput.value.trim();
    if (!Island.SERVER || q.length < 2) { openSuggest(false); return; }
    suggestTimer = setTimeout(() => fetchSuggestions(q), 300);
  });

  titleInput.addEventListener('focus', () => {
    if (suggestions.length && renderedFor === titleInput.value.trim()) openSuggest(true);
  });

  titleInput.addEventListener('blur', () => {
    setTimeout(() => openSuggest(false), 100);
    autoFill();
  });

  titleInput.addEventListener('keydown', (e) => {
    const open = !suggestList.hidden && suggestions.length > 0;
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      setActive((activeIndex + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      setActive((activeIndex - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Escape' && !suggestList.hidden) {
      e.preventDefault();
      openSuggest(false);
    } else if (e.key === 'Enter') {
      if (open && activeIndex >= 0) {
        e.preventDefault();
        pickSuggestion(activeIndex);
        return;
      }
      // Exact match not filled yet → fill first; next Enter submits
      const q = titleInput.value.trim();
      const s = q !== Island.state.title && needsFill() && exactMatch(suggestCache.get(fold(q)), q);
      openSuggest(false);
      if (s && (artistInput.value.trim() !== s.artist || !coverInput.value.trim())) {
        e.preventDefault();
        applySuggestion(s, false);
        toast(`Tự điền: ${s.artist} — Enter lần nữa để cập nhật`);
      }
    }
  });

  /* ---------------- Auto color ---------------- */
  autoColorEl.addEventListener('change', () => Island.write({ autoColor: autoColorEl.checked }));
  showNextEl.addEventListener('change', () => Island.write({ showNext: showNextEl.checked }));
  syncEnabledEl.addEventListener('change', () => {
    Island.write({ syncEnabled: syncEnabledEl.checked });
    toast(syncEnabledEl.checked ? 'Đã bật đồng bộ YouTube' : 'Đã tắt đồng bộ YouTube');
  });

  /* ---------------- Setlist ---------------- */
  const PAGE_SIZE = 10;
  let setlistQuery = '';
  let setlistPage = 0;
  const seenSongs = new Set(); // only rows that are new get the entrance animation

  const searchFold = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  const matchingSongs = (list) => {
    const query = searchFold(setlistQuery).trim();
    return query ? list.filter((song) => searchFold(`${song.title} ${song.artist || ''}`).includes(query)) : list;
  };

  setlistSearch.addEventListener('input', () => {
    setlistQuery = setlistSearch.value;
    setlistPage = 0;
    clearSetlistSearchBtn.hidden = !setlistQuery;
    setlistEl.dataset.sig = '';
    renderSetlist(Island.state);
  });
  clearSetlistSearchBtn.addEventListener('click', () => {
    setlistSearch.value = setlistQuery = '';
    setlistPage = 0;
    clearSetlistSearchBtn.hidden = true;
    setlistEl.dataset.sig = '';
    renderSetlist(Island.state);
    setlistSearch.focus();
  });
  setlistPrev.addEventListener('click', () => { setlistPage--; setlistEl.dataset.sig = ''; renderSetlist(Island.state); });
  setlistNext.addEventListener('click', () => { setlistPage++; setlistEl.dataset.sig = ''; renderSetlist(Island.state); });

  function renderSetlist(s) {
    const list = s.setlist || [];
    const matching = matchingSongs(list);
    const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
    setlistPage = Math.max(0, Math.min(setlistPage, pages - 1));
    const start = setlistPage * PAGE_SIZE;
    const visible = matching.slice(start, start + PAGE_SIZE);
    setlistEmpty.style.display = list.length && matching.length ? 'none' : '';
    setlistEmpty.textContent = list.length && !matching.length ? 'Không tìm thấy bài nào trong setlist.' : 'Chưa có bài nào. Nhập tên bài rồi bấm “Lưu vào setlist”.';
    setlistCount.textContent = list.length ? `${matching.length}/${list.length} bài` : '';
    setlistPages.hidden = matching.length <= PAGE_SIZE;
    setlistPageText.textContent = `Trang ${setlistPage + 1} / ${pages}`;
    setlistPrev.disabled = setlistPage === 0;
    setlistNext.disabled = setlistPage >= pages - 1;
    const sig = JSON.stringify(list) + '|' + s.title + '|' + s.artist + '|' + s.nextOverrideId + '|' + setlistQuery + '|' + setlistPage;
    if (setlistEl.dataset.sig === sig || drag) return;
    setlistEl.dataset.sig = sig;
    setlistEl.innerHTML = '';
    const cur = Island.currentIndex(s);
    const next = Island.displayNextSong(s);
    const filtered = !!setlistQuery.trim();
    let delay = 0;

    visible.forEach((song, i) => {
      const index = list.indexOf(song);
      const li = document.createElement('li');
      li.className = 'song' + (index === cur ? ' active' : '') + (next && song.id === next.id ? ' next' : '');
      li.id = `song-${song.id}`;
      li.tabIndex = 0;
      if (seenSongs.has(song.id)) li.style.animation = 'none';
      else li.style.animationDelay = `${delay++ * 0.03}s`;
      seenSongs.add(song.id);

      const grip = document.createElement('span');
      grip.className = 'song-grip';
      grip.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
      grip.title = filtered ? 'Xóa tìm kiếm để sắp xếp setlist' : 'Kéo để sắp xếp (hoặc Alt + ↑/↓)';
      grip.setAttribute('aria-hidden', 'true');
      if (filtered) grip.classList.add('disabled');
      else grip.addEventListener('pointerdown', (e) => startDrag(e, li, grip));
      grip.addEventListener('click', (e) => e.stopPropagation());

      const num = document.createElement('span');
      num.className = 'song-num';
      num.textContent = String(index + 1).padStart(2, '0');
      if (song.cover) {
        num.classList.add('has-cover');
        Island.setCoverBackground(num, song.cover);
      }

      const text = document.createElement('div');
      text.className = 'song-text';
      const t = document.createElement('span');
      t.className = 'song-title';
      t.textContent = song.title;
      const a = document.createElement('span');
      a.className = 'song-artist';
      a.textContent = song.artist || '—';
      text.append(t, a);

      const del = document.createElement('button');
      del.className = 'song-del';
      del.type = 'button';
      del.setAttribute('aria-label', `Xóa ${song.title}`);
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const patch = { setlist: (Island.state.setlist || []).filter((x) => x.id !== song.id) };
        if (Island.state.nextOverrideId === song.id) patch.nextOverrideId = '';
        Island.write(patch);
      });

      const pick = () => {
        if (Island.state.sync?.source === 'youtube') {
          const override = Island.state.nextOverrideId === song.id ? '' : song.id;
          Island.write({ nextOverrideId: override });
          toast(override ? `Đã chọn Next: ${song.title}` : 'Đã bỏ chọn Next thủ công');
        } else pickSong(song);
      };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') pick();
        else if (!filtered && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          moveSong(index, index + (e.key === 'ArrowUp' ? -1 : 1), true);
        }
      });

      li.append(grip, num, text);
      if (li.classList.contains('next')) {
        const badge = document.createElement('span');
        badge.className = 'song-badge';
        badge.textContent = 'Tiếp theo';
        li.append(badge);
      }
      li.append(del);
      setlistEl.appendChild(li);
    });
  }

  function moveSong(from, to, keepFocus) {
    const list = [...(Island.state.setlist || [])];
    if (to < 0 || to >= list.length || from === to) return;
    const [song] = list.splice(from, 1);
    list.splice(to, 0, song);
    Island.write({ setlist: list });
    if (keepFocus) { const el = $(`song-${song.id}`); if (el) el.focus(); }
  }

  /* Drag to reorder (pointer events → mouse, touch and pen) */
  let drag = null;
  const GAP = 6; // keep in sync with .setlist gap

  function startDrag(e, li, grip) {
    if (setlistQuery.trim() || e.button !== 0 || drag) return;
    e.preventDefault();
    const sel = getSelection();
    if (sel) sel.removeAllRanges();
    const items = [...setlistEl.children];
    const localFrom = items.indexOf(li);
    const from = localFrom + setlistPage * PAGE_SIZE;
    drag = {
      li, grip, items, from, localFrom, to: from,
      startY: e.clientY + scrollY,
      tops: items.map((el) => el.getBoundingClientRect().top + scrollY),
      heights: items.map((el) => el.offsetHeight),
    };
    grip.setPointerCapture(e.pointerId);
    setlistEl.classList.add('dragging');
    li.classList.add('drag');
    document.body.classList.add('grabbing');
    grip.addEventListener('pointermove', onDragMove);
    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', endDrag);
  }

  function onDragMove(e) {
    // Auto-scroll near the edges (long setlists in a small dock)
    if (e.clientY < 60) scrollBy(0, -12);
    else if (e.clientY > innerHeight - 60) scrollBy(0, 12);

    const { li, items, localFrom, tops, heights } = drag;
    const dy = e.clientY + scrollY - drag.startY;
    li.style.transform = `translateY(${dy}px) scale(1.02)`;

    // Where would the dragged row's center land?
    const center = tops[localFrom] + heights[localFrom] / 2 + dy;
    let localTo = localFrom;
    for (let i = localFrom + 1; i < items.length; i++) if (center > tops[i] + heights[i] / 2) localTo = i;
    for (let i = localFrom - 1; i >= 0; i--) if (center < tops[i] + heights[i] / 2) localTo = i;
    drag.to = localTo + setlistPage * PAGE_SIZE;

    // Make room: rows between from and to slide by the dragged row's height
    const step = heights[localFrom] + GAP;
    items.forEach((el, i) => {
      if (i === localFrom) return;
      let shift = 0;
      if (localFrom < localTo && i > localFrom && i <= localTo) shift = -step;
      if (localFrom > localTo && i >= localTo && i < localFrom) shift = step;
      el.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }

  function endDrag() {
    const { li, grip, items, from, to } = drag;
    grip.removeEventListener('pointermove', onDragMove);
    grip.removeEventListener('pointerup', endDrag);
    grip.removeEventListener('pointercancel', endDrag);
    items.forEach((el) => (el.style.transform = ''));
    li.classList.remove('drag');
    setlistEl.classList.remove('dragging');
    document.body.classList.remove('grabbing');
    drag = null;
    if (to !== from) {
      moveSong(from, to);
      toast(Island.state.sync?.source === 'youtube' && Island.state.nextOverrideId ? 'Đã sắp xếp setlist' : 'Đã sắp xếp setlist');
    } else {
      // Dropped in place — re-render in case the state changed mid-drag
      setlistEl.dataset.sig = '';
      renderSetlist(Island.state);
    }
  }

  /* ---------------- Render state ---------------- */
  function render(s) {
    Island.applyTheme(root, s.theme);
    document.body.classList.toggle('is-playing', !!s.playing);
    const youtube = s.sync && s.sync.source === 'youtube';
    setlistHint.textContent = youtube ? 'Bấm bài để chọn Next · kéo ⋮⋮ để sắp xếp' : 'Bấm để chuyển bài · kéo ⋮⋮ để sắp xếp';
    linkYouTubeBtn.hidden = !youtube || !s.media?.videoId;
    stateText.textContent = s.playing ? 'Đang phát' : 'Tạm dừng';
    sourceText.textContent = youtube ? (s.media?.connected ? 'YouTube · Đã đồng bộ' : 'YouTube · Mất kết nối') : 'Thủ công';
    playBtn.disabled = youtube;
    playBtn.title = youtube ? 'Được điều khiển bởi YouTube' : 'Phát / Tạm dừng (Space)';
    resetBtn.disabled = youtube;
    visibleBtn.classList.toggle('off', s.visible === false);

    swatchesEl.querySelectorAll('.swatch').forEach((b) =>
      b.setAttribute('aria-checked', String(b.dataset.theme === s.theme))
    );
    modeSeg.dataset.mode = s.mode;
    modeSeg.querySelectorAll('button').forEach((b) =>
      b.setAttribute('aria-checked', String(b.dataset.mode === s.mode))
    );

    // Sync inputs only when that field actually changed in the shared state,
    // so pending (not yet applied) edits aren't wiped by unrelated updates.
    const active = document.activeElement;
    const first = !lastRendered;
    const prev = lastRendered || {};
    if ((first || s.title !== prev.title) && active !== titleInput) titleInput.value = s.title || '';
    if ((first || s.artist !== prev.artist) && active !== artistInput) {
      artistInput.value = s.artist || '';
      autoValues.artist = s.artist || '';
    }
    if ((first || s.cover !== prev.cover) && active !== coverInput) {
      setCoverValue(s.cover || '');
      autoValues.cover = s.cover || '';
    }
    lastRendered = s;
    updateDirty();

    autoColorEl.checked = s.autoColor !== false;
    showNextEl.checked = s.showNext !== false;
    syncEnabledEl.checked = s.syncEnabled !== false;

    const next = Island.displayNextSong(s);
    nextBtn.disabled = !next;
    nextBtn.title = next ? `Bài tiếp: ${next.title} (N)` : 'Hết bài trong setlist';

    renderSetlist(s);
    const position = youtube ? Island.mediaPosition(s) : null;
    const duration = youtube ? Island.formatDuration(s.media?.durationSec) : '';
    timeText.textContent = position === null ? Island.formatTime(Island.elapsed(s)) : `${Island.formatTime(position * 1000)}${duration ? ` / ${duration}` : ''}`;
  }

  let lastRendered = null;

  Island.subscribe(render);
  setInterval(() => {
    const s = Island.state;
    const youtube = s.sync && s.sync.source === 'youtube';
    const position = youtube ? Island.mediaPosition(s) : null;
    const duration = youtube ? Island.formatDuration(s.media?.durationSec) : '';
    timeText.textContent = position === null ? Island.formatTime(Island.elapsed(s)) : `${Island.formatTime(position * 1000)}${duration ? ` / ${duration}` : ''}`;
  }, 250);

  /* ---------------- Connection status ---------------- */
  if (Island.SERVER) {
    Island.onConnection((ok) => {
      statusEl.dataset.state = ok ? 'online' : 'offline';
      statusText.textContent = ok ? 'Đã kết nối' : 'Mất kết nối';
    });
  } else {
    statusEl.dataset.state = 'local';
    statusText.textContent = 'Cục bộ';
    statusEl.title = 'Đang mở trực tiếp file. Chạy "node server.js" để đồng bộ với OBS.';
  }

  /* ---------------- OBS link ---------------- */
  const previewUrl = new URL('overlay.html', location.href);
  previewUrl.searchParams.set('preview', '');
  previewUrl.searchParams.set('pos', 'center');
  previewUrl.searchParams.set('scale', '0.7');
  const token = new URLSearchParams(location.search).get('token');
  if (token) previewUrl.searchParams.set('token', token);
  $('preview').src = previewUrl.href;
  const overlayUrl = new URL('overlay.html', location.href);
  if (token) overlayUrl.searchParams.set('token', token);
  $('overlayUrl').textContent = overlayUrl.href;

  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = $(btn.dataset.copy).textContent;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast('Đã copy link');
    });
  });
})();
