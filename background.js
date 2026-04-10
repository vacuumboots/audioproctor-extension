// ─── Background Service Worker ───────────────────────────────────
// Tracks the player window and refocuses it when the student
// Alt+Tabs or otherwise switches away during an assessment.

let playerWindowId = null;

// Restore state if the service worker was restarted by Chrome
chrome.storage.session.get('playerWindowId', (data) => {
  playerWindowId = data.playerWindowId || null;
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'player_opened') {
    playerWindowId = msg.windowId;
    chrome.storage.session.set({ playerWindowId: msg.windowId });
  }
  if (msg.type === 'player_closing') {
    playerWindowId = null;
    chrome.storage.session.remove('playerWindowId');
  }
});

// When focus leaves the player window (Alt+Tab, clicking another window, etc.)
// immediately reclaim it.
chrome.windows.onFocusChanged.addListener(windowId => {
  if (playerWindowId === null) return;
  if (windowId !== playerWindowId) {
    chrome.windows.update(playerWindowId, { focused: true, state: 'fullscreen' });
  }
});

// Clean up when the player window is closed
chrome.windows.onRemoved.addListener(windowId => {
  if (windowId === playerWindowId) {
    playerWindowId = null;
    chrome.storage.session.remove('playerWindowId');
  }
});
