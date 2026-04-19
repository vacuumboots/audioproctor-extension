// ─── Offscreen Audio Document ─────────────────────────────────────
// Runs in a chrome.offscreen document with AUDIO_PLAYBACK reason.
// Receives commands from player.js via chrome.runtime.sendMessage,
// controls the <audio> element, and broadcasts events back to player.js.

const audio = document.getElementById('audio-el');

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  switch (msg.action) {
    case 'load':
      audio.src = msg.url;
      audio.load();
      break;
    case 'play':
      audio.play().catch(err => toPlayer({ type: 'play_error', message: err.message || 'Playback blocked' }));
      break;
    case 'pause':
      audio.pause();
      break;
    case 'seek':
      audio.currentTime = msg.time;
      break;
    case 'rewind':
      audio.currentTime = Math.max(0, audio.currentTime - (msg.seconds || 10));
      break;
    case 'speed':
      audio.playbackRate = msg.rate;
      break;
  }
});

function toPlayer(msg) {
  chrome.runtime.sendMessage({ target: 'player', ...msg }).catch(() => {});
}

audio.addEventListener('loadedmetadata', () =>
  toPlayer({ type: 'loadedmetadata', duration: audio.duration }));
audio.addEventListener('timeupdate', () =>
  toPlayer({ type: 'timeupdate', currentTime: audio.currentTime }));
audio.addEventListener('ended', () =>
  toPlayer({ type: 'ended' }));
audio.addEventListener('error', () =>
  toPlayer({ type: 'error', message: audio.error?.message || 'unknown error' }));
audio.addEventListener('playing', () =>
  toPlayer({ type: 'playing' }));
audio.addEventListener('pause', () =>
  toPlayer({ type: 'pause' }));
