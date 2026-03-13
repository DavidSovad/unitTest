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

// ─── Constructeur de fichier DOCX (OOXML) — Template Yunit ──────────────────
/**
 * buildDocx(events, sessionName, logoBytes) → Uint8Array
 * Template Yunit : Verdana/Calibri, #003C5A/#00B9FF, logo en-tête,
 * pied de page légal, format A4 avec marges professionnelles.
 * @param {Uint8Array|null} logoBytes  Binaire de image13.png (optionnel)
 */
function buildDocx(events, sessionName, logoBytes, lang = 'fr') {
  const zip     = new ZipBuilder();
  const lc      = lang === 'fr' ? 'fr-FR' : 'en-US';
  const date    = new Date().toLocaleString(lc);
  const hasLogo = logoBytes instanceof Uint8Array && logoBytes.length > 0;

  // Images des events
  const eventsWithImg = events.filter(e => e.screenshot);
  const N = eventsWithImg.length; // nb captures

  // IDs relationnels dans word/_rels/document.xml.rels
  const rIdStyles = N + 1;
  const rIdHeader = N + 2;
  const rIdFooter = N + 3;

  // ── Fichiers binaires ────────────────────────────────────────────────────
  if (hasLogo) zip.addFile('word/media/logo.png', logoBytes);

  eventsWithImg.forEach((e, i) => {
    const ext = e.screenshot.startsWith('data:image/png') ? 'png' : 'jpeg';
    zip.addBase64(`word/media/image${i + 1}.${ext}`, e.screenshot);
  });

  // ── [Content_Types].xml ──────────────────────────────────────────────────
  zip.addFile('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="png"  ContentType="image/png"/>
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`);

  // ── _rels/.rels ──────────────────────────────────────────────────────────
  zip.addFile('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>`);

  // ── word/_rels/document.xml.rels ─────────────────────────────────────────
  let imgRels = '';
  eventsWithImg.forEach((e, i) => {
    const ext = e.screenshot.startsWith('data:image/png') ? 'png' : 'jpeg';
    imgRels += `\n  <Relationship Id="rId${i + 1}"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    Target="media/image${i + 1}.${ext}"/>`;
  });
  zip.addFile('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${imgRels}
  <Relationship Id="rId${rIdStyles}"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
    Target="styles.xml"/>
  <Relationship Id="rId${rIdHeader}"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header"
    Target="header1.xml"/>
  <Relationship Id="rId${rIdFooter}"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer"
    Target="footer1.xml"/>
</Relationships>`);

  // ── word/styles.xml ───────────────────────────────────────────────────────
  zip.addFile('word/styles.xml', docxStyles());

  // ── word/header1.xml ──────────────────────────────────────────────────────
  zip.addFile('word/header1.xml', docxHeader(sessionName, hasLogo));

  // ── word/_rels/header1.xml.rels (logo uniquement si présent) ─────────────
  if (hasLogo) {
    zip.addFile('word/_rels/header1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    Target="media/logo.png"/>
</Relationships>`);
  }

  // ── word/footer1.xml ──────────────────────────────────────────────────────
  zip.addFile('word/footer1.xml', docxFooter(lang));

  // ── word/document.xml ────────────────────────────────────────────────────
  const typeLabels = lang === 'fr' ? {
    'click':'Clic','right-click':'Clic droit','double-click':'Double-clic',
    'middle-click':'Clic molette','input':'Saisie','select':'Sélection',
    'checkbox':'Checkbox','radio':'Radio','scroll':'Défilement','navigation':'Navigation'
  } : {
    'click':'Click','right-click':'Right click','double-click':'Double click',
    'middle-click':'Middle click','input':'Input','select':'Select',
    'checkbox':'Checkbox','radio':'Radio','scroll':'Scroll','navigation':'Navigation'
  };

  // 15 cm × 8.44 cm en EMU (1 cm = 360 000 EMU)
  const imgW = 5400000;
  const imgH = 3037500;

  let imgIndex = 0;
  let body = '';

  // Titre principal
  body += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
    <w:r><w:t xml:space="preserve">${xmlEsc(sessionName)}</w:t></w:r></w:p>`;

  // Métadonnées
  body += `<w:p><w:r><w:rPr><w:color w:val="7F7F7F"/><w:sz w:val="20"/>
    <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr>
    <w:t xml:space="preserve">${lang === 'fr' ? 'Rapport généré le' : 'Report generated on'} ${xmlEsc(date)} — ${events.length} action(s)</w:t>
  </w:r></w:p><w:p/>`;

  events.forEach((ev, idx) => {
    const label = typeLabels[ev.eventType] || ev.eventType;
    const time  = new Date(ev.timestamp).toLocaleTimeString(lc);

    // En-tête étape
    body += `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t xml:space="preserve">${lang === 'fr' ? 'Étape' : 'Step'} ${ev.id} — ${xmlEsc(label)}</w:t></w:r></w:p>`;

    // Heure + URL
    body += `<w:p><w:r><w:rPr><w:color w:val="7F7F7F"/><w:sz w:val="20"/>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr>
      <w:t xml:space="preserve">🕐 ${xmlEsc(time)}   |   🔗 ${xmlEsc(ev.url || '')}</w:t>
    </w:r></w:p>`;

    // Description
    body += para(`📋 ${xmlEsc(ev.description || '')}`);

    // Sélecteur
    if (ev.selector) {
      body += `<w:p><w:r><w:rPr>
        <w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>
        <w:color w:val="555555"/><w:sz w:val="18"/>
      </w:rPr><w:t xml:space="preserve">🎯 ${xmlEsc(ev.selector)}</w:t></w:r></w:p>`;
    }

    // Capture d'écran
    if (ev.screenshot) {
      const rId = `rId${imgIndex + 1}`;
      const pid = imgIndex + 1;
      imgIndex++;
      body += `<w:p><w:r><w:drawing>
        <wp:inline distT="0" distB="114400" distL="0" distR="0"
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

    body += '<w:p/>'; // séparateur inter-étape
  });

  zip.addFile('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${body}
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId${rIdHeader}"/>
      <w:footerReference w:type="default" r:id="rId${rIdFooter}"/>
      <!-- A4 : 210 × 297 mm -->
      <w:pgSz w:w="11906" w:h="16838"/>
      <!-- Marges : haut/bas 2.5 cm, gauche 3 cm, droite 2 cm, en-tête/pied 1.25 cm -->
      <w:pgMar w:top="1417" w:right="1134" w:bottom="1417" w:left="1701"
               w:header="709" w:footer="709" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`);

  return zip.build();
}

// ─── Helpers DOCX ─────────────────────────────────────────────────────────────

/** Feuille de styles Yunit : Verdana (titres) + Calibri (corps), #003C5A/#00B9FF */
function docxStyles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
      <w:sz w:val="22"/><w:szCs w:val="22"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr>
      <w:spacing w:after="120"/>
    </w:pPr></w:pPrDefault>
  </w:docDefaults>

  <!-- Normal -->
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr><w:spacing w:after="120"/></w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:sz w:val="22"/>
    </w:rPr>
  </w:style>

  <!-- Heading 1 — Titre de session : Verdana 16 pt, gras, #003C5A, filet bas #00B9FF -->
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="480" w:after="240"/>
      <w:pBdr>
        <w:bottom w:val="single" w:sz="6" w:space="4" w:color="00B9FF"/>
      </w:pBdr>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Verdana" w:hAnsi="Verdana"/>
      <w:b/>
      <w:color w:val="003C5A"/>
      <w:sz w:val="32"/><w:szCs w:val="32"/>
    </w:rPr>
  </w:style>

  <!-- Heading 2 — Titre d'étape : Verdana 12 pt, gras, #003C5A, fond bleu pâle, filet gauche -->
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:before="240" w:after="120"/>
      <w:shd w:val="clear" w:color="auto" w:fill="E8F4FC"/>
      <w:pBdr>
        <w:left w:val="single" w:sz="12" w:space="4" w:color="003C5A"/>
      </w:pBdr>
      <w:ind w:left="180"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Verdana" w:hAnsi="Verdana"/>
      <w:b/>
      <w:color w:val="003C5A"/>
      <w:sz w:val="24"/><w:szCs w:val="24"/>
    </w:rPr>
  </w:style>

  <!-- Header — Calibri 9 pt, #003C5A, tab droit, filet bas #00B9FF -->
  <w:style w:type="paragraph" w:styleId="Header">
    <w:name w:val="header"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:pBdr>
        <w:bottom w:val="single" w:sz="4" w:space="4" w:color="00B9FF"/>
      </w:pBdr>
      <w:tabs>
        <w:tab w:val="right" w:pos="9639"/>
      </w:tabs>
      <w:spacing w:after="80"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:color w:val="003C5A"/>
      <w:sz w:val="18"/><w:szCs w:val="18"/>
    </w:rPr>
  </w:style>

  <!-- Footer — Calibri 8 pt, centré, gris, filet haut #00B9FF -->
  <w:style w:type="paragraph" w:styleId="Footer">
    <w:name w:val="footer"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:pBdr>
        <w:top w:val="single" w:sz="4" w:space="4" w:color="00B9FF"/>
      </w:pBdr>
      <w:spacing w:before="80" w:after="0"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:color w:val="7F7F7F"/>
      <w:sz w:val="16"/><w:szCs w:val="16"/>
    </w:rPr>
  </w:style>
</w:styles>`;
}

