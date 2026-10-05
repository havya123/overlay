const defaults = { serverUrl: 'http://localhost:7777', token: '' };
(async () => {
  const config = await chrome.storage.local.get(defaults);
  serverUrl.value = config.serverUrl;
  token.value = config.token;
  save.addEventListener('click', async () => {
    const url = serverUrl.value.trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(url)) { status.textContent = 'URL server không hợp lệ.'; return; }
    await chrome.storage.local.set({ serverUrl: url, token: token.value.trim() });
    status.textContent = 'Đã lưu.';
  });
})();
