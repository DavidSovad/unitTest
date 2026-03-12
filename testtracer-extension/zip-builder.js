'use strict';

/**
 * ZipBuilder — constructeur ZIP pur JavaScript, sans dépendance externe.
 * Utilise la méthode STORED (pas de compression) pour la compatibilité maximale.
 * Supporte : chaînes UTF-8, Uint8Array, et data-URL base64.
 */
class ZipBuilder {
  constructor() {
    this._files = [];
  }

  /**
   * Ajoute un fichier.
   * @param {string} name   - Chemin dans le ZIP (ex: "screenshots/step-1.jpeg")
   * @param {string|Uint8Array} data - Contenu texte ou binaire
   */
  addFile(name, data) {
    if (typeof data === 'string') {
      data = new TextEncoder().encode(data);
    }
    this._files.push({ name, data: data instanceof Uint8Array ? data : new Uint8Array(data) });
    return this;
  }

  /**
   * Ajoute un fichier depuis une data-URL base64 (ex: capture d'écran).
   * @param {string} name
   * @param {string} dataUrl  - "data:image/jpeg;base64,/9j/..."
   */
  addBase64(name, dataUrl) {
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    const binary  = atob(base64);
    const bytes   = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return this.addFile(name, bytes);
  }

  /** Génère le fichier ZIP et retourne un Uint8Array. */
  build() {
    const enc = new TextEncoder();
    const parts = [];
    const centralDir = [];
    let offset = 0;

    for (const file of this._files) {
      const nameBytes = enc.encode(file.name);
      const crc       = crc32(file.data);
      const size      = file.data.length;
      const dosTime   = toDosDateTime(new Date());

      // ── Local file header ────────────────────────────────────────────────
      const lh = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0,  0x04034b50, true); // signature
      lv.setUint16(4,  20,         true); // version needed
      lv.setUint16(6,  0,          true); // flags
      lv.setUint16(8,  0,          true); // compression: STORED
      lv.setUint32(10, dosTime,    true); // date/time
      lv.setUint32(14, crc,        true); // CRC-32
      lv.setUint32(18, size,       true); // compressed size
      lv.setUint32(22, size,       true); // uncompressed size
      lv.setUint16(26, nameBytes.length, true); // filename length
      lv.setUint16(28, 0,          true); // extra field length
      lh.set(nameBytes, 30);

      parts.push(lh);
      parts.push(file.data);

      // ── Central directory entry ──────────────────────────────────────────
      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0,  0x02014b50, true); // signature
      cv.setUint16(4,  20,         true); // version made by
      cv.setUint16(6,  20,         true); // version needed
      cv.setUint16(8,  0,          true); // flags
      cv.setUint16(10, 0,          true); // compression
      cv.setUint32(12, dosTime,    true); // date/time
      cv.setUint32(16, crc,        true); // CRC-32
      cv.setUint32(20, size,       true); // compressed size
      cv.setUint32(24, size,       true); // uncompressed size
      cv.setUint16(28, nameBytes.length, true); // filename length
      cv.setUint16(30, 0,          true); // extra field length
      cv.setUint16(32, 0,          true); // file comment length
      cv.setUint16(34, 0,          true); // disk number start
      cv.setUint16(36, 0,          true); // internal attr
      cv.setUint32(38, 0,          true); // external attr
      cv.setUint32(42, offset,     true); // local header offset
      cd.set(nameBytes, 46);
      centralDir.push(cd);