/**
 * En-tête : logo Yunit à gauche (ou texte "YUNIT" si absent) + nom session à droite.
 * Logo : 5 cm × 2 cm = 1 800 000 × 720 000 EMU
 */
function docxHeader(sessionName, hasLogo) {
  const NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;

  const logoW = 1080000; // 3 cm  — ratio quasi-carré (logo Yunit MagellanPartners)
  const logoH =  936000; // 2.6 cm

  const logoRun = hasLogo
    ? `<w:r><w:drawing>
        <wp:inline distT="0" distB="0" distL="0" distR="114400">
          <wp:extent cx="${logoW}" cy="${logoH}"/>
          <wp:docPr id="100" name="LogoYunit" descr="Logo Yunit"/>
          <a:graphic>
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:pic>
                <pic:nvPicPr>
                  <pic:cNvPr id="100" name="LogoYunit"/>
                  <pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr>
                </pic:nvPicPr>
                <pic:blipFill>
                  <a:blip r:embed="rId1"/>
                  <a:stretch><a:fillRect/></a:stretch>
                </pic:blipFill>
                <pic:spPr>
                  <a:xfrm><a:off x="0" y="0"/><a:ext cx="${logoW}" cy="${logoH}"/></a:xfrm>
                  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                </pic:spPr>
              </pic:pic>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing></w:r>`
    : `<w:r><w:rPr>
        <w:rFonts w:ascii="Verdana" w:hAnsi="Verdana"/>
        <w:b/><w:color w:val="003C5A"/><w:sz w:val="28"/>
      </w:rPr><w:t>YUNIT</w:t></w:r>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${NS}>
  <w:p>
    <w:pPr><w:pStyle w:val="Header"/></w:pPr>
    ${logoRun}
    <w:r><w:rPr><w:color w:val="003C5A"/><w:sz w:val="18"/></w:rPr>
      <w:tab/>
      <w:t xml:space="preserve">TestTracer — ${xmlEsc(sessionName)}</w:t>
    </w:r>
  </w:p>
</w:hdr>`;
}

/** Pied de page : infos légales Yunit + numéro de page */
function docxFooter(lang = 'fr') {
  const year   = new Date().getFullYear();
  const conf   = lang === 'fr' ? 'Document confidentiel' : 'Confidential document';
  const rights = lang === 'fr' ? 'Tous droits réservés' : 'All rights reserved';
  const page   = 'Page';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr><w:pStyle w:val="Footer"/></w:pPr>
    <w:r><w:rPr><w:b/><w:color w:val="003C5A"/></w:rPr>
      <w:t xml:space="preserve">Yunit </w:t>
    </w:r>
    <w:r>
      <w:t xml:space="preserve"> — ${conf} — © ${year} Yunit. ${rights}. — ${page}&#160;</w:t>
    </w:r>
    <w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>
    <w:r><w:t xml:space="preserve">&#160;/&#160;</w:t></w:r>
    <w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>1</w:t></w:r></w:fldSimple>
  </w:p>
</w:ftr>`;
}

function para(text) {
  return `<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr>
    <w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function xmlEsc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
