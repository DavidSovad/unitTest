'use strict';

// ─── État global ───────────────────────────────────────────────────────────────
let _events      = [];
let _sessionName = '';
let _stoppedAt   = '';
let _lang        = 'fr';
let _stepNums    = []; // _stepNums[idx] = numéro d'étape saisi par l'utilisateur (string)
let _pickedShot  = {}; // stepNum (string) → eventIdx dont la capture est retenue pour l'export

// ─── Internationalisation ─────────────────────────────────────────────────────
const I18N = {
  fr: {
    types: {
      'click':'Clic','right-click':'Clic droit','double-click':'Double-clic',
      'middle-click':'Clic molette','input':'Saisie','select':'Sélection',
      'checkbox':'Checkbox','radio':'Radio','scroll':'Défilement','navigation':'Navigation'
    },
    step: 'Étape', generatedOn: 'Rapport généré le', actions: 'action(s)',
    noCapture: 'Pas de capture', noCaptureAvail: 'Pas de capture disponible',
    time: 'Heure', action: 'Action', selector: 'Sélecteur',
    xlsxHeaders: ["N°","Type","Description","URL","Sélecteur","Heure","Capture d'écran"],
    screenshotAlt: 'Capture étape', sessionPrefix: 'Session',
    useCaptureLabel: "Utiliser cette capture pour l'export"
  },
  en: {
    types: {
      'click':'Click','right-click':'Right click','double-click':'Double click',
      'middle-click':'Middle click','input':'Input','select':'Select',
      'checkbox':'Checkbox','radio':'Radio','scroll':'Scroll','navigation':'Navigation'
    },
    step: 'Step', generatedOn: 'Report generated on', actions: 'action(s)',
    noCapture: 'No screenshot', noCaptureAvail: 'No screenshot available',
    time: 'Time', action: 'Action', selector: 'Selector',
    xlsxHeaders: ['#','Type','Description','URL','Selector','Time','Screenshot'],
    screenshotAlt: 'Screenshot step', sessionPrefix: 'Session',
    useCaptureLabel: 'Use this screenshot for export'
  }
};

function t(key)       { return I18N[_lang][key]; }
function locale()     { return _lang === 'fr' ? 'fr-FR' : 'en-US'; }
function typeLabel(type) { return I18N[_lang].types[type] || type; }

// ─── Types d'action → classe CSS ─────────────────────────────────────────────
const TYPE_META = {
  'click':        { cls: 'badge-click'        },
  'right-click':  { cls: 'badge-right-click'  },
  'double-click': { cls: 'badge-double-click' },
  'middle-click': { cls: 'badge-middle-click' },
  'input':        { cls: 'badge-input'        },
  'select':       { cls: 'badge-select'       },
  'checkbox':     { cls: 'badge-checkbox'     },
  'radio':        { cls: 'badge-radio'        },
  'scroll':       { cls: 'badge-scroll'       },
  'navigation':   { cls: 'badge-navigation'   }
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

  _stepNums = _events.map(ev => String(ev.id));

  if (_events.length === 0) {
    document.getElementById('empty-state').style.display = '';
  } else {
    renderTimeline();
    rebuildStepNav();
    recomputeDuplicates();
  }

  // Boutons export
  document.getElementById('btn-zip').addEventListener('click',   doExportZip);
  document.getElementById('btn-docx').addEventListener('click',  doExportDocx);
  document.getElementById('btn-html').addEventListener('click',  doExportHtml);
  document.getElementById('btn-md').addEventListener('click',    doExportMarkdown);
  document.getElementById('btn-excel').addEventListener('click', doExportExcel);
  document.getElementById('btn-print').addEventListener('click', () => window.print());

  // Lightbox fermeture
  document.getElementById('lightbox').addEventListener('click', closeLightbox);
  document.getElementById('lightbox-img').addEventListener('click', closeLightbox);

  // Sélection de langue
  document.getElementById('btn-lang-fr').addEventListener('click', () => setLang('fr'));
  document.getElementById('btn-lang-en').addEventListener('click', () => setLang('en'));
});

