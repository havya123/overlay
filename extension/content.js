(() => {
  'use strict';
  let video = null;
  let lastUrl = '';
  let sequence = 0;
  let timer = null;
  let lastSent = 0;

  const idFromUrl = () => new URL(location.href).searchParams.get('v') || '';
  const title = () => document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string')?.textContent?.trim() || document.title.replace(/\s*-\s*YouTube\s*$/, '').trim();
  const artist = () => document.querySelector('#owner #channel-name a, ytd-channel-name a')?.textContent?.trim() || '';
  const thumbnail = (id) => id ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg` : '';

  function snapshot(force = false) {
    const id = idFromUrl();
    if (!id || !video) return;
    const now = Date.now();
    if (!force && now - lastSent < 700 && Math.abs((video.currentTime || 0) - (snapshot.lastPosition || 0)) < 0.35) return;
    snapshot.lastPosition = video.currentTime || 0;
    lastSent = now;
    chrome.runtime.sendMessage({
      type: 'youtube-snapshot',
      videoId: id,
      title: title(),
      artist: artist(),
      thumbnail: thumbnail(id),
      videoUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
      positionSec: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      durationSec: Number.isFinite(video.duration) ? video.duration : null,
      playbackRate: Number.isFinite(video.playbackRate) ? video.playbackRate : 1,
      playing: !video.paused && !video.ended,
      ended: !!video.ended,
      sequence: ++sequence,
    });
  }

  const events = ['play','playing','pause','seeking','seeked','loadedmetadata','ended','ratechange'];
  const onMediaEvent = () => snapshot(true);

  function bind() {
    const found = document.querySelector('video.html5-main-video, video');
    const url = location.href;
    if (!found || found === video && url === lastUrl) return;
    if (video) events.forEach((e) => video.removeEventListener(e, onMediaEvent));
    video = found;
    lastUrl = url;
    events.forEach((e) => video.addEventListener(e, onMediaEvent));
    snapshot(true);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'request-snapshot') snapshot(true);
  });

  setInterval(() => snapshot(true), 2000);
  setInterval(() => { bind(); snapshot(false); }, 500);
  new MutationObserver(bind).observe(document.documentElement, { childList: true, subtree: true });
  bind();
})();
