'use strict';

let _recording = false;
let _inputTimer = null;
let _scrollTimer = null;
let _lastRightClickTime = 0;
let _lastScrollY = window.scrollY || 0;
let _initialized = false;

function init() {
  if (_initialized) return;
  _initialized = true;
  console.log('[TestTracer] content.js injecté sur', location.href);

  // ── Messages du background ─────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TT_START') {
      _recording = true;
      console.log('[TestTracer] ▶ Enregistrement démarré');
      showBadge();
    }
    if (msg.type === 'TT_STOP') {
      _recording = false;
      console.log('[TestTracer] ⏹ Enregistrement arrêté');
      removeBadge();
    }
  });

  // ── Clic gauche ────────────────────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    if (!_recording || e.button !== 0) return;
    flash(e.target, '#27ae60');
    sendEvent('click', `Clic sur "${desc(e.target)}"`, e.target);
  }, { capture: true, passive: true });

  // ── Clic droit — mousedown button=2 en capture (impossible à bloquer par la page) ──
  document.addEventListener('mousedown', (e) => {
    if (!_recording) return;
    const now = Date.now();

    if (e.button === 2) {
      // Garde anti-doublon avec contextmenu
      if (now - _lastRightClickTime < 250) return;
      _lastRightClickTime = now;
      flash(e.target, '#e74c3c');
      sendEvent('right-click', `Clic droit sur "${desc(e.target)}"`, e.target);
    } else if (e.button === 1) {
      flash(e.target, '#95a5a6');
      sendEvent('middle-click', `Clic molette sur "${desc(e.target)}"`, e.target);
    }
  }, { capture: true, passive: true });

  // Filet de sécurité contextmenu (si mousedown a raté)
  document.addEventListener('contextmenu', (e) => {
    if (!_recording) return;
    const now = Date.now();
    if (now - _lastRightClickTime < 250) return; // déjà capturé par mousedown
    _lastRightClickTime = now;
    flash(e.target, '#e74c3c');
    sendEvent('right-click', `Clic droit sur "${desc(e.target)}"`, e.target);
  }, { capture: true, passive: true });

  // ── Double-clic ────────────────────────────────────────────────────────────
  document.addEventListener('dblclick', (e) => {
    if (!_recording) return;
    flash(e.target, '#e67e22');
    sendEvent('double-click', `Double-clic sur "${desc(e.target)}"`, e.target);
  }, { capture: true, passive: true });

  // ── Saisie dans champs texte (debounce 800ms) ──────────────────────────────
  document.addEventListener('input', (e) => {
    if (!_recording) return;
    const el = e.target;
    if (!['INPUT', 'TEXTAREA'].includes(el.tagName)) return;
    if (['password', 'hidden'].includes(el.type)) return;
    clearTimeout(_inputTimer);
    _inputTimer = setTimeout(() => {
      const val = (el.value || '').slice(0, 80);
      sendEvent('input', `Saisie dans "${desc(el)}": "${val}"`, el);
    }, 800);
  }, { capture: true, passive: true });

  // ── Sélection / checkbox / radio ───────────────────────────────────────────
  document.addEventListener('change', (e) => {
    if (!_recording) return;
    const el = e.target;
    if (el.tagName === 'SELECT') {
      const selected = el.options[el.selectedIndex]?.text || el.value;
      sendEvent('select', `Sélection "${selected}" dans "${desc(el)}"`, el);
    } else if (el.type === 'checkbox') {
      sendEvent('checkbox', `${el.checked ? '☑ Coché' : '☐ Décoché'} "${desc(el)}"`, el);
    } else if (el.type === 'radio') {
      sendEvent('radio', `Radio sélectionné: "${desc(el)}"`, el);
    }
  }, { capture: true, passive: true });

  // ── Scroll significatif (throttle 500ms, seuil 200px) ─────────────────────
  window.addEventListener('scroll', () => {
    if (!_recording) return;
    clearTimeout(_scrollTimer);
    _scrollTimer = setTimeout(() => {
      const dy = window.scrollY - _lastScrollY;
      if (Math.abs(dy) < 200) return;
      const dir = dy > 0 ? '↓ bas' : '↑ haut';
      sendEvent('scroll', `Défilement ${dir} de ${Math.abs(Math.round(dy))}px`, document.body);
      _lastScrollY = window.scrollY;
    }, 500);
  }, { capture: true, passive: true });

  // ── Navigation / changement d'URL ──────────────────────────────────────────
  let _lastUrl = location.href;

  function onUrlChange() {
    if (location.href !== _lastUrl) {
      if (_recording) {
        sendEvent('navigation', `Navigation vers "${location.href}"`, document.body);
      }
      _lastUrl = location.href;
    }
  }

  // Monkey-patch history API
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = (...a) => { origPush(...a); onUrlChange(); };
  history.replaceState = (...a) => { origReplace(...a); onUrlChange(); };
  window.addEventListener('popstate', onUrlChange);

  // MutationObserver pour SPA qui ne passent pas par history
  new MutationObserver(onUrlChange).observe(
    document.documentElement,
    { subtree: true, childList: true }
  );

  console.log('[TestTracer] ✅ Prêt — en attente de TT_START');
}