// ─── Rendu de la timeline ────────────────────────────────────────────────────
function renderTimeline() {
  const container = document.getElementById('timeline');

  _events.forEach((ev, idx) => {
    const meta   = TYPE_META[ev.eventType] || { cls: 'badge-default' };
    const isLast = idx === _events.length - 1;
    const time   = new Date(ev.timestamp).toLocaleTimeString(locale());

    const card = document.createElement('div');
    card.className = 'step-card';
    card.id = `step-card-${idx}`;
    card.innerHTML = `
      <div class="step-num-col">
        <input type="number" class="step-input" value="${_stepNums[idx]}" min="0" data-idx="${idx}">
        ${!isLast ? '<div class="step-line"></div>' : ''}
      </div>
      <div class="step-content">
        <div class="step-header">
          <span class="badge ${meta.cls}">${typeLabel(ev.eventType)}</span>
          <span class="step-time">${time}</span>
        </div>
        <div class="step-body">
          <div class="step-desc">${esc(ev.description)}</div>
          ${ev.url ? `<div class="step-url">🔗 ${esc(ev.url)}</div>` : ''}
          ${ev.selector ? `<span class="step-selector">${esc(ev.selector)}</span>` : ''}
        </div>
        ${ev.screenshot
          ? `<div class="step-screenshot" data-src="${ev.screenshot}">
               <img src="${ev.screenshot}" alt="${t('screenshotAlt')} ${ev.id}" loading="lazy">
             </div>
             <div class="screenshot-pick" id="pick-${idx}">
               <label><input type="radio" name="" value="${idx}"> ${t('useCaptureLabel')}</label>
             </div>`
          : `<div class="no-screenshot">${t('noCaptureAvail')}</div>`
        }
      </div>`;

    container.appendChild(card);

    // Lightbox au clic sur la capture
    if (ev.screenshot) {
      card.querySelector('.step-screenshot').addEventListener('click', () => {
        openLightbox(ev.screenshot);
      });
      // Sélection de la capture pour l'export (radio)
      card.querySelector('.screenshot-pick input[type="radio"]').addEventListener('change', function () {
        if (this.checked) _pickedShot[_stepNums[idx]] = idx;
      });
    }

    // Édition du numéro d'étape
    card.querySelector('.step-input').addEventListener('change', function () {
      const val = this.value.trim();
      if (val === '' || isNaN(val) || Number(val) < 0) { this.value = _stepNums[idx]; return; }
      _stepNums[idx] = val;
      rebuildStepNav();
      recomputeDuplicates();
    });
  });
}

// ─── Sidebar de navigation ────────────────────────────────────────────────────
function rebuildStepNav() {
  const nav = document.getElementById('step-nav');
  nav.innerHTML = '';
  // Compte les occurrences de chaque numéro
  const count = {};
  _events.forEach((ev, idx) => { const sn = _stepNums[idx]; count[sn] = (count[sn] || 0) + 1; });

  _events.forEach((ev, idx) => {
    const sn  = _stepNums[idx];
    const excl = sn === '0';
    const a   = document.createElement('a');
    a.href      = excl ? '#' : `#step-card-${idx}`;
    a.className = 'nav-num' + (excl ? ' excluded' : count[sn] > 1 ? ' dup' : '');
    a.textContent = sn;
    a.title = excl ? 'Ignoré à l\'export' : `${t('step')} ${sn}`;
    nav.appendChild(a);
  });
}

// ─── Détection des doublons et mise à jour de l'UI ───────────────────────────
function recomputeDuplicates() {
  // Groupe : stepNum → [idx, ...]
  const groups = {};
  _events.forEach((ev, idx) => {
    const sn = _stepNums[idx];
    if (!groups[sn]) groups[sn] = [];
    groups[sn].push(idx);
  });

  _events.forEach((ev, idx) => {
    const sn    = _stepNums[idx];
    const group = groups[sn];
    const isDup = group.length > 1;

    // Couleur de l'input
    const isExcluded = sn === '0';
    const input = document.querySelector(`.step-input[data-idx="${idx}"]`);
    if (input) {
      input.classList.toggle('excluded', isExcluded);
      input.classList.toggle('dup', !isExcluded && isDup);
    }

    // Visibilité du sélecteur de capture
    const pickDiv = document.getElementById(`pick-${idx}`);
    if (pickDiv && ev.screenshot) {
      if (isDup) {
        pickDiv.classList.add('visible');
        const radio = pickDiv.querySelector('input[type="radio"]');
        if (radio) {
          radio.name = `pick-group-${sn}`;
          if (_pickedShot[sn] === undefined) _pickedShot[sn] = group[0];
          radio.checked = (_pickedShot[sn] === idx);
        }
      } else {
        pickDiv.classList.remove('visible');
        delete _pickedShot[sn];
      }
    }
  });
}

