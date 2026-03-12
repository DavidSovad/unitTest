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
