const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadIsland() {
  const sandbox = {
    window: {}, location: { protocol: 'file:', search: '' },
    localStorage: { getItem: () => '{}', setItem() {} }, addEventListener() {},
    setInterval() {}, Date, JSON, String, Math, URLSearchParams,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync('shared.js', 'utf8'), sandbox);
  return sandbox.Island;
}

test('matches setlist by YouTube video ID before metadata', () => {
  const Island = loadIsland();
  Island.write({
    title: 'Different title', artist: 'Different artist',
    sync: { source: 'youtube' }, media: { videoId: 'video-2', positionSec: 0 },
    setlist: [
      { id: 'one', title: 'Same', artist: 'Artist', youtubeVideoId: 'video-1' },
      { id: 'two', title: 'Other', artist: 'Else', youtubeVideoId: 'video-2' },
    ],
  });
  assert.equal(Island.currentIndex(), 1);
});

test('does not resolve duplicate title without artist match', () => {
  const Island = loadIsland();
  Island.write({
    title: 'Hello', artist: 'Unknown',
    setlist: [
      { id: 'one', title: 'Hello', artist: 'Artist A' },
      { id: 'two', title: 'Hello', artist: 'Artist B' },
    ],
  });
  assert.equal(Island.currentIndex(), -1);
});

test('explicit Next override wins and safely falls back when stale', () => {
  const Island = loadIsland();
  const first = { id: 'first', title: 'First' };
  const second = { id: 'second', title: 'Second' };
  Island.write({ title: 'First', setlist: [first, second], nextOverrideId: 'first' });
  assert.equal(Island.displayNextSong().id, 'first');
  Island.write({ nextOverrideId: 'missing' });
  assert.equal(Island.displayNextSong().id, 'second');
});
test('media position advances only while YouTube is playing and clamps duration', () => {
  const Island = loadIsland();
  const future = Date.now() + 5000;
  const playing = { sync: { source: 'youtube' }, playing: true, media: { positionSec: 8, durationSec: 10, observedAt: Date.now() - 5000, playbackRate: 1 } };
  assert.equal(Island.mediaPosition(playing), 10);
  const paused = { ...playing, playing: false };
  assert.equal(Island.mediaPosition(paused), 8);
  assert.ok(future > 0);
});
