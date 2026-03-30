// ─── Extension Popup ─────────────────────────────────────────────
// Validates the access code, calls the session API, then opens
// the lockdown player in a new tab.

const API_BASE = 'https://audioproctor.com';

const codeInput  = document.getElementById('code-input');
const btnBegin   = document.getElementById('btn-begin');
const errorEl    = document.getElementById('error-msg');

// Auto-format input: uppercase; insert hyphen after 3 chars only for standard format
// (first 3 chars all letters — ABC-123). Short (AB12) and custom codes get no hyphen.
codeInput.addEventListener('input', () => {
  let raw = codeInput.value.toUpperCase().replace(/[^A-Z0-9\s]/g, '').replace(/\s+/g, ' ');
  const lettersOnly = raw.replace(/[^A-Z]/g, '');
  const isStandard  = lettersOnly.length >= 3 && /^[A-Z]{3}/.test(raw) && raw.length > 3 && !raw.includes('-');
  if (isStandard) raw = raw.slice(0, 3) + '-' + raw.replace('-', '').slice(3, 6);
  codeInput.value = raw;
});

codeInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnBegin.click();
});

btnBegin.addEventListener('click', async () => {
  const code = codeInput.value.toUpperCase().trim();

  // Accept: ABC-123 (standard), AB12 (short), or any 3–20 uppercase alphanumeric (custom)
  if (!/^([A-Z]{3}-[0-9]{3}|[A-Z]{2}[0-9]{2}|[A-Z0-9]{3,20})$/.test(code)) {
    showError('Enter a valid code (e.g. ABC-123 or AB12).');
    return;
  }

  setLoading(true);
  hideError();

  let session;
  try {
    const res = await fetch(`${API_BASE}/api/session?code=${encodeURIComponent(code)}`);
    session   = await res.json();

    if (res.status === 404) { showError('Code not found — check with your teacher.');  setLoading(false); return; }
    if (res.status === 410) { showError('This assessment has expired.');               setLoading(false); return; }
    if (!res.ok)            { showError(session.error || 'Server error. Try again.'); setLoading(false); return; }

  } catch {
    showError('Could not reach the server. Check your connection.');
    setLoading(false);
    return;
  }

  // Store session data so player.js can read it
  await chrome.storage.session.set({
    sessionData: {
      signedUrl:    session.signedUrl,
      filename:     session.filename,
      exitWordHash: session.exitWordHash,
      code:         code,
    },
  });

  // Open the player in a new tab, then close the popup
  await chrome.tabs.create({ url: chrome.runtime.getURL('player.html') });
  window.close();
});

function setLoading(loading) {
  btnBegin.disabled    = loading;
  btnBegin.textContent = loading ? 'Loading…' : 'Begin Assessment';
}

function showError(msg) {
  errorEl.textContent  = msg;
  errorEl.style.display = 'block';
}

function hideError() {
  errorEl.style.display = 'none';
}
