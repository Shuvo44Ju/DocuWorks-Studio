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
  const put = (a, b, review) => { const row = ws.getRow(r); [a, b, ''].forEach((v, i) => { const cell = row.getCell(i + 1); cell.value = v === '' ? null : v; cell.style = clone(proto.body[i]); }); if (review) row.getCell(2).note = 'Check against the source PDF (low OCR confidence)'; r++; };
  for (const sh of model.sheets) {
    const rows = sh.rows;
    for (let i = 0; i < rows.length;) {
      const x = rows[i];
      if (x.type === 'section') { sectionRow(x.title); i++; continue; }
      if (x.type === 'sw') { put(x.id, x.desc + (x.pri ? '  [Priority ' + x.pri + ']' : '')); i++; continue; }
      let j = i; while (j < rows.length && rows[j].type === 'row' && rows[j].parent === x.parent) j++;
      const grp = rows.slice(i, j), labelled = grp.filter(g => g.label || g.group).length, sub = grp.length >= 2 && labelled >= 2;
      if (sub) sectionRow(x.parent);
      for (const g of grp) put(sub ? ([g.group, g.label].filter(Boolean).join(' – ') || g.parent) : g.req, g.desc, g.review);
      i = j;
    }
  }
  // 4) review notes (hover comments only; no layout change)
  return ws;
}
root.CSBuilder = { fillTemplate, FIRST_BODY_ROW };
if (typeof module !== 'undefined') module.exports = root.CSBuilder;
})(typeof window !== 'undefined' ? window : globalThis);