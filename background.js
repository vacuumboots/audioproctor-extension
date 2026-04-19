// ─── Background Service Worker ───────────────────────────────────
// Tracks the player window, enforces fullscreen focus, and manages
// the offscreen audio document.

let playerWindowId  = null;
let playerAllowClose = false;

chrome.storage.session.get('playerWindowId', (data) => {
  playerWindowId = data.playerWindowId || null;
});

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen.html')],
  });
  if (existing.length === 0) {
    await chrome.offscreen.createDocument({
      url:           chrome.runtime.getURL('offscreen.html'),
      reasons:       ['AUDIO_PLAYBACK'],
      justification: 'Playing audio assessment for students',
    });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'prepare_session') {
    // Popup calls this and awaits the response before creating the player window,
    // guaranteeing the offscreen document exists when player.js sends 'load'.
    ensureOffscreen().catch(() => {}).then(() => sendResponse());
    return true; // keep channel open for async response
  }
  if (msg.type === 'player_opened') {
    playerWindowId   = msg.windowId;
    playerAllowClose = false;
    chrome.storage.session.set({ playerWindowId: msg.windowId });
  }
  if (msg.type === 'player_closing') {
    playerAllowClose = true;
    // onRemoved handles the actual cleanup
  }
});

chrome.windows.onFocusChanged.addListener(windowId => {
  if (playerWindowId === null) return;
  if (windowId !== playerWindowId) {
    chrome.windows.update(playerWindowId, { focused: true, state: 'fullscreen' });
  }
});

chrome.windows.onRemoved.addListener(windowId => {
  if (windowId !== playerWindowId) return;

  if (playerAllowClose) {
    // Legitimate exit via exit word — clean up everything
    playerWindowId   = null;
    playerAllowClose = false;
    chrome.storage.session.remove('playerWindowId');
    chrome.offscreen.closeDocument().catch(() => {});
  } else {
    // Unauthorized close (e.g. Chrome OS system close button) — reopen
    // Null out immediately so onFocusChanged doesn't try to update the removed window
    // while we're creating the replacement.
    playerWindowId = null;
    chrome.storage.session.get('sessionData', async ({ sessionData }) => {
      if (sessionData && sessionData.signedUrl) {
        await ensureOffscreen(); // must exist before player.js sends 'load'
        chrome.windows.create(
          { url: chrome.runtime.getURL('player.html'), type: 'popup', state: 'fullscreen' },
          (win) => {
            playerWindowId = win.id;
            chrome.storage.session.set({ playerWindowId: win.id });
          }
        );
      } else {
        chrome.storage.session.remove('playerWindowId');
        chrome.offscreen.closeDocument().catch(() => {});
      }
    });
  }
});
