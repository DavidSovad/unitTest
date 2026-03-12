'use strict';

// ─── État global ───────────────────────────────────────────────────────────────
let _events      = [];
let _sessionName = '';
let _stoppedAt   = '';

// ─── Types d'action → libellé + classe CSS ────────────────────────────────────
const TYPE_META = {
  'click':        { label: 'Clic',        cls: 'badge-click'        },
  'right-click':  { label: 'Clic droit',  cls: 'badge-right-click'  },
  'double-click': { label: 'Double-clic', cls: 'badge-double-click' },
  'middle-click': { label: 'Clic molette',cls: 'badge-middle-click' },
  'input':        { label: 'Saisie',      cls: 'badge-input'        },
  'select':       { label: 'Sélection',   cls: 'badge-select'       },
  'checkbox':     { label: 'Checkbox',    cls: 'badge-checkbox'     },
  'radio':        { label: 'Radio',       cls: 'badge-radio'        },
  'scroll':       { label: 'Défilement',  cls: 'badge-scroll'       },
  'navigation':   { label: 'Navigation',  cls: 'badge-navigation'   }
};

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const data = await chrome.storage.local.get([
    'tt_events', 'tt_session_name', 'tt_stopped_at'
  ]);

  _events      = data.tt_events      || [];
  _sessionName = data.tt_session_name || 'Session';
  _stoppedAt   = data.tt_stopped_at  || new Date().toISOString();

  // En-tête
  document.getElementById('session-title').textContent = _sessionName;
  const metaText = `${_events.length} action(s) — ${new Date(_stoppedAt).toLocaleString('fr-FR')}`;
  document.getElementById('session-meta').textContent  = metaText;
  document.getElementById('session-meta-toolbar').textContent = metaText;
  document.title = `TestTracer — ${_sessionName}`;

  if (_events.length === 0) {
    document.getElementById('empty-state').style.display = '';
  } else {
    renderTimeline();
  }

  // Boutons export
  document.getElementById('btn-zip').addEventListener('click',   doExportZip);
  document.getElementById('btn-docx').addEventListener('click',  doExportDocx);
  document.getElementById('btn-html').addEventListener('click',  doExportHtml);
  document.getElementById('btn-md').addEventListener('click',    doExportMarkdown);
  document.getElementById('btn-print').addEventListener('click', () => window.print());

  // Lightbox fermeture
  document.getElementById('lightbox').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-img').addEventListener('click', closeLightbox);
});

