// ─── Background Service Worker ───────────────────────────────────
// Tracks the player window, enforces fullscreen focus, and manages
// the offscreen audio document.

let playerWindowId = null;

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

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'player_opened') {
    playerWindowId = msg.windowId;
    chrome.storage.session.set({ playerWindowId: msg.windowId });
    ensureOffscreen();
  }
  if (msg.type === 'player_closing') {
    playerWindowId = null;
    chrome.storage.session.remove('playerWindowId');
    chrome.offscreen.closeDocument().catch(() => {});
  }
});

chrome.windows.onFocusChanged.addListener(windowId => {
  if (playerWindowId === null) return;
  if (windowId !== playerWindowId) {
    chrome.windows.update(playerWindowId, { focused: true, state: 'fullscreen' });
  }
});

chrome.windows.onRemoved.addListener(windowId => {
  if (windowId === playerWindowId) {
    playerWindowId = null;
    chrome.storage.session.remove('playerWindowId');
    chrome.offscreen.closeDocument().catch(() => {});
  }
});
