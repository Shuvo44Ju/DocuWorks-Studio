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
  let m = t.match(/^([^:=]{1,70}?)\s*([:=])\s*([\s\S]*)$/);
  if (m) {
    const label = m[1].trim(), val = m[3].trim();
    const words = label.split(/\s+/).length;
    // If the right-hand side contains another labelled value (for example,
    // "ID: 4.8 mm, OD: 8.0 mm"), preserve the entire source line in one row.
    const hasSecondPair = /\b[A-Za-z][A-Za-z0-9&/().,_ -]{0,18}\s*[:=]\s*\S/.test(val);
    if (words <= 8 && balanced(label) && !hasSecondPair && !/\d$/.test(label) &&
        !/^(e\.g|i\.e|note)$/i.test(label) && label.length >= 2) {
      return { label: label.replace(/[\s\.]+$/, ''), value: val };
    }
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
function splitSemanticPairs(text) {
  const source = NORM(text);
  const time = source.match(/(\d+(?:\.\d+)?\s*(?:hours?|hrs?)\s*(?:per\s*day|\/\s*day))\s*[,;\/]\s*(\d+(?:\.\d+)?\s*(?:days?|weeks?)\s*(?:per\s*week|\/\s*week))/i);
  if (time) return [
    { label: 'Hours per Day', value: time[1].trim() },
    { label: 'Days per Week', value: time[2].trim() }
  ];

  // Split only well-understood, semantically different pairs. ID + OD describe
  // one combined size and must remain together in a single specification cell.
  const parts = source.split(/[;,]\s*(?=[A-Za-z][A-Za-z0-9 /()_-]{0,18}\s*[:=])/);
  if (parts.length < 2) return [];
  const pairs = parts.map(part => {
    const m = part.match(/^\s*([A-Za-z][A-Za-z0-9 /()_-]{0,18})\s*[:=]\s*(.+?)\s*$/);
    return m ? { sourceLabel: m[1].trim(), value: m[2].trim() } : null;
  });
  if (pairs.some(p => !p)) return [];
  const keys = pairs.map(p => p.sourceLabel.toLowerCase().replace(/[^a-z]/g, ''));
  if (keys.includes('id') && keys.includes('od')) return [];
  const aliases = {
    max: 'Capacity', capacity: 'Capacity', d: 'Readability', readability: 'Readability',
    voltage: 'Voltage', volts: 'Volts', current: 'Current', phase: 'Phase',
    frequency: 'Frequency', temperature: 'Temperature', humidity: 'Relative Humidity'
  };
  if (!keys.every(key => aliases[key])) return [];
  const labels = keys.map(key => aliases[key]);
  if (new Set(labels).size !== labels.length) return [];
  return pairs.map((p, i) => ({ label: labels[i], value: p.value }));
}

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
    const semanticPairs = splitSemanticPairs(txt);
    if (semanticPairs.length >= 2) {
      for (const pair of semanticPairs) {
        out.push({
          req: pair.label,
          desc: pair.value,
          raw: it.text,
          loc,
          parent: '',
          group: '',
          label: pair.label
        });
      }
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
const CANON = ['Description', 'Capacity/Memory', 'Readability', 'Platform Size', 'Utilization', 'Room condition',
  'Design parameters/Dimensions', 'Controlling system', 'Measuring/ Calibration parameters', 'Safety & Alarms',
  'Power failure & recovery', 'Material of construction (MOC)', 'Ink Jet/ USB/ SD Card supported print out option',
  'Electrical requirements', 'Voltage', 'Current', 'Phase', 'Frequency', 'Main services/Utilities',
  'Qualification documents', 'Cleaning requirements', 'Complies 21 CFR part 11 or Data integrity',
  'Document language', 'Calibration & Maintenance support'];
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
const median = a => { const s = a.filter(Number.isFinite).slice().sort((x, y) => x - y); if (!s.length) return null; const mid = Math.floor(s.length / 2); return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2; };

function estimateColumns(pagesLines) {
  const s2 = [], s3 = [], bins = {};
  const tablePages = pagesLines.filter(pg => {
    const t = pg.lines.map(L => L.text).join(' ');
    return /requirements?/i.test(t) && /descriptions?/i.test(t);
  });
  const serialHeader = tablePages.some(pg => {
    const hi = pg.lines.findIndex(L => /requirements?/i.test(L.text) && /descriptions?/i.test(L.text));
    const nearby = pg.lines.slice(Math.max(0,hi-2),Math.min(pg.lines.length,hi+4)).map(L=>L.text).join(' ');
    return /\b(?:sl|sr)\.?\b|\bserial\b/i.test(nearby);
  });
  const ruled = tablePages.map(pg=>pg.columns).filter(c =>
    c && Number.isFinite(c.numberEnd) && Number.isFinite(c.requirementEnd) &&
    c.requirementEnd-c.numberEnd>0.07 && c.numberEnd>0.10 && c.requirementEnd<0.75
  );
  if (serialHeader && ruled.length) {
    // Header words are centered; use actual vertical table rules instead of their x-positions.
    const numberEnd=median(ruled.map(c=>c.numberEnd));
    const requirementEnd=median(ruled.map(c=>c.requirementEnd));
    return {c2:numberEnd+0.02,c3:requirementEnd+0.02};
  }
  for (const { lines, w } of pagesLines) for (const L of lines) {
    const ws=L.words;
    const rn=rowNumberInfo(ws,w);
    if (rn && ws.length>=3 && ws[0].x0 < 0.35*w) {
      const labelStart=ws[rn.parts];
      if (labelStart) s2.push(labelStart.x0/w);
      let bg=0,bi=-1;
      for(let i=rn.parts+1;i<ws.length;i++){
        const gap=ws[i].x0-ws[i-1].x1;
        if(gap>bg){bg=gap;bi=i;}
      }
      if(bi>0 && bg>0.025*w) s3.push(ws[bi].x0/w);
    }
    let prev=null;
    for(const wd of ws){
      if(prev==null || wd.x0-prev>0.03*w){
        const b=Math.round(wd.x0/w*100);
        bins[b]=(bins[b]||0)+1;
      }
      prev=wd.x1;
    }
  }
  let c2=s2.length?median(s2):null;
  let c3=s3.length?median(s3):null;
  const pk=Object.entries(bins).map(([b,c])=>[+b,c]).sort((a,b)=>b[1]-a[1]);
  if(c2==null){
    const p=pk.find(([b,c])=>b>=13&&b<=40&&c>=3);
    c2=p?p[0]/100:0.22;
  }
  if(c3==null){
    const p=pk.find(([b,c])=>b>c2*100+8&&b<=72&&c>=3);
    c3=p?p[0]/100:0.45;
  }
  if(c3<=c2+0.08)c3=Math.min(0.85,c2+0.20);
  return {c2,c3};
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

function isSectionHeadingLine(line) {
  const text = ONE(line && line.text || '').replace(/^\s*\d{1,2}(?:\.\d{1,2})?[.)]?\s*/, '').trim();
  return /^(?:general\s+information|functional(?:\s*\/\s*operational)?\s+requirements?|utility\s+services|validation\s+aspects(?:\s*\/\s*regulatory\s*requirements?)?|maintenance(?:\s*\/\s*(?:yearly\s*)?calibration)?|after\s*sales\s*support|process\s*\/?\s*functional(?:\s*requirements?)?)(?:\s*[:.]?\s*)$/i.test(text);
}
function isTableHeaderLine(line) {
  const text = String(line && line.text || '');
  return /\brequirements?\b/i.test(text) && /\bdescriptions?\b/i.test(text);
}
function labelValueLine(text) {
  // Start a new description-cell row at any "Label: value" / "Label = value"
  // line. splitLabelValue() later decides whether the line contains multiple
  // labelled values that must remain together as one specification.
  return /^[A-Za-z][^:=]{1,65}\s*[:=]\s*\S/.test(String(text || '').trim());
}
function canonicalSpan(words) {
  if (!words || !words.length) return null;
  const text = words.map(w => w.t).join(' ');
  const compact = alnum(text);
  let best = null;
  for (const label of CANON) {
    const key = alnum(label);
    if (key.length >= 5 && compact.startsWith(key)) {
      let end = 0, accumulated = '';
      while (end < words.length && accumulated.length < key.length) {
        accumulated += alnum(words[end].t);
        end++;
      }
      if (accumulated.length >= key.length && (!best || end > best.end)) best = { label, end };
    }
  }
  return best;
}
function estimateBlockColumns(lines, pageWidth) {
  const w = Math.max(1, pageWidth || 1);
  const headers = (lines || []).filter(isTableHeaderLine);
  const numbered = [], canonical = [], gapStarts = [], lineStarts = [];
  let headerBounds = null;

  if (headers.length) {
    const h = headers[0].words || [];
    const reqIndex = h.findIndex(x => /^(?:requirements?|requirement)$/i.test(x.t.replace(/[.:]/g,'')));
    const descIndex = h.findIndex(x => /^(?:descriptions?|description)$/i.test(x.t.replace(/[.:]/g,'')));
    if (reqIndex >= 0 && descIndex > reqIndex) {
      const serialIndex = h.findIndex(x => /^(?:sl|sr|serial)$/i.test(x.t.replace(/[.:]/g,'')));
      const reqX = h[reqIndex].x0;
      const descX = h[descIndex].x0;
      headerBounds = {
        b1: serialIndex >= 0 ? Math.max(0, (h[serialIndex].x1 + reqX) / 2) : Math.max(0, reqX - w * 0.02),
        b2: Math.min(w, Math.max(reqX + w * 0.08, descX - w * 0.015)),
        numbered: serialIndex >= 0,
        source: 'header'
      };
    }
  }

  for (const line of (lines || [])) {
    if (!line || !line.words || !line.words.length || isSectionHeadingLine(line) || isTableHeaderLine(line)) continue;
    const words = line.words;
    const rn = rowNumberInfo(words, w);
    if (rn && words.length >= rn.parts + 2) {
      const labelStart = words[rn.parts].x0;
      let bestGap = 0, bestIndex = -1;
      for (let i = rn.parts + 1; i < words.length; i++) {
        const gap = words[i].x0 - words[i - 1].x1;
        if (gap > bestGap) { bestGap = gap; bestIndex = i; }
      }
      if (bestIndex > rn.parts && bestGap > w * 0.018) {
        numbered.push({ label: labelStart, desc: words[bestIndex].x0, gap: bestGap });
      }
    }

    const span = canonicalSpan(words);
    if (span) {
      const labelStart = words[0].x0;
      const labelEnd = words[Math.max(0, span.end - 1)].x1;
      let bestGap = 0, desc = null;
      for (let i = span.end; i < words.length; i++) {
        const gap = words[i].x0 - (i === span.end ? labelEnd : words[i - 1].x1);
        if (gap > bestGap) { bestGap = gap; desc = words[i].x0; }
      }
      canonical.push({ label: labelStart, desc: bestGap > w * 0.018 ? desc : null, gap: bestGap });
    }

    if (words.length >= 2) {
      lineStarts.push(words[0].x0);
      let bestGap = 0, bestIndex = -1;
      for (let i = 1; i < words.length; i++) {
        const gap = words[i].x0 - words[i - 1].x1;
        if (gap > bestGap) { bestGap = gap; bestIndex = i; }
      }
      if (bestIndex > 0 && bestGap > w * 0.035) gapStarts.push(words[bestIndex].x0);
    }
  }

  const med = values => median(values.filter(Number.isFinite));
  if (headerBounds) return headerBounds;

  let labelStart = null, descStart = null, source = 'block-text';
  if (numbered.length) {
    labelStart = med(numbered.map(x => x.label));
    descStart = med(numbered.map(x => x.desc));
    source = 'numbered-rows-in-block';
  } else if (canonical.length) {
    labelStart = med(canonical.map(x => x.label));
    const descValues = canonical.filter(x => x.desc != null).map(x => x.desc);
    descStart = descValues.length ? med(descValues) : null;
    source = 'canonical-labels-in-block';
  }

  if (labelStart == null && lineStarts.length) labelStart = med(lineStarts);
  if (descStart == null && gapStarts.length) descStart = med(gapStarts);

  // One-page / partial URS files often omit the Sl. No. column and its header.
  // Infer the two content columns from repeated label starts and the gaps in this block only.
  if (labelStart == null) labelStart = w * 0.12;
  if (descStart == null || descStart <= labelStart + w * 0.07) {
    descStart = Math.max(labelStart + w * 0.24, w * 0.48);
  }
  const b1 = Math.max(0, Math.min(w * 0.55, labelStart - w * 0.015));
  const b2 = Math.max(b1 + w * 0.08, Math.min(w * 0.94, descStart - w * 0.01));
  return { b1, b2, numbered: numbered.length > 0, source };
}

function parsePages(pages) {
  const pl = pages.map((p, i) => ({
    w: p.w, h: p.h, idx: i + 1, lines: groupLines(p.words)
  }));
  const out = [], fullText = [], processedPages = [];
  let cur = null, sectionNumber = 0, stop = false, activeSection = '';

  const flush = () => {
    if (!cur) return;
    const label = ONE(cur.label.join(' '));
    const items = [];
    let prev = null;
    for (const ln of cur.lines) {
      const docRef = /^\(?[A-Z]{2,}\/[A-Z0-9\/\-]{5,}\)?$/.test(ln.text);
      const startsLabelValue = labelValueLine(ln.text);
      const startsNew = !docRef && (!prev || hasMarker(ln.text) || ln.bullet ||
        startsLabelValue || /:$/.test(prev.text) || prev.x1 < ln.R - 0.07 * ln.w);
      if (startsNew) items.push({ text: ln.text, li: !!ln.bullet || new RegExp('^\\s*[' + BUL + ']\\s').test(ln.text) });
      else items[items.length - 1].text += ' ' + ln.text;
      prev = ln;
    }
    const confs = cur.lines.map(l => l.conf).filter(x => x != null);
    const minConf = confs.length ? Math.round(Math.min(...confs)) : null;
    const confidence = confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : null;
    buildRows(label, items, 'page ' + cur.page).forEach(r => {
      const junk = alRatio(r.desc) < 0.45 || (r.desc && r.desc.length < 2);
      const uncertain = minConf != null && minConf < 80;
      out.push({
        type: 'row', req: r.req, desc: r.desc, raw: r.raw, loc: r.loc,
        parent: r.parent, group: r.group, label: r.label,
        conf: confidence, minConf,
        review: uncertain || junk || !label || !r.desc,
        reviewReason: uncertain ? 'One or more OCR words in this cell have confidence below 80%. Verify the exact text and values against the scan.' :
          (!r.desc ? 'The description/value cell could not be read confidently.' : (junk ? 'The extracted cell contains very little readable text.' : ''))
      });
    });
    cur = null;
  };

  const parseBlock = (pg, blockLines) => {
    if (!blockLines.length || stop) return;
    let lines = blockLines.filter(L => !/^format\s*no/i.test(L.text) &&
      !(L.yc > 0.965 * pg.h && /page|format/i.test(L.text)) &&
      !/^(prepared\s*by|reviewed\s*by|approved\s*by|authorised\s*by|authorized\s*by)\b/i.test(L.text));
    if (!lines.length) return;

    const hi = lines.findIndex(isTableHeaderLine);
    const headerLines = hi >= 0 ? [lines[hi]] : [];
    if (hi >= 0) lines = lines.slice(hi + 1);
    const bounds = estimateBlockColumns(headerLines.concat(lines), pg.w);
    const b1 = bounds.b1 == null ? pg.w * 0.04 : bounds.b1;
    const b2 = bounds.b2;
    const lineHeights = lines.flatMap(L => L.words.map(x => x.h)).filter(x => x > 0).sort((a, b) => a - b);
    const typicalLineHeight = lineHeights.length ? lineHeights[Math.floor(lineHeights.length / 2)] : 10;
    const hasAnyRowSignal = lines.some(L => {
      const rn = rowNumberInfo(L.words, pg.w);
      const content = L.words.filter(x => x.x0 >= b1 && x.x0 < b2).map(x => x.t).join(' ');
      return !!rn || startsLikeCanon(content) || !!canonicalSpan(L.words);
    });
    if (!hasAnyRowSignal && !headerLines.length) return;
    if (!processedPages.includes(pg.idx)) processedPages.push(pg.idx);

    const rightEdges = lines.flatMap(L => L.words.filter(x => x.x0 >= b2).map(x => x.x1)).sort((a,b)=>a-b);
    const R = rightEdges.length ? rightEdges[Math.floor(rightEdges.length * 0.95)] : pg.w * 0.95;

    for (const L of lines) {
      if (/revision\s*history/i.test(L.text)) { flush(); stop = true; break; }
      const ws = L.words || [];
      if (!ws.length) continue;
      const rn = rowNumberInfo(ws, pg.w);
      const hasNum = !!rn && ws[0].x0 < b1;
      const col2w = ws.filter((x,i) => x.x0 >= b1 && x.x0 < b2 && !(hasNum && i < rn.parts));
      const c3w = ws.filter(x => x.x0 >= b2);
      let col2 = col2w.map(x => x.t).join(' ').trim();

      if (!col2 && !hasNum && canonicalSpan(ws)) {
        const span = canonicalSpan(ws);
        col2 = ws.slice(0, span.end).map(x => x.t).join(' ').trim();
      }

      const labelAnchor = !!col2 && (startsLikeCanon(col2) || !!canonicalSpan(col2w));
      const genericRowLabel = !!col2 && col2.split(/\s+/).length <= 9 && c3w.length > 0;
      const isNewLabel = labelAnchor || (genericRowLabel && (!cur || cur.lines.length > 0));

      if (hasNum) {
        if (cur && (cur.hasLabel || cur.lines.length)) flush();
        cur = { num: rn.value, label: [], lines: [], hasLabel: false, page: pg.idx, lastLabelY: null };
      } else if (cur && col2 && cur.hasLabel && cur.lines.length) {
        const pageBoundaryLabel = cur.page < pg.idx;
        const separatedLabel = cur.lastLabelY != null && (L.y0 - cur.lastLabelY) > typicalLineHeight * 1.4;
        if (labelAnchor || genericRowLabel || pageBoundaryLabel || separatedLabel) flush();
      }

      if (!cur && (hasNum || col2 || c3w.length)) {
        cur = { num: null, label: [], lines: [], hasLabel: false, page: pg.idx, lastLabelY: null };
      }
      if (!cur) continue;

      if (col2) {
        cur.label.push(col2);
        cur.hasLabel = true;
        cur.lastLabelY = L.y0;
      }

      if (c3w.length) {
        let tw = c3w.slice(), bullet = false;
        if (tw.length > 1 && tw[0].t.length === 1 && /^[^A-Za-z0-9\(]$|^[eo©®»«]$/.test(tw[0].t) &&
            (tw[0].x1 - tw[0].x0) < 0.025 * pg.w && tw[1].x0 - tw[0].x1 < 0.04 * pg.w) {
          bullet = true; tw = tw.slice(1);
        }
        const txt = tw.map(x => x.t).join(' ').trim();
        if (txt) cur.lines.push({
          text: txt, x1: Math.max(...tw.map(x => x.x1)), bullet, R, w: pg.w,
          conf: avgConf(tw), minConf: tw.some(x=>x.conf!=null) ? Math.min(...tw.map(x=>x.conf==null?100:x.conf)) : null
        });
      } else if (col2 && !cur.lines.length && !cur.num) {
        // A single-column OCR line with a label is retained for review rather than dropped.
        cur.lines.push({ text: '', x1: col2w.length ? Math.max(...col2w.map(x=>x.x1)) : L.x1, bullet: false, R, w: pg.w, conf: avgConf(col2w), minConf: 100 });
      }
    }
  };

  for (const pg of pl) {
    pg.lines.forEach(L => fullText.push(L.text));
    if (stop || !pg.lines.length) continue;

    const headingIndexes = [];
    pg.lines.forEach((L, i) => { if (isSectionHeadingLine(L)) headingIndexes.push(i); });
    let cursor = 0;
    for (const index of headingIndexes) {
      if (index > cursor) parseBlock(pg, pg.lines.slice(cursor, index));
      flush();
      const headingLine = pg.lines[index];
      const raw = ONE(headingLine.text).replace(/[\s.:]+$/, '');
      const numberMatch = raw.match(/^\s*(\d{1,2})[.)]?\s*/);
      const title = raw.replace(/^\s*\d{1,2}[.)]?\s*/, '').trim();
      sectionNumber = numberMatch ? Number(numberMatch[1]) : sectionNumber + 1;
      activeSection = (numberMatch ? numberMatch[1] : String(sectionNumber)) + '. ' + title;
      out.push({ type: 'section', title: activeSection });
      cursor = index + 1;
    }
    if (cursor < pg.lines.length) parseBlock(pg, pg.lines.slice(cursor));
  }
  flush();
  return {
    rows: out, text: fullText.join('\n'), pageCount: pages.length,
    processedPages, pagesWithContent: processedPages.length,
    stoppedAtRevisionHistory: stop
  };
}
root.CSCore = { NORM, ONE, buildRows, splitLabelValue, cleanLabel, extractMeta, prepHtml, parseDocxDocument, parsePages, estimateColumns, estimateBlockColumns, groupLines, snapLabel };
if (typeof module !== 'undefined') module.exports = root.CSCore;
})(typeof window !== 'undefined' ? window : globalThis);