// ─── Rendu de la timeline ────────────────────────────────────────────────────
function renderTimeline() {
  const container = document.getElementById('timeline');

  _events.forEach((ev, idx) => {
    const meta    = TYPE_META[ev.eventType] || { label: ev.eventType, cls: 'badge-default' };
    const isLast  = idx === _events.length - 1;
    const time    = new Date(ev.timestamp).toLocaleTimeString('fr-FR');

    const card = document.createElement('div');
    card.className = 'step-card';
    card.innerHTML = `
      <div class="step-num-col">
        <div class="step-num">${ev.id}</div>
        ${!isLast ? '<div class="step-line"></div>' : ''}
      </div>
      <div class="step-content">
        <div class="step-header">
          <span class="badge ${meta.cls}">${meta.label}</span>
          <span class="step-time">${time}</span>
        </div>
        <div class="step-body">
          <div class="step-desc">${esc(ev.description)}</div>
          ${ev.url ? `<div class="step-url">🔗 ${esc(ev.url)}</div>` : ''}
          ${ev.selector ? `<span class="step-selector">${esc(ev.selector)}</span>` : ''}
        </div>
        ${ev.screenshot
          ? `<div class="step-screenshot" data-src="${ev.screenshot}">
               <img src="${ev.screenshot}" alt="Capture étape ${ev.id}" loading="lazy">
             </div>`
          : `<div class="no-screenshot">Pas de capture disponible</div>`
        }
      </div>`;

    container.appendChild(card);

    // Lightbox au clic sur la capture
    if (ev.screenshot) {
      card.querySelector('.step-screenshot').addEventListener('click', () => {
        openLightbox(ev.screenshot);
      });
    }
  });
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────
function openLightbox(src) {
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('lightbox-img').src = '';
}

// ─── Logo Yunit (image13.png) ─────────────────────────────────────────────────
async function fetchLogo() {
  try {
    const url  = chrome.runtime.getURL('image13.png');
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf  = await resp.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}
// ─── Export ZIP (DOCX + HTML + Markdown + screenshots) ───────────────────────
async function doExportZip() {
  const zip      = new ZipBuilder();
  const dateStr  = dateSlug();

  // DOCX avec template Yunit
  const logoBytes = await fetchLogo();
  const docxBytes = buildDocx(_events, _sessionName, logoBytes);
  zip.addFile('rapport.docx', docxBytes);

  // HTML autonome
  zip.addFile('rapport.html', buildHtmlReport(_events, _sessionName));

  // Markdown
  zip.addFile('rapport.md', buildMarkdown(_events, _sessionName));

  // data.json
  zip.addFile('data.json', JSON.stringify({
    sessionName: _sessionName,
    stoppedAt: _stoppedAt,
    count: _events.length,
    events: _events.map(e => ({ ...e, screenshot: e.screenshot ? '[base64]' : null }))
  }, null, 2));

  // Screenshots séparés
  _events.forEach(ev => {
    if (!ev.screenshot) return;
    const ext = ev.screenshot.startsWith('data:image/png') ? 'png' : 'jpeg';
    zip.addBase64(`screenshots/step-${ev.id}.${ext}`, ev.screenshot);
  });

  zip.download(`testtracer-${dateStr}.zip`);
}

// ─── Export Word (.docx) ──────────────────────────────────────────────────────
async function doExportDocx() {
  const logoBytes = await fetchLogo();
  const bytes     = buildDocx(_events, _sessionName, logoBytes);
  downloadBlob(bytes, `testtracer-${dateSlug()}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

// ─── Export HTML autonome ─────────────────────────────────────────────────────
function doExportHtml() {
  const html = buildHtmlReport(_events, _sessionName);
  downloadBlob(
    new TextEncoder().encode(html),
    `testtracer-${dateSlug()}.html`,
    'text/html'
  );
}

// ─── Export Markdown ──────────────────────────────────────────────────────────
function doExportMarkdown() {
  const md = buildMarkdown(_events, _sessionName);
  downloadBlob(
    new TextEncoder().encode(md),
    `testtracer-${dateSlug()}.md`,
    'text/markdown'
  );
}

// ─── Constructeur rapport HTML autonome ──────────────────────────────────────
function buildHtmlReport(events, sessionName) {
  const date  = new Date(_stoppedAt).toLocaleString('fr-FR');
  const steps = events.map(ev => {
    const meta = TYPE_META[ev.eventType] || { label: ev.eventType };
    const time = new Date(ev.timestamp).toLocaleTimeString('fr-FR');
    const colors = {
      'click':'#22c55e','right-click':'#ef4444','double-click':'#f97316',
      'middle-click':'#94a3b8','input':'#3b82f6','select':'#a855f7',
      'checkbox':'#ec4899','radio':'#ec4899','scroll':'#eab308','navigation':'#06b6d4'
    };
    const color = colors[ev.eventType] || '#94a3b8';
    return `
    <div style="border:1px solid #334155;border-radius:8px;overflow:hidden;margin-bottom:20px;background:#1e293b">
      <div style="padding:8px 14px;background:#0f172a;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-weight:700;font-size:15px;color:#e2e8f0">Étape ${ev.id}</span>
        <span style="background:${color};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase">${meta.label}</span>
        <span style="margin-left:auto;font-size:11px;color:#94a3b8">${time}</span>
      </div>
      <div style="padding:10px 14px">
        <div style="margin-bottom:6px">${escHtml(ev.description)}</div>
        ${ev.url ? `<div style="font-size:11px;color:#94a3b8;word-break:break-all">🔗 ${escHtml(ev.url)}</div>` : ''}
        ${ev.selector ? `<code style="font-size:10px;color:#94a3b8;background:#0f172a;padding:2px 5px;border-radius:3px">${escHtml(ev.selector)}</code>` : ''}
      </div>
      ${ev.screenshot
        ? `<img src="${ev.screenshot}" alt="Capture étape ${ev.id}" style="width:100%;display:block;border-top:1px solid #334155">`
        : `<div style="padding:6px 14px;font-size:11px;color:#64748b;border-top:1px solid #334155;font-style:italic">Pas de capture</div>`
      }
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TestTracer — ${escHtml(sessionName)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f172a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;padding:32px 24px}
  h1{font-size:22px;margin-bottom:6px}
  .meta{color:#94a3b8;font-size:13px;margin-bottom:32px}
</style>
</head>
<body>
  <h1>🎬 ${escHtml(sessionName)}</h1>
  <p class="meta">Rapport généré le ${date} — ${events.length} action(s)</p>
  ${steps}
</body>
</html>`;
}

// ─── Constructeur Markdown ────────────────────────────────────────────────────
function buildMarkdown(events, sessionName) {
  const date  = new Date(_stoppedAt).toLocaleString('fr-FR');
  let md = `# ${sessionName}\n\n`;
  md += `> Rapport généré le ${date} — ${events.length} action(s)\n\n---\n\n`;

  events.forEach(ev => {
    const meta = TYPE_META[ev.eventType] || { label: ev.eventType };
    const time = new Date(ev.timestamp).toLocaleTimeString('fr-FR');
    md += `## Étape ${ev.id} — ${meta.label}\n\n`;
    md += `- **Heure :** ${time}\n`;
    md += `- **Action :** ${ev.description}\n`;
    if (ev.url)      md += `- **URL :** ${ev.url}\n`;
    if (ev.selector) md += `- **Sélecteur :** \`${ev.selector}\`\n`;
    md += '\n';
    if (ev.screenshot) {
      md += `![Capture étape ${ev.id}](screenshots/step-${ev.id}.jpeg)\n\n`;
    }
    md += '---\n\n';
  });

  return md;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escHtml(s) { return esc(s); }

function dateSlug() {
  return new Date().toISOString().slice(0, 10);
}

function downloadBlob(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