      offset += lh.length + file.data.length;
    }

    // ── Central directory ────────────────────────────────────────────────────
    const cdStart = offset;
    let cdSize = 0;
    for (const cd of centralDir) {
      parts.push(cd);
      cdSize += cd.length;
    }

    // ── End of central directory ─────────────────────────────────────────────
    const eocd = new Uint8Array(22);
    const ev   = new DataView(eocd.buffer);
    ev.setUint32(0,  0x06054b50,          true); // signature
    ev.setUint16(4,  0,                   true); // disk number
    ev.setUint16(6,  0,                   true); // disk with CD
    ev.setUint16(8,  this._files.length,  true); // entries on disk
    ev.setUint16(10, this._files.length,  true); // total entries
    ev.setUint32(12, cdSize,              true); // CD size
    ev.setUint32(16, cdStart,             true); // CD offset
    ev.setUint16(20, 0,                   true); // comment length
    parts.push(eocd);

    // ── Concaténer ───────────────────────────────────────────────────────────
    const total  = parts.reduce((n, p) => n + p.length, 0);
    const result = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) { result.set(p, pos); pos += p.length; }
    return result;
  }

  /** Déclenche le téléchargement du ZIP dans le navigateur. */
  download(filename) {
    const bytes = this.build();
    const blob  = new Blob([bytes], { type: 'application/zip' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

// ─── CRC-32 ───────────────────────────────────────────────────────────────────
function crc32(data) {
  if (!crc32._t) {
    crc32._t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc32._t[i] = c;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = (c >>> 8) ^ crc32._t[(c ^ data[i]) & 0xFF];
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ─── Date/heure au format DOS ─────────────────────────────────────────────────
function toDosDateTime(d) {
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1));
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate());
  return ((date << 16) | time) >>> 0;
}

// ─── Constructeur de fichier DOCX (OOXML) ────────────────────────────────────
/**
 * buildDocx(events, sessionName) → Uint8Array
 * Génère un fichier .docx complet avec captures d'écran intégrées.
 */
function buildDocx(events, sessionName) {
  const zip = new ZipBuilder();

  // ── Métadonnées de session ───────────────────────────────────────────────
  const date   = new Date().toLocaleString('fr-FR');
  const count  = events.length;

  // Images (uniquement les events avec screenshot)
  const eventsWithImg = events.filter(e => e.screenshot);

  // ── [Content_Types].xml ──────────────────────────────────────────────────
  let contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="png"  ContentType="image/png"/>
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  zip.addFile('[Content_Types].xml', contentTypes);

  // ── _rels/.rels ──────────────────────────────────────────────────────────
  zip.addFile('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>`);

  // ── word/_rels/document.xml.rels ─────────────────────────────────────────
  let rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;
  eventsWithImg.forEach((e, i) => {
    const ext = e.screenshot.startsWith('data:image/png') ? 'png' : 'jpeg';
    rels += `\n  <Relationship Id="rId${i + 1}"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    Target="media/image${i + 1}.${ext}"/>`;
  });
  rels += '\n</Relationships>';
  zip.addFile('word/_rels/document.xml.rels', rels);

  // ── Images ───────────────────────────────────────────────────────────────
  eventsWithImg.forEach((e, i) => {
    const ext = e.screenshot.startsWith('data:image/png') ? 'png' : 'jpeg';
    zip.addBase64(`word/media/image${i + 1}.${ext}`, e.screenshot);
  });

  // ── word/document.xml ────────────────────────────────────────────────────
  const typeLabels = {
    'click':       'Clic',        'right-click': 'Clic droit',
    'double-click':'Double-clic', 'middle-click':'Clic molette',
    'input':       'Saisie',      'select':      'Sélection',
    'checkbox':    'Checkbox',    'radio':        'Radio',
    'scroll':      'Défilement',  'navigation':   'Navigation'
  };

  // Largeur image en EMU : 15 cm = 5400000 EMU, hauteur proportionnelle (ratio 16/9 ~= 3037500)
  const imgW = 5400000;
  const imgH = 3037500;

  let imgIndex = 0; // index dans eventsWithImg

  let body = '';
  // Titre
  body += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
    <w:r><w:t xml:space="preserve">${xmlEsc(sessionName)}</w:t></w:r></w:p>`;
  body += para(`Rapport généré le ${xmlEsc(date)} — ${count} action(s)`);
  body += '<w:p/>';

  events.forEach((ev, idx) => {
    const label = typeLabels[ev.eventType] || ev.eventType;
    const time  = new Date(ev.timestamp).toLocaleTimeString('fr-FR');

    // En-tête étape
    body += `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t xml:space="preserve">Étape ${ev.id} — ${xmlEsc(label)}</w:t></w:r></w:p>`;

    // Détails
    body += para(`🕐 ${xmlEsc(time)}   |   🔗 ${xmlEsc(ev.url || '')}`);
    body += para(`📋 ${xmlEsc(ev.description || '')}`);
    if (ev.selector) body += para(`🎯 Sélecteur : ${xmlEsc(ev.selector)}`);

    // Capture d'écran
    if (ev.screenshot) {
      const rId = `rId${imgIndex + 1}`;
      const pid = idx + 1;
      imgIndex++;
      body += `<w:p><w:r><w:drawing>
        <wp:inline distT="0" distB="0" distL="0" distR="0"
          xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
          <wp:extent cx="${imgW}" cy="${imgH}"/>
          <wp:docPr id="${pid}" name="Image${pid}"/>
          <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:nvPicPr>
                  <pic:cNvPr id="${pid}" name="Image${pid}"/>
                  <pic:cNvPicPr/>
                </pic:nvPicPr>
                <pic:blipFill>
                  <a:blip r:embed="${rId}"
                    xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
                  <a:stretch><a:fillRect/></a:stretch>
                </pic:blipFill>
                <pic:spPr>
                  <a:xfrm><a:off x="0" y="0"/><a:ext cx="${imgW}" cy="${imgH}"/></a:xfrm>
                  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                </pic:spPr>
              </pic:pic>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing></w:r></w:p>`;
    }

    body += '<w:p/>'; // séparateur
  });

  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${body}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  zip.addFile('word/document.xml', doc);

  return zip.build();
}

// ─── Helpers DOCX ─────────────────────────────────────────────────────────────
function para(text) {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function xmlEsc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ═══════════════════════════════════════════════════════════════════════════════
// XLSX (Excel) BUILDER — pur JavaScript, sans dépendance externe
// Format : Office Open XML (.xlsx = ZIP de fichiers XML)
// Colonnes : N° | Action | Description | Lien | Image (vignette intégrée)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * buildXlsx(events, sessionName) → Uint8Array
 * Génère un fichier .xlsx complet avec captures d'écran intégrées dans la
 * colonne Image, une image par ligne.
 */
function buildXlsx(events, sessionName) {
  const zip = new ZipBuilder();

  // ── Indexer les images (événements avec screenshot) ──────────────────────
  // imgMap : index dans events → numéro d'image 1-based
  const imgMap = new Map();
  let imgCount = 0;
  events.forEach((ev, i) => {
    if (ev.screenshot) {
      imgCount++;
      imgMap.set(i, imgCount);
      const ext = ev.screenshot.startsWith('data:image/png') ? 'png' : 'jpeg';
      zip.addBase64(`xl/media/image${imgCount}.${ext}`, ev.screenshot);
    }
  });

  // ── [Content_Types].xml ──────────────────────────────────────────────────
  zip.addFile('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels"  ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"   ContentType="application/xml"/>
  <Default Extension="jpeg"  ContentType="image/jpeg"/>
  <Default Extension="png"   ContentType="image/png"/>
  <Override PartName="/xl/workbook.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${imgCount > 0
    ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
    : ''}
</Types>`);

  // ── _rels/.rels ──────────────────────────────────────────────────────────
  zip.addFile('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="xl/workbook.xml"/>
</Relationships>`);

  // ── xl/workbook.xml ──────────────────────────────────────────────────────
  const sheetName = xmlEsc(sessionName.slice(0, 31)); // max 31 chars for sheet name
  zip.addFile('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${sheetName}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`);

  // ── xl/_rels/workbook.xml.rels ───────────────────────────────────────────
  zip.addFile('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
    Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
    Target="styles.xml"/>
</Relationships>`);

  // ── xl/styles.xml ────────────────────────────────────────────────────────
  zip.addFile('xl/styles.xml', xlsxStyles());

  // ── xl/worksheets/sheet1.xml ─────────────────────────────────────────────
  zip.addFile('xl/worksheets/sheet1.xml', xlsxSheet(events, imgMap, imgCount > 0));

  // ── Fichiers drawing (uniquement si des images existent) ─────────────────
  if (imgCount > 0) {
    // Référence drawing depuis la feuille
    zip.addFile('xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"
    Target="../drawings/drawing1.xml"/>
</Relationships>`);

    // Ancres des images
    zip.addFile('xl/drawings/drawing1.xml', xlsxDrawing(events, imgMap));

    // Relations images du drawing
    zip.addFile('xl/drawings/_rels/drawing1.xml.rels', xlsxDrawingRels(events, imgMap));
  }

  return zip.build();
}

// ─── Feuille de calcul ────────────────────────────────────────────────────────
function xlsxSheet(events, imgMap, hasDrawing) {
  const TYPE_LABELS = {
    'click': 'Clic', 'right-click': 'Clic droit', 'double-click': 'Double-clic',
    'middle-click': 'Clic molette', 'input': 'Saisie', 'select': 'Sélection',
    'checkbox': 'Checkbox', 'radio': 'Radio', 'scroll': 'Défilement',
    'navigation': 'Navigation'
  };

  // Ligne d'en-tête (style 1 = gras + fond bleu)
  let rows = `<row r="1">
      <c r="A1" s="1" t="inlineStr"><is><t>N°</t></is></c>
      <c r="B1" s="1" t="inlineStr"><is><t>Action</t></is></c>
      <c r="C1" s="1" t="inlineStr"><is><t>Description</t></is></c>
      <c r="D1" s="1" t="inlineStr"><is><t>Lien</t></is></c>
      <c r="E1" s="1" t="inlineStr"><is><t>Image</t></is></c>
    </row>`;

  events.forEach((ev, idx) => {
    const r   = idx + 2; // ligne Excel (1-indexée, skip header)
    const lbl = TYPE_LABELS[ev.eventType] || ev.eventType;
    rows += `
    <row r="${r}" ht="113" customHeight="1">
      <c r="A${r}" t="n"><v>${ev.id}</v></c>
      <c r="B${r}" s="2" t="inlineStr"><is><t>${xmlEsc(lbl)}</t></is></c>
      <c r="C${r}" s="2" t="inlineStr"><is><t>${xmlEsc(ev.description)}</t></is></c>
      <c r="D${r}" s="3" t="inlineStr"><is><t>${xmlEsc(ev.url)}</t></is></c>
      <c r="E${r}" t="inlineStr"><is><t></t></is></c>
    </row>`;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>
    <col min="1" max="1" width="6"  customWidth="1"/>
    <col min="2" max="2" width="14" customWidth="1"/>
    <col min="3" max="3" width="50" customWidth="1"/>
    <col min="4" max="4" width="55" customWidth="1"/>
    <col min="5" max="5" width="38" customWidth="1"/>
  </cols>
  <sheetData>
    ${rows}
  </sheetData>
  ${hasDrawing ? '<drawing r:id="rId1"/>' : ''}
</worksheet>`;
}

// ─── Styles Excel ─────────────────────────────────────────────────────────────
function xlsxStyles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid">
      <fgColor rgb="FF1D4ED8"/><bgColor indexed="64"/>
    </patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="4">
    <!-- 0 : défaut -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 1 : en-tête (gras blanc sur bleu, centré) -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0"
        applyFont="1" applyFill="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <!-- 2 : données texte (retour à la ligne, haut) -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">
      <alignment wrapText="1" vertical="top"/>
    </xf>
    <!-- 3 : URL (retour à la ligne, haut, bleu) -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">
      <alignment wrapText="1" vertical="top"/>
    </xf>
  </cellXfs>
</styleSheet>`;
}

// ─── Drawing XML (ancres des vignettes) ──────────────────────────────────────
// Chaque image est ancrée dans la colonne E (index 4) de sa ligne de données.
// cx=2743200 EMU (~7,2 cm), cy=1371600 EMU (~3,6 cm) — proportions 16/9
function xlsxDrawing(events, imgMap) {
  const IMW = 2743200; // largeur image en EMU
  const IMH = 1371600; // hauteur image en EMU
  const PAD = 38100;   // marge intérieure (0,1 cm)

  let anchors = '';
  events.forEach((ev, idx) => {
    const n = imgMap.get(idx);
    if (!n) return;
    const row = idx + 1; // ligne 0-indexée (skip header à la ligne 0)
    anchors += `
  <xdr:oneCellAnchor>
    <xdr:from>
      <xdr:col>4</xdr:col><xdr:colOff>${PAD}</xdr:colOff>
      <xdr:row>${row}</xdr:row><xdr:rowOff>${PAD}</xdr:rowOff>
    </xdr:from>
    <xdr:ext cx="${IMW}" cy="${IMH}"/>
    <xdr:pic>
      <xdr:nvPicPr>
        <xdr:cNvPr id="${n}" name="Image${n}" descr="Étape ${ev.id}"/>
        <xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip r:embed="rId${n}"/>
        <a:stretch><a:fillRect/></a:stretch>
      </xdr:blipFill>
      <xdr:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="${IMW}" cy="${IMH}"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:oneCellAnchor>`;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr
  xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  ${anchors}
</xdr:wsDr>`;
}

// ─── Relations images du drawing ──────────────────────────────────────────────
function xlsxDrawingRels(events, imgMap) {
  let rels = '';
  events.forEach((ev, idx) => {
    const n = imgMap.get(idx);
    if (!n) return;
    const ext = ev.screenshot.startsWith('data:image/png') ? 'png' : 'jpeg';
    rels += `
  <Relationship Id="rId${n}"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    Target="../media/image${n}.${ext}"/>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels}
</Relationships>`;
}
