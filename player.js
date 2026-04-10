// ─── Extension Player ─────────────────────────────────────────────
// Fullscreen lockdown audio player for the Chrome extension.
// Reads session data from chrome.storage.session (written by popup.js).
//
// Audio plays inside a hidden iframe (audio-bridge.html) served from the
// web domain.  Chrome OS does not route audio output from extension pages
// (chrome-extension:// origin), but iframes on a regular web origin can
// produce sound.  All playback commands and events travel via postMessage.

// API_BASE comes from sessionData.apiBase (set by popup.js).
// To test locally: change API_BASE in popup.js to 'http://localhost:3000'.
// No change needed in this file.
let API_BASE         = 'https://audioproctor.com'; // fallback if sessionData missing
let exitWordHash     = null;
let sessionCode      = null;   // access code — used as session identifier for event logging
let allowClose       = false;  // set true by exit-word success so lockdown permits close
let audioPaused      = true;   // tracks play/pause (bridge is in a separate frame)
let audioCurrentTime = 0;      // updated by bridge timeupdate events

// ─── Lockdown ────────────────────────────────────────────────────

// Maximise the window when the player opens
chrome.windows.getCurrent(w => {
  chrome.windows.update(w.id, { state: 'fullscreen' });
});

// Re-enter fullscreen if the student exits it (via the Chrome X button, etc.)
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

// Warn if the student tries to close the tab without the exit word
window.addEventListener('beforeunload', e => {
  if (!allowClose) { e.preventDefault(); e.returnValue = ''; }
});

// Prevent right-click context menu
document.addEventListener('contextmenu', e => e.preventDefault());

// Block keyboard shortcuts that could escape the assessment.
// Regular typing (exit word input) still works — only modifier combos and nav keys are blocked.
document.addEventListener('keydown', e => {
  if (e.key === 'Tab')        { e.preventDefault(); return; } // focus escape to address bar
  if (e.key === 'Escape')     { e.preventDefault(); enforceFullscreen(); return; }
  if (/^F\d+$/.test(e.key))  { e.preventDefault(); return; } // F1-F12
  if (e.ctrlKey || e.altKey || e.metaKey) { e.preventDefault(); return; }
});

// ─── Audio Bridge ────────────────────────────────────────────────
// Sends commands to the hidden iframe that actually plays the audio.

function sendBridge(msg) {
  const frame = document.getElementById('audio-frame');
  if (frame && frame.contentWindow) {
    frame.contentWindow.postMessage(msg, '*');
  }
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

  // Set filename in top bar and page title
  document.getElementById('top-filename').textContent = sessionData.filename;
  document.title = 'AudioProctor — ' + sessionData.filename;

  // Load audio via hidden iframe on the web domain
  const frame = document.getElementById('audio-frame');
  frame.src = API_BASE + '/audio-bridge.html';

  frame.addEventListener('load', () => {
    frame.contentWindow.postMessage(
      { type: 'load', url: sessionData.signedUrl }, '*'
    );
  });

  // Listen for events from the audio bridge
  window.addEventListener('message', e => {
    const msg = e.data;
    if (!msg || !msg.type) return;

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
  document.getElementById('btn-exit').addEventListener('click', attemptExit);
  document.getElementById('progress-bar').addEventListener('input', function () {
    sendBridge({ type: 'seek', time: parseFloat(this.value) });
  });
  document.getElementById('exit-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptExit();
  });

  // Timeout: if audio doesn't load within 15s, show error
  setTimeout(() => {
    if (document.getElementById('state-loading').classList.contains('hidden')) return;
    showError('Audio is taking too long to load. Please try again.');
  }, 15000);
});

// ─── Audio Controls ──────────────────────────────────────────────

function togglePlay() {
  const btn = document.getElementById('btn-play');
  if (audioPaused) {
    sendBridge({ type: 'play' });
    btn.innerHTML = '&#9646;&#9646;';
    audioPaused = false;
    const pos = Math.round(audioCurrentTime || 0);
    logEvent(pos < 2 ? 'playback_started' : 'playback_resumed', { position_seconds: pos });
  } else {
    sendBridge({ type: 'pause' });
    btn.innerHTML = '&#9654;';
    audioPaused = true;
    logEvent('playback_paused', { position_seconds: Math.round(audioCurrentTime || 0) });
  }
}

function rewind() {
  sendBridge({ type: 'rewind', seconds: 10 });
  logEvent('replay_triggered', { position_seconds: Math.round(audioCurrentTime || 0) });
}

function changeSpeed(rate) {
  sendBridge({ type: 'speed', rate: parseFloat(rate) });
}

// ─── Exit Word Verification ──────────────────────────────────────

async function attemptExit() {
  const input = document.getElementById('exit-input');
  const word  = input.value.toLowerCase().trim();

  if (!word) {
    showExitError('Please type the exit word.');
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
    showExitError('Incorrect exit word. Ask your teacher.');
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
// Fire-and-forget POST to /api/event. Failures are silently ignored —
// analytics are best-effort and must never interrupt a student's session.

function logEvent(eventType, metadata) {
  if (!sessionCode) return;
  fetch(`${API_BASE}/api/event`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ code: sessionCode, eventType, metadata }),
  }).catch(() => { /* swallow — analytics must not interrupt assessment */ });
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

function showExitError(msg) {
  const el = document.getElementById('exit-error');
  el.textContent   = msg;
  el.style.display = 'block';
}

// ─── Util ────────────────────────────────────────────────────────

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