// ─── Événements pour export (step nums + sélection captures) ─────────────────
function getExportEvents() {
  const stepCount = {};
  _events.forEach((ev, idx) => {
    const sn = _stepNums[idx];
    stepCount[sn] = (stepCount[sn] || 0) + 1;
  });

  const result = [];
  _events.forEach((ev, idx) => {
    const sn = _stepNums[idx];
    if (sn === '0') return; // étape ignorée
    let screenshot = ev.screenshot;
    if (screenshot && stepCount[sn] > 1) {
      const picked = _pickedShot[sn] !== undefined ? _pickedShot[sn] : -1;
      if (picked !== idx) screenshot = null;
    }
    result.push({ ...ev, id: sn, screenshot });
  });
  return result;
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

  const exported = getExportEvents();

  // DOCX avec template Yunit
  const logoBytes = await fetchLogo();
  const docxBytes = buildDocx(exported, _sessionName, logoBytes, _lang);
  zip.addFile('rapport.docx', docxBytes);

  // HTML autonome
  zip.addFile('rapport.html', buildHtmlReport(getExportEvents(), _sessionName));

  // Markdown
  zip.addFile('rapport.md', buildMarkdown(exported, _sessionName));

  // Excel (.xlsx avec images)
  zip.addFile('rapport.xlsx', buildXlsx(exported, _sessionName));

  // data.json
  zip.addFile('data.json', JSON.stringify({
    sessionName: _sessionName,
    stoppedAt: _stoppedAt,
    count: _events.length,
    events: _events.map(e => ({ ...e, screenshot: e.screenshot ? '[base64]' : null }))
  }, null, 2));

  // Screenshots séparés (seulement les captures retenues)
  exported.forEach(ev => {
    if (!ev.screenshot) return;
    const ext = ev.screenshot.startsWith('data:image/png') ? 'png' : 'jpeg';
    zip.addBase64(`screenshots/step-${ev.id}.${ext}`, ev.screenshot);
  });

  zip.download(`testtracer-${dateStr}.zip`);
}

