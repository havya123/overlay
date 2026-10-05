const $ = (id) => document.getElementById(id);

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isYoutube = /^https:\/\/www\.youtube\.com\//.test(tab?.url || '');
  $('connect').disabled = !isYoutube;
  $('tab').textContent = isYoutube ? (tab.title || 'Video YouTube') : 'Mở một video YouTube trước.';

  const { lastStatus } = await chrome.storage.session.get('lastStatus');
  if (lastStatus) $('status').textContent = lastStatus.message;

  const config = await chrome.storage.local.get({ connectedTabId: null });
  $('disconnect').disabled = config.connectedTabId === null;
  $('connect').addEventListener('click', async () => {
    const result = await chrome.runtime.sendMessage({ type: 'connect-tab', tabId: tab.id });
    $('status').textContent = result?.ok ? 'Đã chọn tab. Đang nhận dữ liệu video…' : (result?.error || 'Không thể chọn tab.');
  });
  $('disconnect').addEventListener('click', async () => {
    const result = await chrome.runtime.sendMessage({ type: 'disconnect-tab' });
    $('status').textContent = result?.ok ? 'Đã ngắt đồng bộ.' : (result?.error || 'Không thể ngắt đồng bộ.');
    if (result?.ok) $('disconnect').disabled = true;
  });
  $('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
})();
