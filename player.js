// ─── Extension Player ─────────────────────────────────────────────
// Fullscreen lockdown audio player for the Chrome extension.
// Reads session data from chrome.storage.session (written by popup.js).

let exitWordHash = null;

// ─── Lockdown ────────────────────────────────────────────────────

// Maximise the window when the player opens
chrome.windows.getCurrent(w => {
  chrome.windows.update(w.id, { state: 'fullscreen' });
});

// Prevent right-click context menu
document.addEventListener('contextmenu', e => e.preventDefault());

// Suppress F5 / Ctrl+R refresh and Ctrl+W close attempts
document.addEventListener('keydown', e => {
  if (e.key === 'F5' || (e.ctrlKey && e.key === 'r') || (e.ctrlKey && e.key === 'w')) {
    e.preventDefault();
  }
});

// ─── Load Session ────────────────────────────────────────────────

chrome.storage.session.get('sessionData', ({ sessionData }) => {
  if (!sessionData || !sessionData.signedUrl) {
    showError('Session expired or not found. Please re-enter your code using the extension icon.');
    return;
  }

  exitWordHash = sessionData.exitWordHash;

  // Set filename in top bar and page title
  document.getElementById('top-filename').textContent = sessionData.filename;
  document.title = 'AudioProctor — ' + sessionData.filename;

  // Load audio
  const audio = document.getElementById('audio-el');
  audio.src   = sessionData.signedUrl;

  // Wire controls
  document.getElementById('btn-play').addEventListener('click', togglePlay);
  document.getElementById('progress-bar').addEventListener('input', function () {
    audio.currentTime = parseFloat(this.value);
  });
  document.getElementById('exit-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptExit();
  });

  audio.addEventListener('loadedmetadata', () => {
    document.getElementById('progress-bar').max = audio.duration;
    document.getElementById('time-total').textContent = formatTime(audio.duration);
  });

  audio.addEventListener('timeupdate', () => {
    const bar = document.getElementById('progress-bar');
    bar.value = audio.currentTime;
    document.getElementById('time-current').textContent = formatTime(audio.currentTime);
  });

  audio.addEventListener('ended', () => {
    document.getElementById('btn-play').innerHTML = '&#9654;';
  });

  audio.addEventListener('error', () => {
    showError('Audio failed to load. The session link may have expired. Ask your teacher to restart the assessment.');
  });

  showPlayer();
});

// ─── Audio Controls ──────────────────────────────────────────────

function togglePlay() {
  const audio = document.getElementById('audio-el');
  const btn   = document.getElementById('btn-play');
  if (audio.paused) {
    audio.play();
    btn.innerHTML = '&#9646;&#9646;';
  } else {
    audio.pause();
    btn.innerHTML = '&#9654;';
  }
}

function rewind() {
  const audio = document.getElementById('audio-el');
  audio.currentTime = Math.max(0, audio.currentTime - 10);
}

function changeSpeed(rate) {
  document.getElementById('audio-el').playbackRate = parseFloat(rate);
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
    // Correct — clear session and close the tab
    chrome.storage.session.remove('sessionData', () => {
      chrome.tabs.getCurrent(tab => chrome.tabs.remove(tab.id));
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
