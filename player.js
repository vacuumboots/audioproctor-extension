// ─── Extension Player ─────────────────────────────────────────────
// Fullscreen lockdown audio player for the Chrome extension.
// Reads session data from chrome.storage.session (written by popup.js).
//
// Audio plays in a chrome.offscreen document (offscreen.js/offscreen.html).
// Commands are sent via chrome.runtime.sendMessage({target:'offscreen',...})
// and events arrive via chrome.runtime.onMessage with {target:'player'}.

let API_BASE         = 'https://audioproctor.com';
const ALLOWED_API_BASES = ['https://audioproctor.com', 'https://app.audioproctor.com'];
const ALLOWED_URL_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.co\//;
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
  if (e.key === 'Escape')     { e.preventDefault(); enforceFullscreen(); return; }
  if (/^F\d+$/.test(e.key))  { e.preventDefault(); return; }
  if (e.ctrlKey || e.altKey || e.metaKey) { e.preventDefault(); return; }

  // ── Text reader keyboard controls ──────────────────────────────
  const textState = document.getElementById('state-text');
  if (textState && !textState.classList.contains('hidden')) {
    // Don't intercept if user is typing in the exit input
    if (document.activeElement && document.activeElement.id === 'exit-input') return;

    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      toggleReadAloud();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      jumpParagraph(-1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      jumpParagraph(1);
      return;
    }
  }
});

// ─── Audio Commands ──────────────────────────────────────────────

function sendOffscreen(msg) {
  chrome.runtime.sendMessage({ target: 'offscreen', ...msg }).catch(() => {});
}

// ─── Load Session ────────────────────────────────────────────────

chrome.storage.session.get('sessionData', ({ sessionData }) => {
  if (!sessionData || (!sessionData.signedUrl && !sessionData.textContent)) {
    showError('Session expired or not found. Please re-enter your code using the extension icon.');
    logEvent('session_expired');
    return;
  }

  exitWordHash = sessionData.exitWordHash;
  sessionCode  = sessionData.code;
  if (sessionData.apiBase && ALLOWED_API_BASES.includes(sessionData.apiBase)) {
    API_BASE = sessionData.apiBase;
  }

  const displayTitle = sessionData.title || sessionData.filename || 'Assessment';
  document.getElementById('top-filename').textContent = displayTitle;
  document.title = 'AudioProctor — ' + displayTitle;

  // ─── Branch: audio vs text ──────────────────────────────────────

  if (sessionData.assessmentType === 'text' && sessionData.textContent) {
    // Text assessment — render paragraphs, wire read-aloud, skip audio infrastructure
    renderTextParagraphs(sessionData.textContent);
    initReadAloud();
    document.getElementById('state-loading').classList.add('hidden');
    document.getElementById('state-text').classList.remove('hidden');
    logEvent('text_viewed');
  } else {
    // Audio assessment — existing flow
    signedUrl = sessionData.signedUrl;
    if (!signedUrl || !ALLOWED_URL_PATTERN.test(signedUrl)) {
      showError('Invalid audio source. Please re-enter your code.');
      logEvent('audio_error', { message: 'invalid signed URL origin' });
      return;
    }
    sendOffscreen({ action: 'load', url: signedUrl });
    startLoadTimeout();
  }

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
      case 'playing':
        audioPaused = false;
        document.getElementById('btn-play').innerHTML = '&#9646;&#9646;';
        { const pos = Math.round(audioCurrentTime || 0);
          logEvent(pos < 2 ? 'playback_started' : 'playback_resumed', { position_seconds: pos }); }
        break;
      case 'pause':
        // The 'pause' event also fires after 'ended'; only log if we weren't already paused.
        if (!audioPaused) {
          audioPaused = true;
          document.getElementById('btn-play').innerHTML = '&#9654;';
          logEvent('playback_paused', { position_seconds: Math.round(audioCurrentTime || 0) });
        }
        break;
      case 'play_error':
        audioPaused = true;
        document.getElementById('btn-play').innerHTML = '&#9654;';
        showError('Playback blocked: ' + msg.message + '. Try clicking Play again.');
        break;
      case 'error':
        audioPaused = true;
        document.getElementById('btn-play').innerHTML = '&#9654;';
        showError('Audio failed: ' + msg.message + '. Ask your teacher to restart.');
        logEvent('audio_error', { message: msg.message });
        break;
    }
  });

  // Wire controls
  document.getElementById('btn-play').addEventListener('click', togglePlay);
  document.getElementById('btn-rewind').addEventListener('click', rewind);
  document.getElementById('speed-select').addEventListener('change', function () {
    changeSpeed(this.value);
  });
  document.getElementById('progress-bar').addEventListener('input', function () {
    sendOffscreen({ action: 'seek', time: parseFloat(this.value) });
  });

  // Error-state retry
  document.getElementById('btn-retry').addEventListener('click', retryLoad);
});

// ─── Exit Section (always visible, wired outside session callback) ───

document.getElementById('btn-exit').addEventListener('click', () => attemptExit('exit-input', 'exit-error'));
document.getElementById('exit-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') attemptExit('exit-input', 'exit-error');
});

// ─── Text Reader ─────────────────────────────────────────────────

let ttsParagraphs  = [];
let ttsCurrentIdx  = -1;
let ttsPlaying     = false;
let ttsPaused      = false;
let ttsRate        = 1.0;
let ttsVoice       = '';

