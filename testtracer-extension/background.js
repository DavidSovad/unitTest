'use strict';

// ─── Session state ────────────────────────────────────────────────────────────
const state = {
  recording: false,
  sessionName: '',
  events: [],
  counter: 0,
  activeTabId: null,
  activeWindowId: null
};

// ─── Message router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'TT_START':
      handleStart(msg, sendResponse);
      return true;

    case 'TT_STOP':
      handleStop(sendResponse);
      return true;

    case 'TT_EVENT':
      if (state.recording) handleEvent(msg, sender);
      break;

    case 'TT_STATUS':
      sendResponse({ recording: state.recording, count: state.events.length });
      break;
  }
});

// ─── Start recording ──────────────────────────────────────────────────────────
async function handleStart(msg, sendResponse) {
  state.recording = true;
  state.sessionName = msg.sessionName || 'Session ' + new Date().toLocaleString('fr-FR');
  state.events = [];
  state.counter = 0;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    sendResponse({ ok: false, error: 'Aucun onglet actif trouvé' });
    return;
  }
  state.activeTabId = tab.id;
  state.activeWindowId = tab.windowId;

  // Badge rouge REC
  chrome.action.setBadgeText({ text: 'REC', tabId: tab.id });
  chrome.action.setBadgeBackgroundColor({ color: '#e74c3c', tabId: tab.id });

  // Injecter dans toutes les frames (y compris iframes ServiceNow)
  await broadcastToAllFrames(tab.id, { type: 'TT_START' });

  sendResponse({ ok: true });
}

// ─── Stop recording ───────────────────────────────────────────────────────────
async function handleStop(sendResponse) {
  state.recording = false;

  if (state.activeTabId) {
    chrome.action.setBadgeText({ text: '', tabId: state.activeTabId });
    await broadcastToAllFrames(state.activeTabId, { type: 'TT_STOP' });
  }

  // Sauvegarde dans le storage
  await chrome.storage.local.set({
    tt_events: state.events,
    tt_session_name: state.sessionName,
    tt_stopped_at: new Date().toISOString(),
    tt_count: state.counter
  });

  // Ouvrir l'onglet de récapitulatif
  await chrome.tabs.create({ url: chrome.runtime.getURL('recap.html') });

  sendResponse({ ok: true, count: state.events.length });
}

// ─── Enregistrer un événement + capture d'écran ───────────────────────────────
function handleEvent(msg, sender) {
  const windowId = sender.tab?.windowId;
  if (!windowId) return;

  // Capture de l'onglet visible (JPEG pour économiser l'espace)
  chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 65 }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      console.warn('[TestTracer BG] Screenshot:', chrome.runtime.lastError.message);
    }
    state.counter++;
    state.events.push({
      id: state.counter,
      eventType: msg.eventType,
      description: msg.description,
      url: msg.url,
      selector: msg.selector || '',
      timestamp: msg.timestamp || new Date().toISOString(),
      screenshot: dataUrl || null
    });
    console.log(`[TestTracer BG] #${state.counter} [${msg.eventType}] ${msg.description}`);
  });
}

// ─── Broadcast vers toutes les frames ────────────────────────────────────────
async function broadcastToAllFrames(tabId, message) {
  let frames;
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId });
  } catch (e) {
    chrome.tabs.sendMessage(tabId, message).catch(() => {});
    return;
  }
  for (const frame of frames) {
    chrome.tabs.sendMessage(tabId, message, { frameId: frame.frameId }).catch(() => {});
  }
}
