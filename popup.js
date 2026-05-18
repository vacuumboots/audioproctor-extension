// ─── Extension Popup ─────────────────────────────────────────────
// Validates the access code, calls the session API, then opens
// the lockdown player in a new tab.
// i18n-powered: strings via window.t()

const API_BASE = 'https://audioproctor.com';

const codeInput  = document.getElementById('code-input');
const btnBegin   = document.getElementById('btn-begin');
const errorEl    = document.getElementById('error-msg');
const lblCode    = document.getElementById('lbl-code');
const hintEl     = document.getElementById('hint');
const langToggle = document.getElementById('lang-toggle');

// ── UI text population ────────────────────────────────────────
function updateUI() {
  lblCode.textContent = t('popup.assessmentCode');
  codeInput.placeholder = t('popup.codePlaceholder');
  btnBegin.textContent = t('popup.beginAssessment');
  hintEl.textContent = t('popup.hint');
}

// ── Language toggle (EN | FR) ─────────────────────────────────
function initLangToggle() {
  function render() {
    const current = window.getLocale();
    const isEn = current === 'en';
    langToggle.innerHTML =
      '<button class="lang-btn' + (isEn ? ' active' : '') + '" data-lang="en" aria-label="English">EN</button>' +
      '<span class="lang-sep">|</span>' +
      '<button class="lang-btn' + (!isEn ? ' active' : '') + '" data-lang="fr" aria-label="Fran\u00e7ais">FR</button>';

    for (const btn of langToggle.querySelectorAll('.lang-btn')) {
      btn.addEventListener('click', () => {
        const lang = btn.getAttribute('data-lang');
        if (lang === window.getLocale()) return;
        window.setLocale(lang);
      });
    }
  }
  render();
  window.addEventListener('localechanged', render);
}

// ── Auto-format input ─────────────────────────────────────────
codeInput.addEventListener('input', () => {
  let raw = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z]{3}[0-9]+$/.test(raw)) {
    raw = raw.slice(0, 3) + '-' + raw.slice(3, 6);
  }
  codeInput.value = raw;
});

codeInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnBegin.click();
});

btnBegin.addEventListener('click', async () => {
  const code = codeInput.value.toUpperCase().trim();

  // Accept: ABC-123 (standard), AB12 (short), or any 3–20 uppercase alphanumeric (custom)
  if (!/^([A-Z]{3}-[0-9]{3}|[A-Z]{2}[0-9]{2}|[A-Z0-9]{3,20})$/.test(code)) {
    showError(t('popup.errors.invalidCode'));
    return;
  }

  setLoading(true);
  hideError();

  let session;
  try {
    const res = await fetch(`${API_BASE}/api/session?code=${encodeURIComponent(code)}`, { referrerPolicy: 'no-referrer' });
    session   = await res.json();

    if (res.status === 404) { showError(t('popup.errors.sessionError'));  setLoading(false); return; }
    if (res.status === 410) { showError(t('popup.errors.sessionError'));  setLoading(false); return; }
    if (!res.ok)            { showError(session.error || t('popup.errors.unknownError')); setLoading(false); return; }

  } catch {
    showError(t('popup.errors.networkError'));
    setLoading(false);
    return;
  }

  // Store session data so player.js can read it.
  await chrome.storage.session.set({
    sessionData: {
      assessmentType: session.assessmentType,
      title:          session.title,
      exitWordHash:   session.exitWordHash,
      code:           code,
      apiBase:        API_BASE,
      signedUrl:      session.signedUrl,
      filename:       session.filename,
      textContent:    session.textContent,
      textCharCount:  session.textCharCount,
      imageCount:     session.imageCount,
    },
  });

  // Prepare offscreen audio only for audio sessions
  if (session.assessmentType === 'audio') {
    await chrome.runtime.sendMessage({ type: 'prepare_session' });
  }

  // Open player in a chromeless popup window
  const win = await chrome.windows.create({
    url:   chrome.runtime.getURL('player.html'),
    type:  'popup',
    state: 'fullscreen',
  });
  chrome.runtime.sendMessage({ type: 'player_opened', windowId: win.id });
  window.close();
});

function setLoading(loading) {
  btnBegin.disabled    = loading;
  btnBegin.textContent = loading ? t('popup.loading') : t('popup.beginAssessment');
}

function showError(msg) {
  errorEl.textContent  = msg;
  errorEl.style.display = 'block';
}

function hideError() {
  errorEl.style.display = 'none';
}

// ── Init: wait for i18n, populate UI, listen for locale changes ──
window.i18nReady.then(() => {
  updateUI();
  initLangToggle();

  window.addEventListener('localechanged', () => {
    updateUI();
    hideError();
    if (!btnBegin.disabled) {
      btnBegin.textContent = t('popup.beginAssessment');
    }
  });
});