function renderTextParagraphs(rawText) {
  const container = document.getElementById('text-paragraphs');
  // Split on double newlines, collapse whitespace, filter empty
  const chunks = rawText
    .split(/\n{2,}/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  container.innerHTML = '';
  ttsParagraphs = [];

  chunks.forEach((chunk, i) => {
    const p = document.createElement('p');
    p.textContent = chunk;
    p.dataset.idx = i;
    container.appendChild(p);
    ttsParagraphs.push(p);
  });
}

function initReadAloud() {
  const btnPlay  = document.getElementById('btn-tts-play');
  const btnPrev  = document.getElementById('btn-tts-prev');
  const btnNext  = document.getElementById('btn-tts-next');
  const speedEl  = document.getElementById('tts-speed');

  btnPlay.addEventListener('click', toggleReadAloud);
  btnPrev.addEventListener('click', () => jumpParagraph(-1));
  btnNext.addEventListener('click', () => jumpParagraph(1));
  speedEl.addEventListener('change', function () {
    ttsRate = parseFloat(this.value);
    if (ttsPlaying && !ttsPaused) {
      chrome.tts.stop();
      speakParagraph(ttsCurrentIdx);
    }
  });

  // ── Voice selector ──────────────────────────────────────────────
  const voiceEl = document.getElementById('tts-voice');
  chrome.tts.getVoices(function (voices) {
    voices.forEach(function (v) {
      const opt = document.createElement('option');
      opt.value = v.voiceName;
      opt.textContent = v.voiceName + (v.lang ? ' (' + v.lang + ')' : '');
      voiceEl.appendChild(opt);
    });
    // Default to empty (system default)
    voiceEl.value = '';
  });
  voiceEl.addEventListener('change', function () {
    ttsVoice = this.value;
    if (ttsPlaying && !ttsPaused) {
      chrome.tts.stop();
      speakParagraph(ttsCurrentIdx);
    }
  });

  // ── Display settings ───────────────────────────────────────────
  const container = document.getElementById('text-paragraphs');
  const card      = document.getElementById('state-text');
  let fontSize    = 1.15;  // rem, matches CSS default

  document.getElementById('btn-font-down').addEventListener('click', () => {
    fontSize = Math.max(0.7, +(fontSize - 0.1).toFixed(2));
    container.style.fontSize = fontSize + 'rem';
  });

  document.getElementById('btn-font-up').addEventListener('click', () => {
    fontSize = Math.min(2.5, +(fontSize + 0.1).toFixed(2));
    container.style.fontSize = fontSize + 'rem';
  });

  const btnFullwidth = document.getElementById('btn-fullwidth');
  btnFullwidth.addEventListener('click', () => {
    card.classList.toggle('fullwidth');
    btnFullwidth.classList.toggle('active');
  });
}

function toggleReadAloud() {
  if (!ttsPlaying) {
    // Start reading from current or first paragraph
    const idx = ttsCurrentIdx >= 0 ? ttsCurrentIdx : 0;
    speakParagraph(idx);
  } else if (ttsPaused) {
    chrome.tts.resume();
    ttsPaused = false;
    updateTtsPlayBtn();
  } else {
    chrome.tts.pause();
    ttsPaused = true;
    updateTtsPlayBtn();
  }
}

function jumpParagraph(delta) {
  chrome.tts.stop();
  const next = Math.max(0, Math.min(ttsParagraphs.length - 1, ttsCurrentIdx + delta));
  speakParagraph(next);
}

function speakParagraph(idx) {
  if (idx < 0 || idx >= ttsParagraphs.length) return;

  // Clear previous highlight
  ttsParagraphs.forEach(p => p.classList.remove('tts-active'));

  ttsCurrentIdx = idx;
  ttsParagraphs[idx].classList.add('tts-active');
  ttsParagraphs[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });

  const text = ttsParagraphs[idx].textContent;
  const statusEl = document.getElementById('tts-status');
  statusEl.textContent = `Paragraph ${idx + 1} of ${ttsParagraphs.length}`;

  chrome.tts.speak(text, {
    rate: ttsRate,
    lang: 'en-US',
    voiceName: ttsVoice || undefined,
    desiredEventTypes: ['end', 'error'],
    onEvent: (event) => {
      if (event.type === 'end') {
        // Auto-advance to next paragraph
        if (ttsCurrentIdx < ttsParagraphs.length - 1) {
          speakParagraph(ttsCurrentIdx + 1);
        } else {
          // Finished all paragraphs
          stopReadAloud();
          statusEl.textContent = 'Finished';
        }
      } else if (event.type === 'error') {
        stopReadAloud();
        statusEl.textContent = 'Read aloud error';
      }
    }
  });

  ttsPlaying = true;
  ttsPaused  = false;
  updateTtsPlayBtn();
}

function stopReadAloud() {
  chrome.tts.stop();
  ttsPlaying = false;
  ttsPaused  = false;
  ttsParagraphs.forEach(p => p.classList.remove('tts-active'));
  updateTtsPlayBtn();
}

function updateTtsPlayBtn() {
  const btn = document.getElementById('btn-tts-play');
  if (!ttsPlaying) {
    btn.innerHTML = '&#9654;';
  } else if (ttsPaused) {
    btn.innerHTML = '&#9654;';
  } else {
    btn.innerHTML = '&#9646;&#9646;';
  }
}

// ─── Audio Controls ──────────────────────────────────────────────

function togglePlay() {
  if (audioPaused) {
    sendOffscreen({ action: 'play' });
  } else {
    sendOffscreen({ action: 'pause' });
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
  }, 120000);
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
  const data = new TextEncoder().encode(word);
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
    referrerPolicy: 'no-referrer',
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
