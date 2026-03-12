'use strict';

// ─── État léger en mémoire ────────────────────────────────────────────────────
// NOTE : le service worker MV3 PEUT être suspendu à tout moment.
// Tout ce qui est critique (events, recording) est stocké dans chrome.storage.local.
const state = {
  activeTabId:    null,
  activeWindowId: null
};

// ─── Message router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    // ── Démarrer l'enregistrement ─────────────────────────────────────────────
    case 'TT_START': {
      const sessionName = msg.sessionName || 'Session ' + new Date().toLocaleString('fr-FR');

      // Persister dans le storage AVANT de broadcaster (les iframes liront ce flag)
      chrome.storage.local.set({
        tt_recording:     true,
        tt_session_name:  sessionName,
        tt_events:        [],
        tt_event_counter: 0
      });

      // Répondre IMMÉDIATEMENT (obligatoire en MV3 pour éviter "port closed")
      sendResponse({ ok: true });

      // Travail async APRÈS réponse
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab) return;
        state.activeTabId    = tab.id;
        state.activeWindowId = tab.windowId;
        chrome.action.setBadgeText({ text: 'REC', tabId: tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#e74c3c', tabId: tab.id });
        // Broadcaster TT_START dans TOUTES les frames (iframes ServiceNow incluses)
        broadcastToAllFrames(tab.id, { type: 'TT_START' });
      });
      break;
    }

    // ── Arrêter l'enregistrement ──────────────────────────────────────────────
    case 'TT_STOP': {
      // Répondre IMMÉDIATEMENT
      sendResponse({ ok: true });

      if (state.activeTabId) {
        chrome.action.setBadgeText({ text: '', tabId: state.activeTabId });
        broadcastToAllFrames(state.activeTabId, { type: 'TT_STOP' });
      }

      // Lire les événements depuis le storage (résistant aux redémarrages SW)
      chrome.storage.local.get(['tt_events', 'tt_session_name'], (data) => {
        const events = data.tt_events || [];
        chrome.storage.local.set({
          tt_recording:   false,
          tt_stopped_at:  new Date().toISOString(),
          tt_count:       events.length,
          tt_session_name: data.tt_session_name || 'Session'
        }, () => {
          chrome.tabs.create({ url: chrome.runtime.getURL('recap.html') });
        });
      });
      break;
    }

    // ── Événement reçu depuis une page/iframe ─────────────────────────────────
    // On NE vérifie PAS state.recording ici — le SW peut avoir redémarré
    // et perdu cette valeur. Le content script ne send TT_EVENT que si
    // _recording est true côté page, donc c'est fiable.
    case 'TT_EVENT':
      handleEvent(msg, sender);
      break;

    // ── Statut (lu par le popup pour le compteur) ─────────────────────────────
    case 'TT_STATUS':
      chrome.storage.local.get(['tt_recording', 'tt_event_counter'], (data) => {
        sendResponse({
          recording: data.tt_recording  || false,
          count:     data.tt_event_counter || 0
        });
      });
      return true; // réponse asynchrone
  }
});

// ─── Enregistrement d'un événement + capture d'écran ─────────────────────────
function handleEvent(msg, sender) {
  const windowId = sender.tab?.windowId;
  if (!windowId) return;

  // Capturer l'onglet visible JPEG (plus léger que PNG)
  chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 65 }, (screenshot) => {
    if (chrome.runtime.lastError) {
      console.warn('[TestTracer BG] Screenshot:', chrome.runtime.lastError.message);
    }

    // Append dans le storage (pattern read-modify-write, résistant aux redémarrages SW)
    chrome.storage.local.get(['tt_events', 'tt_event_counter'], (data) => {
      if (chrome.runtime.lastError) return;

      const events  = data.tt_events        || [];
      const counter = (data.tt_event_counter || 0) + 1;

      events.push({
        id:          counter,
        eventType:   msg.eventType,
        description: msg.description  || '',
        url:         msg.url          || '',
        selector:    msg.selector     || '',
        timestamp:   msg.timestamp    || new Date().toISOString(),
        screenshot:  screenshot       || null
      });

      chrome.storage.local.set({ tt_events: events, tt_event_counter: counter }, () => {
        if (chrome.runtime.lastError) {
          console.error('[TestTracer BG] Storage error:', chrome.runtime.lastError.message);
        } else {
          console.log(`[TestTracer BG] #${counter} [${msg.eventType}] ${msg.description}`);
        }
      });
    });
  });
}

// ─── Broadcast dans toutes les frames d'un onglet ────────────────────────────
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
