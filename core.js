/* CS core: URS -> rows. Works in browser and Node. */
(function (root) {
'use strict';

const NORM = s => String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/[ \t\r\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
const ONE  = s => NORM(s).replace(/\n+/g, ' ');

/* ---------- markers / labels ---------- */
const BUL = '•·●○◦▪■□◆◇❖➢➤➔►▶◊\\*\\-–—';
const MARKER_RE = new RegExp('^\\s*(?:[' + BUL + ']|\\(?[A-Za-z]{1,3}\\)|\\(?[ivxIVX]{1,4}\\)|\\(?\\d{1,2}\\)|\\d{1,2}\\.|[ivxIVX]{1,4}\\.|[a-zA-Z]\\.)\\s+');
function hasMarker(s) { return MARKER_RE.test(s); }
function listMarker(s) { return hasMarker(s) && !/^\s*\d{1,2}\.\s/.test(s); }
function cleanMarker(s) {
  let t = NORM(s);
  for (let i = 0; i < 2; i++) t = t.replace(MARKER_RE, '').trim();
  return t;
}
function cleanLabel(s) {
  return ONE(s)
    .replace(/\s*\(\s*min[^)]{0,12}max\s*range\s*\)?\s*/ig, ' ')
    .replace(/\.\s*\/\s*/g, '/ ').replace(/\/ $/, '/')
    .replace(/[\s\.:]+$/, '').replace(/\s+/g, ' ').trim();
}

/* ---------- label : value splitting ---------- */
function balanced(s) { return (s.match(/\(/g) || []).length === (s.match(/\)/g) || []).length; }
function splitLabelValue(text) {
  const t = NORM(text);
  let m = t.match(/^([^:]{1,70}?)\s*:\s*([\s\S]*)$/);
  if (m) {
    const label = m[1].trim(), val = m[2].trim();
    const words = label.split(/\s+/).length;
    if (words <= 8 && balanced(label) && !/\b[A-Za-z]{1,4}\s*:\s*\S/.test(val) && !/\d$/.test(label) && !/^(e\.g|i\.e|note)$/i.test(label) && label.length >= 2)
      return { label: label.replace(/[\s\.]+$/, ''), value: cleanMarker(val) };
  }
  m = t.match(/^([A-Z][A-Za-z&\/\-' ()]{1,48}?)\s+((?:[<>≤≥±~≈]\s*)?\d[\s\S]*)$/);
  if (m) {
    const label = m[1].trim(), w = label.split(/\s+/);
    if (w.length <= 6 && balanced(label) && !/\b(shall|should|will|must|can|is|are|be|been|being|used|provided)\b/i.test(label) && !/\b(shall|should|will|must|can|is|are|be|by|for|of|to|with|and|or|the|in|at)$/i.test(label))
      return { label, value: m[2].trim() };
  }
  return { label: '', value: t };
}

/* items: [{text, li}]  ->  [{req, desc}] */
function sameAs(a, b) { return alnum0(a) && alnum0(a) === alnum0(b); }
function alnum0(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function buildRows(parent, items, loc) {
  const out = [];
  let group = '';
  const list = items.map(i => ({ text: NORM(i.text), li: !!i.li })).filter(i => i.text);
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const txt = cleanMarker(it.text);
    if (!txt) continue;
    // Preserve incomplete-looking lines; PDF extraction can split real requirements across visual lines.
    // group heading: ends with ':'
    if (/:$/.test(txt)) {
      const h = txt.replace(/:$/, '').trim();
      group = h.split(/\s+/).length <= 4 ? h : '';
      continue;
    }
    // bullet heading followed by plain value lines
    const next = list[i + 1];
    if (it.li && !/:/.test(txt) && next && !next.li && !listMarker(next.text) && txt.split(/\s+/).length <= 16) {
      group = txt;
      let j = i + 1;
      while (j < list.length && !list[j].li && !listMarker(list[j].text)) {
        const sv = splitLabelValue(cleanMarker(list[j].text));
        out.push({ req: [parent, group, sv.label].filter(Boolean).join(' – '), desc: sv.value, raw: list[j].text, loc, parent, group, label: sv.label });
        j++;
      }
      i = j - 1; group = '';
      continue;
    }
    const sv = splitLabelValue(txt);
    if (sameAs(sv.label, parent)) sv.label = '';
    out.push({ req: [parent, group, sv.label].filter(Boolean).join(' – '), desc: sv.value, raw: it.text, loc, parent, group, label: sv.label });
  }
  if (!out.length && parent) out.push({ req: parent, desc: '', raw: '', loc, parent, group: '', label: '' });
  // single plain row with label e.g. "Capacity: 620gm" keep as is
  return out;
}

/* ---------- header info ---------- */
function pick(text, re) { const m = text.match(re); return m ? ONE(m[1]).replace(/^[\s:|\-]+|[\s|]+$/g, '') : ''; }
function extractMeta(text) {
  const t = String(text || '');
  const stop = '(?=\\s*(?:\\||\\n|URS\\s*No|Ver(?:sion|sion)\\s*No|Page\\s|Ref\\.?\\s*Doc|User\\s*Department|NAME OF|EFFECTIVE|$))';
  const equipment = pick(t, new RegExp('(?:Facility\\s*\\/\\s*Utility\\s*\\/\\s*)?Equipment\\s*(?:\\/\\s*System\\s*)?Name\\s*:?\\s*\\|?\\s*([^|\\n]{2,90}?)' + stop, 'i'))
    || pick(t, /EQUIPMENT\s*\/?\s*SYSTEM\s*NAME\s*:?\s*\|?\s*([^|\n]{2,90})/i);
  const urs = pick(t, new RegExp('URS\\s*No\\.?\\s*:?\\s*\\|?\\s*([A-Z0-9][A-Za-z0-9\\/\\-\\._]{3,40})', 'i'));
  const ref = pick(t, new RegExp('Ref\\.?\\s*Doc\\.?\\s*No\\.?\\s*:?\\s*\\|?\\s*([A-Za-z0-9][A-Za-z0-9\\/\\-\\._]{3,40})', 'i'));
  const ver = pick(t, /Version\s*(?:No\.?|Number)\s*:?\s*\|?\s*(\d{1,3})\b/i);
  const dept = pick(t, new RegExp('(?:NAME\\s*OF\\s*THE\\s*USER\\s*DEPARTMENT|User\\s*Department\\s*\\/?\\s*(?:Section)?)\\s*:?\\s*\\|?\\s*([^|\\n]{2,60}?)' + stop, 'i'));
  const doc = pick(t, /Document\s*N(?:o|umber)\.?\s*:?\s*\|?\s*([A-Z0-9][A-Za-z0-9\/\-\._]{5,40})/i);
  const bad = v => !v || /^(version|ver|page|no\b)/i.test(v);
  let eq = equipment;
  if (!eq) eq = pick(t, /User\s*Requirements?\s*of\s*([^|\n]{3,80})/i).replace(/\s*(Application\s*System)\s*$/i, ' $1');
  let dp = dept; if (/^[\/\s]*section/i.test(dp) || !/^[A-Za-z]/.test(dp)) dp = '';
  return { equipment: eq, ursNo: bad(urs) ? (doc || '') : urs, refNo: bad(ref) ? '' : ref.replace(/\.$/, ''), version: ver, department: dp, docNo: doc };
}

/* ---------- DOCX (structured) ---------- */
function prepHtml(h) {
  return String(h)
    .replace(/<sup>\s*[0oO°]\s*<\/sup>/g, '°').replace(/<sup>\s*2\s*<\/sup>/g, '²').replace(/<sup>\s*3\s*<\/sup>/g, '³')
    .replace(/<sub>\s*2\s*<\/sub>/g, '₂').replace(/<br\s*\/?>/gi, '\n');
}
function cellItems(cell) {
  const items = [];
  const walk = node => {
    for (const ch of Array.from(node.childNodes)) {
      if (ch.nodeType === 3) { const t = NORM(ch.textContent); if (t) t.split('\n').forEach(x => x.trim() && items.push({ text: x.trim(), li: false })); continue; }
      if (ch.nodeType !== 1) continue;
      const tag = ch.tagName;
      if (tag === 'P') NORM(ch.textContent).split('\n').forEach(x => x.trim() && items.push({ text: x.trim(), li: false }));
      else if (tag === 'UL' || tag === 'OL') Array.from(ch.children).forEach(li => {
        NORM(li.textContent).split('\n').forEach((x, k) => x.trim() && items.push({ text: x.trim(), li: tag === 'UL' && k === 0 }));
      });
      else if (tag === 'TABLE') Array.from(ch.rows).slice(1).forEach(tr => {
        const t = Array.from(tr.cells).map(c => ONE(c.textContent)).filter(Boolean).join(': ');
        if (t) items.push({ text: t, li: false });
      });
      else walk(ch);
    }
  };
  walk(cell);
  return items;
}
const ctext = c => ONE(c.textContent);

function parseDocxDocument(doc) {
  const eqRows = [], swRows = [];
  let sec = 0;
  const tables = Array.from(doc.querySelectorAll('table')).filter(t => !t.parentElement.closest('table'));
  for (const tb of tables) {
    const rows = Array.from(tb.rows);
    if (rows.length < 2) continue;
    const head = Array.from(rows[0].cells).map(ctext);
    const hl = head.map(h => h.toLowerCase());
    const iDesc = hl.findIndex(h => /description/.test(h));
    const iReq = hl.findIndex(h => /requirement/.test(h) && !/description/.test(h));
    const iPri = hl.findIndex(h => /priority/.test(h));
    if (iDesc < 0) continue;
    const out = [];
    let last = '';
    if (iPri >= 0) {                                   // software layout
      const iId = hl.findIndex(h => /(number|\bid\b)/.test(h));
      for (const tr of rows.slice(1)) {
        const cells = Array.from(tr.cells), ne = cells.filter(c => ctext(c));
        if (!ne.length) continue;
        if (cells.length === 1 || ne.length === 1) { out.push({ type: 'section', title: ONE(ne[0].textContent) }); continue; }
        out.push({ type: 'sw', id: ctext(cells[iId < 0 ? 0 : iId]), desc: ctext(cells[iDesc]), pri: ctext(cells[iPri]) });
      }
      swRows.push(...out);
      continue;
    }
    if (iReq < 0) continue;
    for (const tr of rows.slice(1)) {
      const cells = Array.from(tr.cells), ne = cells.filter(c => ctext(c));
      if (!ne.length) continue;
      const first = ctext(cells[0]);
      const onlyFirst = ne.length === 1 && ne[0] === cells[0];
      const numOnly = /^\d{1,2}\.?$/.test(first);
      if (cells.length === 1 || (onlyFirst && !numOnly) || (numOnly && ne.length === 2 && !ctext(cells[iDesc] || cells[cells.length - 1]))) {
        let title = numOnly ? ctext(ne[1]) : first;
        title = title.replace(/[\s\.:]+$/, '');
        if (!/^\d{1,2}[\.\)]?\s/.test(title)) title = (numOnly ? first.replace(/\.$/, '') : (++sec)) + '. ' + title; else sec++;
        out.push({ type: 'section', title }); last = ''; continue;
      }
      let label = cleanLabel(cells[iReq].textContent);
      if (!label) label = last; else last = label;
      const items = cellItems(cells[iDesc]);
      buildRows(label, items, 'table row').forEach(r => out.push(Object.assign({ type: 'row' }, r)));
    }
    eqRows.push(...out);
  }
  const sheets = [];
  if (eqRows.some(r => r.type === 'row')) sheets.push({ layout: 'equipment', rows: eqRows });
  if (swRows.some(r => r.type === 'sw')) sheets.push({ layout: 'software', rows: swRows });
  return sheets;
}

/* ---------- PDF / OCR (geometry) ---------- */
const CANON = ['Description', 'Capacity/Memory', 'Utilization', 'Room condition', 'Design parameters/Dimensions',
  'Controlling system', 'Measuring/ Calibration parameters', 'Safety & Alarms', 'Power failure & recovery',
  'Material of construction (MOC)', 'Ink Jet/ USB/ SD Card supported print out option', 'Electrical requirements',
  'Main services/Utilities', 'Qualification documents', 'Cleaning requirements',
  'Complies 21 CFR part 11 or Data integrity', 'Document language', 'Calibration & Maintenance support'];
const alnum = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let p = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
  return p[n];
}
function snapLabel(s) {
  const a = alnum(s); if (a.length < 5) return s;
  let best = null, bd = 1;
  for (const c of CANON) { const b = alnum(c); const d = lev(a, b) / Math.max(a.length, b.length); if (d < bd) { bd = d; best = c; } }
  return bd <= 0.2 ? best : s;
}
function startsLikeCanon(s) {          // does this col2 text begin a canonical label?
  const a = alnum(s); if (a.length < 7) return false;
  for (const c of CANON) {
    const b = alnum(c), k = Math.min(a.length, b.length);
    if (k >= 7 && lev(a.slice(0, k), b.slice(0, k)) / k <= 0.18 && a.length >= Math.min(b.length, 9)) return true;
  }
  return false;
}

function groupLines(words) {
  const ws = words.filter(w => w.t && String(w.t).trim()).map(w => ({ t: String(w.t).trim(), conf: (w.conf == null ? null : w.conf), x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1, yc: (w.y0 + w.y1) / 2, h: w.y1 - w.y0 }));
  if (!ws.length) return [];
  const hs = ws.map(w => w.h).sort((a, b) => a - b), hm = hs[Math.floor(hs.length / 2)] || 10;
  ws.sort((a, b) => a.yc - b.yc);
  const lines = [];
  for (const w of ws) {
    const L = lines[lines.length - 1];
    if (L && Math.abs(w.yc - L.yc) <= hm * 0.6) { L.words.push(w); L.yc = L.words.reduce((s, x) => s + x.yc, 0) / L.words.length; }
    else lines.push({ words: [w], yc: w.yc });
  }
  for (const L of lines) {
    L.words.sort((a, b) => a.x0 - b.x0);
    L.y0 = Math.min(...L.words.map(w => w.y0)); L.y1 = Math.max(...L.words.map(w => w.y1));
    L.x0 = L.words[0].x0; L.x1 = Math.max(...L.words.map(w => w.x1));
    L.text = L.words.map(w => w.t).join(' ');
  }
  return lines;
}
const ROWNUM = /^\d{1,2}\.\d{1,2}\.?$/;
const SECKEY = /^(general\s*information|functional|utility\s*services|validation\s*aspects|maintenance|after\s*sales|process\/?\s*functional)/i;
const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

function estimateColumns(pagesLines) {
  const header2 = [], header3 = [], s2 = [], s3 = [];
  for (const { lines, w } of pagesLines) for (const L of lines) {
    const ws = L.words;
    if (/requirement/i.test(L.text) && /description/i.test(L.text)) {
      const ri = ws.findIndex(x => /^requirements?$/i.test(x.t));
      const di = ws.findIndex(x => /^descriptions?$/i.test(x.t));
      if (ri >= 0) header2.push(ws[ri].x0 / w);
      if (di >= 0) header3.push(ws[di].x0 / w);
    }
    if (ws.length < 3 || !ROWNUM.test(ws[0].t) || ws[0].x0 > 0.35 * w) continue;
    s2.push(ws[1].x0 / w);
    let bg = 0, bi = -1;
    for (let i = 2; i < ws.length; i++) { const g = ws[i].x0 - ws[i - 1].x1; if (g > bg) { bg = g; bi = i; } }
    if (bi > 0 && bg > 0.03 * w) s3.push(ws[bi].x0 / w);
  }
  let c2 = header2.length ? median(header2) : median(s2);
  let c3 = header3.length ? median(header3) : median(s3);
  if (s2.length < 3 && !header2.length) c2 = null;
  if (s3.length < 3 && !header3.length) c3 = null;
  if (c2 == null || c3 == null) {
    const bins = {};
    for (const { lines, w } of pagesLines) for (const L of lines) {
      let prev = null;
      for (const wd of L.words) { if (prev == null || wd.x0 - prev > 0.03 * w) { const b = Math.round(wd.x0 / w * 100); bins[b] = (bins[b] || 0) + 1; } prev = wd.x1; }
    }
    const pk = Object.entries(bins).map(([b, c]) => [+b, c]).sort((a, b) => b[1] - a[1]);
    if (c2 == null) { const p = pk.find(([b, c]) => b >= 13 && b <= 40 && c >= 3); c2 = p ? p[0] / 100 : 0.22; }
    if (c3 == null) { const p = pk.find(([b, c]) => b > c2 * 100 + 8 && b <= 70 && c >= 3); c3 = p ? p[0] / 100 : 0.45; }
  }
  if (c3 <= c2 + 0.08) c3 = Math.min(0.85, c2 + 0.20);
  return { c2, c3 };
}

const avgConf = ws => { const c = ws.map(x => x.conf).filter(x => x != null); return c.length ? c.reduce((a, b) => a + b, 0) / c.length : null; };
const alRatio = t => { t = String(t || ''); return t ? (t.match(/[A-Za-z0-9]/g) || []).length / t.length : 0; };
function rowNumberInfo(words, pageWidth) {
  if (!words || !words.length) return null;
  if (ROWNUM.test(words[0].t)) return { parts: 1, value: words[0].t };
  if (/^\d{1,2}\.$/.test(words[0].t) && words[1] && /^\d{1,2}\.?$/.test(words[1].t) &&
      words[1].x0 - words[0].x1 < pageWidth * 0.025) {
    return { parts: 2, value: words[0].t + words[1].t };
  }
  return null;
}

function parsePages(pages) {
  const pl = pages.map((p, i) => ({ w: p.w, h: p.h, idx: i + 1, lines: groupLines(p.words) }));
  const { c2, c3 } = estimateColumns(pl);
  const out = [], fullText = [], processedPages = [];
  let cur = null, sec = 0, tableStarted = false, stop = false;
  const createCurrent = page => ({ num: null, label: [], lines: [], hasLabel: false, page, lastLabelY: null });
  const flush = () => {
    if (!cur) return;
    const label = snapLabel(cleanLabel(cur.label.join(' ')));
    const items = [];
    let prev = null;
    for (const ln of cur.lines) {
      ln.text = ln.text.replace(/(\d)\s+[0⁰]\s*C\b/g, '$1°C').replace(/(\d)\s*[⁰º]\s*C\b/g, '$1°C');
      const docRef = /^\(?[A-Z]{2,}\/[A-Z0-9\/\-]{5,}\)?$/.test(ln.text);
      const startNew = !docRef && (!prev || hasMarker(ln.text) || ln.bullet || /:$/.test(prev.text) || prev.x1 < ln.R - 0.07 * ln.w);
      if (startNew) items.push({ text: ln.text, li: !!ln.bullet || new RegExp('^\\s*[' + BUL + ']\\s').test(ln.text) });
      else items[items.length - 1].text += ' ' + ln.text;
      prev = ln;
    }
    const confs = cur.lines.map(l => l.conf).filter(x => x != null);
    const conf = confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : null;
    const minConf = confs.length ? Math.round(Math.min(...confs)) : null;
    buildRows(label, items.map(i => ({ text: i.text, li: i.li })), 'page ' + cur.page).forEach(r => {
      const junk = alRatio(r.desc) < 0.55 || (r.desc && r.desc.length < 2);
      out.push({ type: 'row', req: r.req, desc: r.desc, raw: r.raw, loc: r.loc,
        parent: r.parent, group: r.group, label: r.label, conf, minConf,
        review: (minConf != null && minConf < 80) || junk });
    });
    cur = null;
  };

  for (const pg of pl) {
    const { w, h, lines } = pg;
    lines.forEach(L => fullText.push(L.text));
    if (stop || !lines.length) continue;

    const hi = lines.findIndex(L => /requirement/i.test(L.text) && /description/i.test(L.text));
    const hasNumberedRow = lines.some(L => {
      const rn = rowNumberInfo(L.words, w);
      return !!rn && L.words[0].x0 < 0.35 * w;
    });
    if (hi >= 0 || hasNumberedRow) tableStarted = true;
    // A continued table page may have neither a repeated header nor row number.
    if (!tableStarted) continue;

    let cut = hi >= 0 ? lines[hi].y1 : -1;
    if (hi < 0) {
      const vi = lines.findIndex(L => /version/i.test(L.text) && L.yc < 0.3 * h);
      if (vi >= 0 && !hasNumberedRow) cut = lines[vi].y1;
    }
    const b1 = (c2 - 0.02) * w, b2 = (c3 - 0.02) * w;
    const body = lines.filter(L => L.y0 > cut - 1 && !/^format\s*no/i.test(L.text) &&
      !(L.yc > 0.94 * h && /page|format/i.test(L.text)));
    const continuationLines = body.filter(L => {
      const rn = rowNumberInfo(L.words, w);
      return !!rn || L.words.some(x => x.x0 >= b1);
    });
    if (hi < 0 && !hasNumberedRow && !continuationLines.length) continue;
    processedPages.push(pg.idx);

    const rs = body.flatMap(L => L.words.filter(x => x.x0 >= b2).map(x => x.x1)).sort((a, b) => a - b);
    const R = rs.length ? rs[Math.floor(rs.length * 0.95)] : w * 0.95;
    const lineHeights = body.flatMap(L => L.words.map(x => x.h)).filter(x => x > 0).sort((a, b) => a - b);
    const typicalLineHeight = lineHeights.length ? lineHeights[Math.floor(lineHeights.length / 2)] : 10;

    for (const L of body) {
      if (/revision\s*history/i.test(L.text)) { flush(); stop = true; break; }
      if (/^(prepared\s*by|reviewed\s*by|approved\s*by|authorised\s*by|authorized\s*by)\b/i.test(L.text) && !rowNumberInfo(L.words, w)) continue;

      const ws = L.words;
      const first = ws[0];
      const rn = rowNumberInfo(ws, w);
      const hasNum = !!rn && first.x0 < b1;
      const col2w = ws.filter(x => x.x0 >= b1 && x.x0 < b2);
      const c3w = ws.filter(x => x.x0 >= b2);
      const col2 = col2w.map(x => x.t).join(' ');

      const restText = ws.slice(rn ? rn.parts : 1).map(x => x.t).join(' ');
      const numTok = /^\d{1,2}\.?$/.test(first.t) && first.x0 < b1;
      const secKey = first.x0 < b1 && (SECKEY.test(L.text) || (numTok && SECKEY.test(restText)));
      if (secKey || (numTok && !ROWNUM.test(first.t) && restText && /^[A-Z]/.test(ws[1] ? ws[1].t : '') && c3w.length === 0)) {
        flush();
        let title = L.text.replace(/[\s\.:]+$/, '').replace(/^\d{1,2}\.?\s*/, '');
        title = title.replace(/\s*\/\s*/g, '/ ').replace(/\/ $/, '/').replace(/\s+/g, ' ');
        const km = title.match(/(general\s*information|functional\/?\s*operational\s*requirements|utility\s*services|validation\s*aspects\/?\s*regulatory\s*requirements|maintenance\s*\/?\s*(?:yearly\s*)?calibration|after\s*sales\s*support)/i);
        if (km) title = km[1].replace(/\s*\/\s*/g, '/ ').replace(/\/ $/, '/').replace(/\s+/g, ' ');
        out.push({ type: 'section', title: (++sec) + '. ' + title });
        continue;
      }

      const labelAnchor = col2 && startsLikeCanon(col2);
      if (hasNum) {
        if (cur && (cur.num || cur.hasLabel || cur.lines.length)) flush();
        cur = createCurrent(pg.idx);
        cur.num = rn.value;
      } else {
        const pageBoundaryLabel = !!(cur && cur.page < pg.idx && col2 && cur.hasLabel);
        const separatedLabel = !!(cur && col2 && cur.hasLabel && cur.lines.length &&
          cur.lastLabelY != null && (L.y0 - cur.lastLabelY) > typicalLineHeight * 1.55);
        if (cur && col2 && cur.hasLabel && (labelAnchor || pageBoundaryLabel || separatedLabel)) flush();
      }

      if (!cur && (hasNum || col2 || c3w.length)) cur = createCurrent(pg.idx);
      if (!cur) continue;
      if (col2) {
        cur.label.push(col2);
        cur.hasLabel = true;
        cur.lastLabelY = L.y0;
      }
      if (c3w.length) {
        let bullet = false, tw = c3w.slice();
        if (tw.length > 1 && tw[0].t.length === 1 && /^[^A-Za-z0-9\(]$|^[eo©®»«]$/.test(tw[0].t) &&
            (tw[0].x1 - tw[0].x0) < 0.025 * w && tw[1].x0 - tw[0].x1 < 0.04 * w) { bullet = true; tw = tw.slice(1); }
        const txt = tw.map(x => x.t).join(' ').replace(/^[\|\-–—_]+\s*/, '');
        if (txt) cur.lines.push({ text: txt, x1: Math.max(...tw.map(x => x.x1)), bullet, R, w, conf: avgConf(tw) });
      }
    }
  }
  flush();
  return { rows: out, text: fullText.join('\n'), pageCount: pages.length,
    processedPages, pagesWithContent: processedPages.length, stoppedAtRevisionHistory: stop };
}

root.CSCore = { NORM, ONE, buildRows, splitLabelValue, cleanLabel, extractMeta, prepHtml, parseDocxDocument, parsePages, estimateColumns, groupLines, snapLabel };
if (typeof module !== 'undefined') module.exports = root.CSCore;
})(typeof window !== 'undefined' ? window : globalThis);