// ─── Envoyer un événement au background ──────────────────────────────────────
function sendEvent(eventType, description, el) {
  console.log(`[TestTracer] → ${eventType}: ${description}`);
  chrome.runtime.sendMessage({
    type: 'TT_EVENT',
    eventType,
    description,
    url: location.href,
    selector: getSelector(el),
    timestamp: new Date().toISOString()
  }).catch(() => {}); // ignore si le background n'est pas prêt
}

// ─── Description lisible d'un élément ────────────────────────────────────────
function desc(el) {
  if (!el || el === document.body || el === document.documentElement) return 'page';
  const s =
    el.getAttribute?.('aria-label') ||
    el.getAttribute?.('title') ||
    el.getAttribute?.('placeholder') ||
    el.getAttribute?.('alt') ||
    (el.innerText || el.textContent || '').trim().slice(0, 60) ||
    el.getAttribute?.('name') ||
    el.getAttribute?.('id') ||
    el.tagName?.toLowerCase() ||
    'élément';
  return s.replace(/\s+/g, ' ').trim().slice(0, 60);
}

// ─── Sélecteur CSS court ──────────────────────────────────────────────────────
function getSelector(el) {
  if (!el || el === document.body) return 'body';
  try {
    if (el.id) return '#' + el.id;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 3) {
      let part = node.tagName.toLowerCase();
      const cls = [...(node.classList || [])].slice(0, 2).join('.');
      if (cls) part += '.' + cls;
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  } catch (e) {
    return el.tagName?.toLowerCase() || 'unknown';
  }
}

// ─── Flash visuel sur l'élément ciblé ────────────────────────────────────────
function flash(el, color) {
  if (!el || el === document.body || el === document.documentElement) return;
  try {
    const prev = { outline: el.style.outline, opacity: el.style.opacity };
    el.style.outline = `3px solid ${color}`;
    el.style.opacity = '0.75';
    setTimeout(() => {
      el.style.outline = prev.outline;
      el.style.opacity = prev.opacity;
    }, 400);
  } catch (_) {}
}

// ─── Badge REC flottant ───────────────────────────────────────────────────────
function showBadge() {
  if (document.getElementById('tt-rec-badge')) return;
  const d = document.createElement('div');
  d.id = 'tt-rec-badge';
  d.textContent = '⏺ REC';
  Object.assign(d.style, {
    position: 'fixed', top: '8px', right: '8px', zIndex: '2147483647',
    background: 'rgba(231,76,60,0.9)', color: '#fff', padding: '4px 10px',
    borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace',
    fontWeight: 'bold', pointerEvents: 'none', boxShadow: '0 2px 6px rgba(0,0,0,.4)',
    animation: 'tt-pulse 1.2s infinite'
  });
  const style = document.createElement('style');
  style.textContent = '@keyframes tt-pulse{0%,100%{opacity:1}50%{opacity:.4}}';
  document.head?.appendChild(style);
  document.body?.appendChild(d);
}

function removeBadge() {
  document.getElementById('tt-rec-badge')?.remove();
}

// ─── Démarrage ────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
