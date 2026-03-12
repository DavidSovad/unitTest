'use strict';

const btnStart    = document.getElementById('btn-start');
const btnStop     = document.getElementById('btn-stop');
const dot         = document.getElementById('dot');
const statusText  = document.getElementById('status-text');
const eventCount  = document.getElementById('event-count');
const sessionInput = document.getElementById('session-name');
const msgEl       = document.getElementById('msg');

let pollTimer = null;

// ─── UI helpers ───────────────────────────────────────────────────────────────
function setUI(recording, count) {
  if (recording) {
    dot.classList.add('recording');
    statusText.textContent = 'Enregistrement en cours…';
    btnStart.disabled = true;
    btnStop.disabled = false;
    sessionInput.disabled = true;
    eventCount.textContent = count != null ? `${count} action(s)` : '';
  } else {
    dot.classList.remove('recording');
    statusText.textContent = 'En attente';
    btnStart.disabled = false;
    btnStop.disabled = true;
    sessionInput.disabled = false;
    eventCount.textContent = '';
  }
}

function showMsg(text, type /* 'ok'|'error'|'' */) {
  msgEl.textContent = text;
  msgEl.className = 'msg' + (type ? ' ' + type : '');
  if (text) setTimeout(() => { msgEl.textContent = ''; msgEl.className = 'msg'; }, 4000);
}

// ─── Sondage du background pour rafraîchir le compteur ───────────────────────
function startPoll() {
  pollTimer = setInterval(() => {
    chrome.runtime.sendMessage({ type: 'TT_STATUS' }, (resp) => {
      if (chrome.runtime.lastError || !resp) return;
      if (resp.recording) {
        eventCount.textContent = `${resp.count || 0} action(s)`;
      }
    });
  }, 1500);
}

// ─── Init : récupérer l'état en cours ────────────────────────────────────────
chrome.runtime.sendMessage({ type: 'TT_STATUS' }, (resp) => {
  if (chrome.runtime.lastError) { setUI(false); return; }
  setUI(resp?.recording || false, resp?.count);
  if (resp?.recording) startPoll();
});

// ─── Démarrer ─────────────────────────────────────────────────────────────────
btnStart.addEventListener('click', () => {
  const sessionName =
    sessionInput.value.trim() ||
    'Session ' + new Date().toLocaleString('fr-FR');

  btnStart.disabled = true;
  showMsg('Démarrage…');

  chrome.runtime.sendMessage({ type: 'TT_START', sessionName }, (resp) => {
    if (chrome.runtime.lastError || !resp?.ok) {
      showMsg(chrome.runtime.lastError?.message || 'Échec du démarrage', 'error');
      btnStart.disabled = false;
      return;
    }
    setUI(true, 0);
    showMsg('Enregistrement démarré !', 'ok');
    startPoll();
    // Fermer le popup après un court délai
    setTimeout(() => window.close(), 1200);
  });
});

// ─── Arrêter ──────────────────────────────────────────────────────────────────
btnStop.addEventListener('click', () => {
  btnStop.disabled = true;
  clearInterval(pollTimer);
  showMsg('Arrêt en cours…');

  chrome.runtime.sendMessage({ type: 'TT_STOP' }, (resp) => {
    if (chrome.runtime.lastError || !resp?.ok) {
      showMsg(chrome.runtime.lastError?.message || 'Échec de l\'arrêt', 'error');
      btnStop.disabled = false;
      return;
    }
    showMsg(`Session terminée — ${resp.count} action(s)`, 'ok');
    setUI(false);
    setTimeout(() => window.close(), 1500);
  });
});
