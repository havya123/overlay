const DEFAULTS = {
  serverUrl: 'http://localhost:7777',
  token: '',
  ownerId: crypto.randomUUID(),
  connectedTabId: null,
};

async function settings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  if (!stored.ownerId) {
    stored.ownerId = crypto.randomUUID();
    await chrome.storage.local.set({ ownerId: stored.ownerId });
  }
  return stored;
}

async function updateStatus(status) {
  await chrome.storage.session.set({ lastStatus: { ...status, at: Date.now() } });
}

async function claim(tabId) {
  const config = await settings();
  const endpoint = config.serverUrl.replace(/\/$/, '') + '/api/youtube/claim';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    },
    body: JSON.stringify({ ownerId: config.ownerId, tabId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
}

async function release() {
  const config = await settings();
  const endpoint = config.serverUrl.replace(/\/$/, '') + '/api/youtube/release';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    },
    body: JSON.stringify({ ownerId: config.ownerId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
}

async function sync(tabId, snapshot) {
  const config = await settings();
  if (config.connectedTabId !== tabId) return;
  const endpoint = config.serverUrl.replace(/\/$/, '') + '/api/youtube/sync';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify({ ...snapshot, ownerId: config.ownerId, tabId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    await updateStatus({ ok: true, message: 'Đang đồng bộ', videoId: snapshot.videoId });
  } catch (err) {
    await updateStatus({ ok: false, message: err.message || 'Không kết nối được server' });
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'youtube-snapshot' && sender.tab?.id !== undefined) sync(sender.tab.id, message);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const config = await settings();
  if (config.connectedTabId !== tabId) return;
  try { await release(); } catch {}
  await chrome.storage.local.set({ connectedTabId: null });
  await updateStatus({ ok: false, message: 'Tab đã ngắt kết nối' });
});

async function restoreOwner() {
  const config = await settings();
  if (config.connectedTabId === null) return;
  try {
    await claim(config.connectedTabId);
    await updateStatus({ ok: true, message: 'Đã khôi phục tab YouTube' });
    chrome.tabs.sendMessage(config.connectedTabId, { type: 'request-snapshot' }).catch(() => {});
  } catch (err) {
    await updateStatus({ ok: false, message: err.message || 'Không khôi phục được tab' });
  }
}

chrome.runtime.onStartup.addListener(restoreOwner);
chrome.runtime.onInstalled.addListener(restoreOwner);

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === 'disconnect-tab') {
    (async () => {
      try {
        await release();
        await chrome.storage.local.set({ connectedTabId: null });
        await updateStatus({ ok: false, message: 'Đã ngắt đồng bộ YouTube' });
        reply({ ok: true });
      } catch (err) {
        reply({ ok: false, error: err.message });
      }
    })();
    return true;
  }
  if (message?.type !== 'connect-tab') return;
  (async () => {
    const tabId = message.tabId || sender.tab?.id;
    try {
      await claim(tabId);
      await chrome.storage.local.set({ connectedTabId: tabId });
      await updateStatus({ ok: true, message: 'Đã chọn tab — chờ dữ liệu video' });
      if (tabId) chrome.tabs.sendMessage(tabId, { type: 'request-snapshot' }).catch(() => {});
      reply({ ok: true });
    } catch (err) {
      await updateStatus({ ok: false, message: err.message || 'Không thể kết nối server' });
      reply({ ok: false, error: err.message });
    }
  })();
  return true;
});
