/* Template-preserving CS writer. ExcelJS API (identical in browser and Node). */
(function (root) {
'use strict';
const clone = o => JSON.parse(JSON.stringify(o || {}));
const FIRST_BODY_ROW = 8;               // verified: rows 1-7 are title, header, vendor block in CS.xlsx

function readPrototypes(ws) {
  return {
    section: [1, 2, 3].map(c => clone(ws.getCell(8, c).style)),    // row 8  = merged section row (fill D9E1F2)
    body:    [1, 2, 3].map(c => clone(ws.getCell(9, c).style)),    // row 9  = ordinary requirement row
  };
}

function fillTemplate(wb, model) {
  // model: { title, sheets:[{layout, rows:[{type:'section'|'row'|'sw', ...}]}] }
  const ws = wb.getWorksheet('CS');
  if (!ws) throw new Error("Template worksheet 'CS' not found");
  const proto = readPrototypes(ws);

  // 1) title: only A1 text changes (A1:C1 stays merged and styled)
  ws.getCell('A1').value = model.title;

  // 2) clear the skeleton below the vendor block (rows >= 8): un-merge, wipe values and styles
  ws.model.merges.slice().forEach(m => { const r = parseInt(String(m).match(/\d+/)[0], 10); if (r >= FIRST_BODY_ROW) ws.unMergeCells(m); });
  const last = Math.max(ws.rowCount, 71);
  for (let r = FIRST_BODY_ROW; r <= last; r++) { const row = ws.getRow(r); row.height = undefined; for (let c = 1; c <= 4; c++) { const cell = row.getCell(c); cell.value = null; cell.style = {}; } }

  // 3) write rows  (column A = the point's own headline; the URS requirement becomes a sub-heading row when it has 2+ labelled points)
  let r = FIRST_BODY_ROW;
  const sectionRow = t => { const row = ws.getRow(r); [1, 2, 3].forEach(c => { row.getCell(c).style = clone(proto.section[c - 1]); }); row.getCell(1).value = t; ws.mergeCells(r, 1, r, 3); r++; };
  // Normalize only the text written into Requirement (A) and Description (B).
  const stripNum = value => String(value == null ? '' : value)
    .replace(/^\s*\d{1,3}(?:\.\d{1,3})*[.)]?\s+/, '');
  const tidy = value => stripNum(value)
    .replace(/\.\s*\/\s*/g, '/')
    .replace(/[\s.:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const isMarker = value => /^(?:\([A-Za-z0-9]{1,3}\)|[A-Za-z][.)]|\(?[ivx]{1,4}\)?[.)]?|\d{1,3}[.)]|[•\-–—*])$/i.test(String(value || '').trim());
  const isSentence = value => {
    const text = String(value || '').trim();
    return text.split(/\s+/).filter(Boolean).length > 10 || /\.$/.test(text);
  };
  const requirementText = (fallback, source) => {
    const parent = source && (source.parent || source.parentRequirement) || '';
    const candidates = source ? [source.label, source.group] : [];
    let label = '';
    for (const candidate of candidates) {
      const raw = String(candidate == null ? '' : candidate).trim();
      const cleaned = tidy(raw);
      if (!cleaned || isMarker(raw) || isSentence(raw) ||
          cleaned.toLowerCase() === tidy(parent).toLowerCase()) continue;
      label = cleaned;
      break;
    }
    const result = tidy(label || parent || (source && source.req) || fallback);
    return isMarker(result) ? '' : result;
  };
  const removeLeadingListMarker = value => {
    if (typeof value !== 'string') return value;
    return value.replace(/^\s*(?:\([A-Za-z0-9]{1,3}\)|[A-Za-z][.)]|\(?[ivx]{1,4}\)?[.)]?|\d{1,3}[.)]|[•·●○◦▪■□◆◇❖➢➤➔►▶◊*]|[-–—])\s+/, '');
  };
  const put = (a, b, review, source) => {
    const row = ws.getRow(r);
    const columnA = requirementText(a, source);
    const columnB = removeLeadingListMarker(b);
    [columnA, columnB, ''].forEach((v, i) => { const cell = row.getCell(i + 1); cell.value = v === '' ? null : v; cell.style = clone(proto.body[i]); });
    if (review) {
      const details = [
        'Review against the original URS source.',
        source && source.loc ? 'Location: ' + source.loc : '',
        source && source.minConf != null ? 'Minimum OCR confidence: ' + source.minConf + '%' : '',
        source && source.raw ? 'Extracted source text: ' + String(source.raw).slice(0, 800) : ''
      ].filter(Boolean);
      row.getCell(2).note = details.join('\\n');
    }
    r++;
  };
  for (const sh of model.sheets) {
    const rows = sh.rows;
    for (let i = 0; i < rows.length;) {
      const x = rows[i];
      if (x.type === 'section') { sectionRow(x.title); i++; continue; }
      if (x.type === 'sw') { put(x.id, x.desc + (x.pri ? '  [Priority ' + x.pri + ']' : ''), false, null); i++; continue; }
      // Group only labelled child points that belong to the same parent.
      // Ordinary single-value requirements must stay as normal rows.
      const hasLabel = g => Boolean(String(g.label || '').trim() || String(g.group || '').trim());
      if (hasLabel(x) && x.parent) {
        let j = i + 1;
        while (j < rows.length &&
          rows[j].type === 'row' &&
          rows[j].parent === x.parent &&
          hasLabel(rows[j])) j++;
        const grp = rows.slice(i, j);
        if (grp.length >= 2) {
          sectionRow(x.parent);
          for (const g of grp) {
            const ownLabel = [g.group, g.label].filter(Boolean).join(' – ') || g.req;
            put(ownLabel, g.desc, g.review, g);
          }
        } else {
          // A lone labelled point is not a sub-heading group. Keep its parent
          // and point label together in one ordinary requirement row.
          const point = [x.group, x.label].filter(Boolean).join(' – ') || x.req;
          const fullRequirement = [x.parent, point].filter(Boolean).join(' – ');
          put(fullRequirement, x.desc, x.review, x);
        }
        i = j;
        continue;
      }

      put(x.req, x.desc, x.review, x);
      i++;
    }
  }
  // 4) review notes (hover comments only; no layout change)
  return ws;
}
root.CSBuilder = { fillTemplate, FIRST_BODY_ROW };
if (typeof module !== 'undefined') module.exports = root.CSBuilder;
})(typeof window !== 'undefined' ? window : globalThis);