// ─── Export Word (.docx) ──────────────────────────────────────────────────────
async function doExportDocx() {
  const logoBytes = await fetchLogo();
  const bytes     = buildDocx(getExportEvents(), _sessionName, logoBytes, _lang);
  downloadBlob(bytes, `testtracer-${dateSlug()}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

// ─── Export HTML autonome ─────────────────────────────────────────────────────
function doExportHtml() {
  const html = buildHtmlReport(getExportEvents(), _sessionName);
  downloadBlob(
    new TextEncoder().encode(html),
    `testtracer-${dateSlug()}.html`,
    'text/html'
  );
}

// ─── Export Markdown ──────────────────────────────────────────────────────────
function doExportMarkdown() {
  const md = buildMarkdown(getExportEvents(), _sessionName);
  downloadBlob(
    new TextEncoder().encode(md),
    `testtracer-${dateSlug()}.md`,
    'text/markdown'
  );
}

// ─── Export Excel (.xlsx avec images) ────────────────────────────────────────
function doExportExcel() {
  downloadBlob(
    buildXlsx(getExportEvents(), _sessionName),
    `testtracer-${dateSlug()}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}

// ─── Constructeur rapport HTML autonome ──────────────────────────────────────
function buildHtmlReport(events, sessionName) {
  const date  = new Date(_stoppedAt).toLocaleString(locale());
  const colors = {
    'click':'#22c55e','right-click':'#ef4444','double-click':'#f97316',
    'middle-click':'#94a3b8','input':'#3b82f6','select':'#a855f7',
    'checkbox':'#ec4899','radio':'#ec4899','scroll':'#eab308','navigation':'#06b6d4'
  };
  const steps = events.map(ev => {
    const label = typeLabel(ev.eventType);
    const time  = new Date(ev.timestamp).toLocaleTimeString(locale());
    const color = colors[ev.eventType] || '#94a3b8';
    return `
    <div style="border:1px solid #334155;border-radius:8px;overflow:hidden;margin-bottom:20px;background:#1e293b">
      <div style="padding:8px 14px;background:#0f172a;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-weight:700;font-size:15px;color:#e2e8f0">${t('step')} ${ev.id}</span>
        <span style="background:${color};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase">${label}</span>
        <span style="margin-left:auto;font-size:11px;color:#94a3b8">${time}</span>
      </div>
      <div style="padding:10px 14px">
        <div style="margin-bottom:6px">${escHtml(ev.description)}</div>
        ${ev.url ? `<div style="font-size:11px;color:#94a3b8;word-break:break-all">🔗 ${escHtml(ev.url)}</div>` : ''}
        ${ev.selector ? `<code style="font-size:10px;color:#94a3b8;background:#0f172a;padding:2px 5px;border-radius:3px">${escHtml(ev.selector)}</code>` : ''}
      </div>
      ${ev.screenshot
        ? `<img src="${ev.screenshot}" alt="${t('screenshotAlt')} ${ev.id}" style="width:100%;display:block;border-top:1px solid #334155">`
        : `<div style="padding:6px 14px;font-size:11px;color:#64748b;border-top:1px solid #334155;font-style:italic">${t('noCapture')}</div>`
      }
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="${_lang}">
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
  <p class="meta">${t('generatedOn')} ${date} — ${events.length} ${t('actions')}</p>
  ${steps}
</body>
</html>`;
}

// ─── Constructeur Markdown ────────────────────────────────────────────────────
function buildMarkdown(events, sessionName) {
  const date  = new Date(_stoppedAt).toLocaleString(locale());
  let md = `# ${sessionName}\n\n`;
  md += `> ${t('generatedOn')} ${date} — ${events.length} ${t('actions')}\n\n---\n\n`;

  events.forEach(ev => {
    const label = typeLabel(ev.eventType);
    const time  = new Date(ev.timestamp).toLocaleTimeString(locale());
    md += `## ${t('step')} ${ev.id} — ${label}\n\n`;
    md += `- **${t('time')} :** ${time}\n`;
    md += `- **${t('action')} :** ${ev.description}\n`;
    if (ev.url)      md += `- **URL :** ${ev.url}\n`;
    if (ev.selector) md += `- **${t('selector')} :** \`${ev.selector}\`\n`;
    md += '\n';
    if (ev.screenshot) {
      md += `![${t('screenshotAlt')} ${ev.id}](screenshots/step-${ev.id}.jpeg)\n\n`;
    }
    md += '---\n\n';
  });

  return md;
}

// ─── Sélection de langue ──────────────────────────────────────────────────────
function setLang(lang) {
  _lang = lang;
  document.getElementById('btn-lang-fr').classList.toggle('active', lang === 'fr');
  document.getElementById('btn-lang-en').classList.toggle('active', lang === 'en');
}

// ─── Filtre "Filter navigator" ────────────────────────────────────────────────
/**
 * Exclut les étapes dont la description contient "Filter navigator" (insensible à la casse)
 * et renuméroté les étapes restantes de façon séquentielle.
 */
function filterEvents(events) {
  let seq = 1;
  return events
    .filter(ev => !/filter navigator/i.test(ev.description || ''))
    .map(ev => ({ ...ev, id: seq++ }));
}

// ─── Constructeur XLSX (vrai OOXML avec images embarquées) ───────────────────
function buildXlsx(events, sessionName) {
  const zip  = new ZipBuilder();
  const date = new Date(_stoppedAt).toLocaleString(locale());
  const xe   = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // Dimensions image : 200×113 px à 96 DPI → EMU (1 px = 9525 EMU)
  const imgW = 1905000;
  const imgH = 1076325;
  const imgRowHt = 90; // hauteur de ligne en points pour les lignes avec capture

  // Les données commencent à la ligne Excel 4 (index 0-based : 3)
  const DATA_START_ROW = 3;
  const COLS = ['A','B','C','D','E','F','G'];

  const eventsWithImg = events.filter(e => e.screenshot);
  const N = eventsWithImg.length;

  // ── Fichiers image dans xl/media/ ─────────────────────────────────────────
  eventsWithImg.forEach((ev, i) => {
    const ext = ev.screenshot.startsWith('data:image/png') ? 'png' : 'jpeg';
    zip.addBase64(`xl/media/image${i + 1}.${ext}`, ev.screenshot);
  });

  // ── [Content_Types].xml ───────────────────────────────────────────────────
  zip.addFile('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="png"  ContentType="image/png"/>
  <Override PartName="/xl/workbook.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${N > 0 ? '\n  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}
</Types>`);

  // ── _rels/.rels ───────────────────────────────────────────────────────────
  zip.addFile('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="xl/workbook.xml"/>
</Relationships>`);

  // ── xl/workbook.xml ───────────────────────────────────────────────────────
  zip.addFile('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Rapport" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);

  // ── xl/_rels/workbook.xml.rels ────────────────────────────────────────────
  zip.addFile('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
    Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
    Target="styles.xml"/>
</Relationships>`);

  // ── xl/styles.xml ─────────────────────────────────────────────────────────
  // Index styles cellXfs : 0=défaut, 1=titre session, 2=en-tête colonne, 3=cellule donnée
  zip.addFile('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><sz val="10"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF003C5A"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E5276"/></patternFill></fill>
    <fill><patternFill patternType="none"/></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFCCCCCC"/></left>
      <right style="thin"><color rgb="FFCCCCCC"/></right>
      <top style="thin"><color rgb="FFCCCCCC"/></top>
      <bottom style="thin"><color rgb="FFCCCCCC"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0"
        applyFont="1" applyBorder="1" applyAlignment="1">
      <alignment wrapText="1" vertical="top"/>
    </xf>
  </cellXfs>
</styleSheet>`);

  // ── xl/worksheets/sheet1.xml ──────────────────────────────────────────────
  let sheetData = '';

  // Ligne 1 : titre session
  sheetData += `<row r="1" ht="20" customHeight="1">` +
    `<c r="A1" t="inlineStr" s="1"><is><t>${xe(`Session : ${sessionName} — ${date} — ${events.length} action(s)`)}</t></is></c>` +
    `</row>`;

  // Ligne 2 : vide (séparateur)
  sheetData += `<row r="2" ht="6" customHeight="1"/>`;

  // Ligne 3 : en-têtes de colonnes
  const headers = t('xlsxHeaders');
  const headerCells = headers.map((h, c) =>
    `<c r="${COLS[c]}3" t="inlineStr" s="2"><is><t>${xe(h)}</t></is></c>`
  ).join('');
  sheetData += `<row r="3" ht="16" customHeight="1">${headerCells}</row>`;

  // Lignes de données
  events.forEach((ev, i) => {
    const time   = new Date(ev.timestamp).toLocaleTimeString(locale());
    const rowRef = DATA_START_ROW + i + 1; // 1-based
    const htAttr = ev.screenshot ? ` ht="${imgRowHt}" customHeight="1"` : '';
    const vals   = [String(ev.id), typeLabel(ev.eventType), ev.description || '', ev.url || '', ev.selector || '', time, ''];
    const cells  = vals.map((v, c) =>
      `<c r="${COLS[c]}${rowRef}" t="inlineStr" s="3"><is><t>${xe(v)}</t></is></c>`
    ).join('');
    sheetData += `<row r="${rowRef}"${htAttr}>${cells}</row>`;
  });

  const drawingEl = N > 0 ? '<drawing r:id="rId1"/>' : '';

  zip.addFile('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <cols>
    <col min="1" max="1" width="5"  customWidth="1"/>
    <col min="2" max="2" width="14" customWidth="1"/>
    <col min="3" max="3" width="40" customWidth="1"/>
    <col min="4" max="4" width="35" customWidth="1"/>
    <col min="5" max="5" width="30" customWidth="1"/>
    <col min="6" max="6" width="10" customWidth="1"/>
    <col min="7" max="7" width="28" customWidth="1"/>
  </cols>
  <sheetData>${sheetData}</sheetData>
  ${drawingEl}
</worksheet>`);

  // ── Drawings (uniquement si des captures existent) ────────────────────────
  if (N > 0) {
    zip.addFile('xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"
    Target="../drawings/drawing1.xml"/>
</Relationships>`);

    let anchors = '';
    let imgIdx  = 0;
    events.forEach((ev, i) => {
      if (!ev.screenshot) return;
      imgIdx++;
      const rowIdx = DATA_START_ROW + i; // 0-based pour le drawing
      anchors += `<xdr:oneCellAnchor>
  <xdr:from>
    <xdr:col>6</xdr:col><xdr:colOff>28575</xdr:colOff>
    <xdr:row>${rowIdx}</xdr:row><xdr:rowOff>28575</xdr:rowOff>
  </xdr:from>
  <xdr:ext cx="${imgW}" cy="${imgH}"/>
  <xdr:pic>
    <xdr:nvPicPr>
      <xdr:cNvPr id="${imgIdx}" name="Image${imgIdx}"/>
      <xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>
    </xdr:nvPicPr>
    <xdr:blipFill>
      <a:blip r:embed="rId${imgIdx}"/>
      <a:stretch><a:fillRect/></a:stretch>
    </xdr:blipFill>
    <xdr:spPr>
      <a:xfrm><a:off x="0" y="0"/><a:ext cx="${imgW}" cy="${imgH}"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    </xdr:spPr>
  </xdr:pic>
  <xdr:clientData/>
</xdr:oneCellAnchor>`;
    });

    zip.addFile('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${anchors}
</xdr:wsDr>`);

    let imgRels = '';
    let ri = 0;
    events.forEach(ev => {
      if (!ev.screenshot) return;
      ri++;
      const ext = ev.screenshot.startsWith('data:image/png') ? 'png' : 'jpeg';
      imgRels += `\n  <Relationship Id="rId${ri}"` +
        ` Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"` +
        ` Target="../media/image${ri}.${ext}"/>`;
    });

    zip.addFile('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${imgRels}
</Relationships>`);
  }

  return zip.build();
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
