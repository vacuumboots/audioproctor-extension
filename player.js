// ─── Extension Player ─────────────────────────────────────────────
// Fullscreen lockdown audio player for the Chrome extension.
// Reads session data from chrome.storage.session (written by popup.js).
//
// Audio plays in a chrome.offscreen document (offscreen.js/offscreen.html).
// Commands are sent via chrome.runtime.sendMessage({target:'offscreen',...})
// and events arrive via chrome.runtime.onMessage with {target:'player'}.

let API_BASE         = 'https://audioproctor.com';
let exitWordHash     = null;
let sessionCode      = null;
let allowClose       = false;
let audioPaused      = true;
let audioCurrentTime = 0;
let signedUrl        = null;
let loadTimeout      = null;

// ─── Lockdown ────────────────────────────────────────────────────

chrome.windows.getCurrent(w => {
  chrome.windows.update(w.id, { state: 'fullscreen' });
});

function enforceFullscreen() {
  if (allowClose) return;
  chrome.windows.getCurrent(w => {
    if (w.state !== 'fullscreen') {
      chrome.windows.update(w.id, { state: 'fullscreen' });
    }
  });
}
window.addEventListener('resize', enforceFullscreen);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') enforceFullscreen();
});

window.addEventListener('beforeunload', e => {
  if (!allowClose) { e.preventDefault(); e.returnValue = ''; }
});

document.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('keydown', e => {
  if (e.key === 'Tab')        { e.preventDefault(); return; }
  if (e.key === 'Escape')     { e.preventDefault(); enforceFullscreen(); return; }
  if (/^F\d+$/.test(e.key))  { e.preventDefault(); return; }
  if (e.ctrlKey || e.altKey || e.metaKey) { e.preventDefault(); return; }
});

// ─── Audio Commands ──────────────────────────────────────────────

function sendOffscreen(msg) {
  chrome.runtime.sendMessage({ target: 'offscreen', ...msg }).catch(() => {});
}

// ─── Load Session ────────────────────────────────────────────────

chrome.storage.session.get('sessionData', ({ sessionData }) => {
  if (!sessionData || !sessionData.signedUrl) {
    showError('Session expired or not found. Please re-enter your code using the extension icon.');
    logEvent('session_expired');
    return;
  }

  exitWordHash = sessionData.exitWordHash;
  sessionCode  = sessionData.code;
  if (sessionData.apiBase) API_BASE = sessionData.apiBase;

  document.getElementById('top-filename').textContent = sessionData.filename;
  document.title = 'AudioProctor — ' + sessionData.filename;

  // Load audio in the offscreen document
  signedUrl = sessionData.signedUrl;
  sendOffscreen({ action: 'load', url: signedUrl });
  startLoadTimeout();

  // Listen for events from the offscreen document
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.target !== 'player') return;

    switch (msg.type) {
      case 'loadedmetadata':
        document.getElementById('progress-bar').max = msg.duration;
        document.getElementById('time-total').textContent = formatTime(msg.duration);
        showPlayer();
        break;
      case 'timeupdate':
        audioCurrentTime = msg.currentTime;
        document.getElementById('progress-bar').value = msg.currentTime;
        document.getElementById('time-current').textContent = formatTime(msg.currentTime);
        break;
      case 'ended':
        audioPaused = true;
        document.getElementById('btn-play').innerHTML = '&#9654;';
        logEvent('playback_completed');
        break;
      case 'error':
        audioPaused = true;
        document.getElementById('btn-play').innerHTML = '&#9654;';
        showError('Audio failed: ' + msg.message + '. Ask your teacher to restart.');
        logEvent('session_expired');
        break;
    }
  });

  // Wire controls
  document.getElementById('btn-play').addEventListener('click', togglePlay);
  document.getElementById('btn-rewind').addEventListener('click', rewind);
  document.getElementById('speed-select').addEventListener('change', function () {
    changeSpeed(this.value);
  });
  document.getElementById('btn-exit').addEventListener('click', () => attemptExit('exit-input', 'exit-error'));
  document.getElementById('progress-bar').addEventListener('input', function () {
    sendOffscreen({ action: 'seek', time: parseFloat(this.value) });
  });
  document.getElementById('exit-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptExit('exit-input', 'exit-error');
  });

  // Error-state retry and exit
  document.getElementById('btn-retry').addEventListener('click', retryLoad);
  document.getElementById('btn-exit-error').addEventListener('click', () => attemptExit('exit-input-error', 'exit-error-error'));
  document.getElementById('exit-input-error').addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptExit('exit-input-error', 'exit-error-error');
  });
});

