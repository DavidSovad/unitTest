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
  document.getElementById('btn-excel').addEventListener('click', doExportExcel);
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

  const filtered = filterEvents(_events);

  // DOCX avec template Yunit
  const logoBytes = await fetchLogo();
  const docxBytes = buildDocx(filtered, _sessionName, logoBytes);
  zip.addFile('rapport.docx', docxBytes);

  // HTML autonome
  zip.addFile('rapport.html', buildHtmlReport(_events, _sessionName));

  // Markdown
  zip.addFile('rapport.md', buildMarkdown(filtered, _sessionName));

  // Excel (.xlsx avec images)
  zip.addFile('rapport.xlsx', buildXlsx(filtered, _sessionName));

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
  const bytes     = buildDocx(filterEvents(_events), _sessionName, logoBytes);
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
  const md = buildMarkdown(filterEvents(_events), _sessionName);
  downloadBlob(
    new TextEncoder().encode(md),
    `testtracer-${dateSlug()}.md`,
    'text/markdown'
  );
}

// ─── Export Excel (.xlsx avec images) ────────────────────────────────────────
function doExportExcel() {
  downloadBlob(
    buildXlsx(filterEvents(_events), _sessionName),
    `testtracer-${dateSlug()}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
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
  const date = new Date(_stoppedAt).toLocaleString('fr-FR');
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
  const headers = ['N°','Type','Description','URL','Sélecteur','Heure','Capture d\'écran'];
  const headerCells = headers.map((h, c) =>
    `<c r="${COLS[c]}3" t="inlineStr" s="2"><is><t>${xe(h)}</t></is></c>`
  ).join('');
  sheetData += `<row r="3" ht="16" customHeight="1">${headerCells}</row>`;

  // Lignes de données
  events.forEach((ev, i) => {
    const meta   = TYPE_META[ev.eventType] || { label: ev.eventType };
    const time   = new Date(ev.timestamp).toLocaleTimeString('fr-FR');
    const rowRef = DATA_START_ROW + i + 1; // 1-based
    const htAttr = ev.screenshot ? ` ht="${imgRowHt}" customHeight="1"` : '';
    const vals   = [String(ev.id), meta.label, ev.description || '', ev.url || '', ev.selector || '', time, ''];
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