// ─── Audio Controls ──────────────────────────────────────────────

function togglePlay() {
  const btn = document.getElementById('btn-play');
  if (audioPaused) {
    sendOffscreen({ action: 'play' });
    btn.innerHTML = '&#9646;&#9646;';
    audioPaused = false;
    const pos = Math.round(audioCurrentTime || 0);
    logEvent(pos < 2 ? 'playback_started' : 'playback_resumed', { position_seconds: pos });
  } else {
    sendOffscreen({ action: 'pause' });
    btn.innerHTML = '&#9654;';
    audioPaused = true;
    logEvent('playback_paused', { position_seconds: Math.round(audioCurrentTime || 0) });
  }
}

function rewind() {
  sendOffscreen({ action: 'rewind', seconds: 10 });
  logEvent('replay_triggered', { position_seconds: Math.round(audioCurrentTime || 0) });
}

function changeSpeed(rate) {
  sendOffscreen({ action: 'speed', rate: parseFloat(rate) });
}

// ─── Load Timeout + Retry ────────────────────────────────────────

function startLoadTimeout() {
  clearTimeout(loadTimeout);
  loadTimeout = setTimeout(() => {
    if (document.getElementById('state-loading').classList.contains('hidden')) return;
    showError('Audio is taking too long to load. Please try again.');
  }, 60000);
}

function retryLoad() {
  document.getElementById('state-error').classList.add('hidden');
  document.getElementById('state-loading').classList.remove('hidden');
  sendOffscreen({ action: 'load', url: signedUrl });
  startLoadTimeout();
}

// ─── Exit Word Verification ──────────────────────────────────────

async function attemptExit(inputId, errorId) {
  const input = document.getElementById(inputId);
  const word  = input.value.toLowerCase().trim();

  if (!word) {
    showExitError(errorId, 'Please type the exit word.');
    return;
  }

  const hash = await hashWord(word);

  if (hash === exitWordHash) {
    logEvent('exit_word_used');
    allowClose = true;
    chrome.runtime.sendMessage({ type: 'player_closing' });
    chrome.storage.session.remove('sessionData', () => {
      chrome.windows.getCurrent(w => chrome.windows.remove(w.id));
    });
  } else {
    showExitError(errorId, 'Incorrect exit word. Ask your teacher.');
    input.value = '';
    input.focus();
  }
}

async function hashWord(word) {
  const data = new TextEncoder().encode(word.toLowerCase().trim());
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Event Logging ───────────────────────────────────────────────

function logEvent(eventType, metadata) {
  if (!sessionCode) return;
  fetch(`${API_BASE}/api/event`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ code: sessionCode, eventType, metadata }),
  }).catch(() => {});
}

// ─── State Helpers ───────────────────────────────────────────────

function showPlayer() {
  document.getElementById('state-loading').classList.add('hidden');
  document.getElementById('state-player').classList.remove('hidden');
}

function showError(msg) {
  document.getElementById('state-loading').classList.add('hidden');
  document.getElementById('error-msg').textContent = msg;
  document.getElementById('state-error').classList.remove('hidden');
}

function showExitError(errorId, msg) {
  const el = document.getElementById(errorId);
  el.textContent   = msg;
  el.style.display = 'block';
}

// ─── Util ────────────────────────────────────────────────────────

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
