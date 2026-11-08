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
    .replace(/^\s*(?:\d{1,3}(?:\.\d{1,3})+[.)]?|\d{1,3}[.)])\s+/, '');
  const tidy = value => stripNum(value)
    .replace(/\.\s*\/\s*/g, '/')
    .replace(/[\s.:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const isMarker = value => /^(?:\([A-Za-z0-9]{1,3}\)|[A-Za-z][.)]|\(?[ivx]{1,4}\)?[.)]?|\d{1,3}[.)]|[•\-–—*])$/i.test(String(value || '').trim());
  const isSentence = value => {
    const text = String(value || '').trim();
    return text.split(/\s+/).filter(Boolean).length > 10 ||
      /[.!?]$/.test(text) ||
      /\b(?:shall|should|must|will|would|can|may|is|are|was|were|has|have|had)\b/i.test(text);
  };
  const requirementText = (fallback, source) => {
    const parent = source && (source.parentDisplay || source.parentRequirement || source.parent || '') || '';
    const isChild = Boolean(source && (source.parentDisplay || source.parameterized));
    // A child row must never fall back to its parent or to an uncleaned raw
    // requirement. Check every possible label source through the same guard.
    const candidates = source
      ? [fallback, source.label, source.group, source.req]
      : [fallback];
    let label = '';
    for (const candidate of candidates) {
      const raw = String(candidate == null ? '' : candidate).trim();
      const cleaned = stripParentPrefix(tidy(raw), parent);
      if (!cleaned || isMarker(raw) || isSentence(cleaned) ||
          (parent && cleaned.toLowerCase() === tidy(parent).toLowerCase())) continue;
      label = cleaned;
      break;
    }
    // For a child, blank is safer than accidentally writing the parent title
    // into Column A. The merged parent heading is written separately.
    const result = isChild ? label : tidy(label || (source && source.req) || '');
    return isMarker(result) ? '' : result;
  };
  const removeLeadingListMarker = value => {
    if (typeof value !== 'string') return value;
    return value.replace(/^\s*(?:\([A-Za-z0-9]{1,3}\)|[A-Za-z][.)]|[ivx]{1,4}[.)]|\d{1,3}[.)]|[•·●○◦▪■□◆◇❖➢➤➔►▶◊*]|[-–—])\s+/, '');
  };
  const isRealLabel = (value, parent) => {
    const raw = String(value == null ? '' : value).trim();
    const cleaned = tidy(raw);
    if (!cleaned || isMarker(raw) || isSentence(raw) ||
        cleaned.toLowerCase() === tidy(parent).toLowerCase() ||
        cleaned.split(/\s+/).filter(Boolean).length > 10) return '';
    return cleaned;
  };
  const labelledPairs = value => {
    const text = String(value == null ? '' : value).trim();
    if (!text) return [];
    // Semicolons and label-led new lines are the only split boundaries.
    // Commas and additional colons inside a value remain untouched.
    const parts = text.split(/;\s*|\r?\n(?=[^:\r\n]{2,90}\s*:)/)
      .map(part => part.trim()).filter(Boolean);
    const pairs = parts.map(part => {
      const colon = part.indexOf(':');
      if (colon < 2) return null;
      const firstLabel = isRealLabel(part.slice(0, colon), '');
      const firstValue = part.slice(colon + 1).trim();
      if (firstLabel && firstValue) return { label: firstLabel, specification: firstValue };

      // A sentence-like introduction may precede a real pair in the same
      // cell, such as "The room ... environment: Room temperature: NMT 25°C".
      // Discard only that non-label introduction and retain the actual pair.
      const nestedColon = firstValue.indexOf(':');
      if (nestedColon > 1) {
        const nestedLabel = isRealLabel(firstValue.slice(0, nestedColon), '');
        const nestedValue = firstValue.slice(nestedColon + 1).trim();
        if (nestedLabel && nestedValue) return { label: nestedLabel, specification: nestedValue };
      }
      return null;
    });
    return pairs.length && pairs.every(Boolean) ? pairs : [];
  };
  const parentInfo = source => {
    if (!source) return { title: '', key: '' };
    const explicitParent = source.parentRequirement || source.parent || '';
    // In the AI output, req may be the numbered requirement while parent is
    // only the broader document section. Use the explicit parent for known
    // child rows, otherwise use the row's own requirement name.
    const rawTitle = source.parameterized || source.label || source.group
      ? (explicitParent || source.req || '')
      : (source.req || explicitParent || '');
    const title = tidy(rawTitle);
    const numberSource = String(rawTitle || '');
    const number = numberSource.match(/^\s*(\d{1,3}(?:\.\d{1,3})+)[.)]?\s+/);
    return { title, key: number ? 'number:' + number[1] : 'title:' + title.toLowerCase() };
  };
  const rowParent = source => source && source.parentDisplay || parentInfo(source).title;
  const rowParentKey = source => source && source.parentKey || parentInfo(source).key;
  const stripParentPrefix = (label, parent) => {
    let child = tidy(label);
    const parentText = tidy(parent);
    if (!child || !parentText) return child;
    // Strip repeated parent prefixes and common hierarchy separators. This
    // rule is generic and does not depend on any particular URS heading.
    const separators = ' \t.:/\\|>→–—-';
    while (child.toLowerCase().startsWith(parentText.toLowerCase())) {
      const remainder = child.slice(parentText.length);
      if (remainder && !separators.includes(remainder[0])) break;
      let offset = 0;
      while (offset < remainder.length && separators.includes(remainder[offset])) offset++;
      child = remainder.slice(offset).trim();
      if (!child) return '';
    }
    return child;
  };
  const rowLabel = source => {
    if (!source) return '';
    const parent = source.parentDisplay || source.parentRequirement || source.parent || parentInfo(source).title;
    return stripParentPrefix(
      isRealLabel(source.label, parent) || isRealLabel(source.group, parent) || '',
      parent
    );
  };
  const prepareRows = inputRows => {
    const output = [];
    const rows = inputRows || [];
    const hierarchyPrefix = source => {
      if (!source || source.type !== 'row' || source.parameterized ||
          source.parentDisplay || source.parentRequirement || source.label || source.group) return null;
      const raw = String(source.req || '').trim();
      const match = raw.match(/^(.+?)\s+(?:[-–—]|→|>|[|])\s+(.+)$/);
      if (!match) return null;
      const parent = tidy(match[1]);
      const child = isRealLabel(match[2], parent);
      if (!parent || !child || parent.split(/\s+/).length > 12) return null;
      return {
        parent,
        child,
        key: parent.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      };
    };
    const makeChild = (source, parent, child, key) => ({
      ...source,
      req: child,
      label: child,
      group: '',
      parent,
      parentDisplay: parent,
      parentRequirement: parent,
      parentKey: 'inferred:' + key,
      parameterized: true
    });
    const isContinuationPair = source => {
      if (!source || source.type !== 'row' || source.parameterized ||
          source.parentDisplay || source.parentRequirement || source.label || source.group) return false;
      const label = tidy(source.req || '');
      const value = String(source.desc == null ? '' : source.desc).trim();
      const words = value.split(/\s+/).filter(Boolean);
      if (!label || !value || label.split(/\s+/).length > 7 || words.length > 10) return false;
      if (/\b(shall|should|must|will|would|can|may|is|are|was|were|has|have|had|ensures?|requires?|provides?)\b/i.test(value)) return false;
      return true;
    };

    // Some AI responses flatten a hierarchy into repeated "Parent - Child"
    // requirement strings. Rebuild the parent only when the same prefix is
    // repeated in at least two adjacent rows, so ordinary hyphenated labels
    // remain untouched.
    for (let i = 0; i < rows.length;) {
      const first = hierarchyPrefix(rows[i]);
      if (!first) {
        output.push(rows[i]);
        i++;
        continue;
      }
      let j = i;
      const group = [];
      while (j < rows.length) {
        const candidate = hierarchyPrefix(rows[j]);
        if (!candidate || candidate.key !== first.key) break;
        group.push({ source: rows[j], child: candidate.child });
        j++;
      }
      if (group.length < 2) {
        output.push(rows[i]);
        i++;
        continue;
      }

      for (const item of group) output.push(makeChild(item.source, first.parent, item.child, first.key));

      // A parent cell may continue on the next page with blank serial/requirement
      // cells. Keep concise label/value continuation rows under that parent
      // until the next full prose requirement or another parent group.
      while (j < rows.length && isContinuationPair(rows[j]) && !hierarchyPrefix(rows[j])) {
        const next = rows[j];
        output.push(makeChild(next, first.parent, tidy(next.req), first.key));
        j++;
      }
      i = j;
    }

    const prepared = [];
    for (const source of output) {
      if (!source || source.type !== 'row') {
        prepared.push(source);
        continue;
      }
      const pairs = labelledPairs(source.desc);
      if (!pairs.length) {
        prepared.push(source);
        continue;
      }
      const info = parentInfo(source);
      if (!info.title) {
        prepared.push(source);
        continue;
      }
      for (const pair of pairs) {
        prepared.push({
          ...source,
          req: pair.label,
          desc: pair.specification,
          parent: info.title,
          parentDisplay: info.title,
          parentKey: info.key,
          parentRequirement: info.title,
          group: '',
          label: pair.label,
          parameterized: pairs.length > 1 || Boolean(source.parameterized)
        });
      }
    }
    return prepared;
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
    const rows = prepareRows(sh.rows);
    for (let i = 0; i < rows.length;) {
      const x = rows[i];
      if (x.type === 'section') { sectionRow(x.title); i++; continue; }
      if (x.type === 'sw') { put(x.id, x.desc + (x.pri ? '  [Priority ' + x.pri + ']' : ''), false, null); i++; continue; }

      const label = rowLabel(x);
      const parent = rowParent(x);
      const parentKey = rowParentKey(x);
      if (label && parent) {
        let j = i + 1;
        while (j < rows.length &&
          rows[j].type === 'row' &&
          rowParentKey(rows[j]) === parentKey &&
          rowLabel(rows[j])) j++;
        const group = rows.slice(i, j);
        if (group.length >= 2) {
          // Use the most informative available parent title when the same
          // numbered requirement continues on another page with a shorter title.
          const heading = group.map(rowParent).sort((a, b) => b.length - a.length)[0] || parent;
          sectionRow(tidy(heading));
          for (const item of group) put(rowLabel(item), item.desc, item.review, item);
        } else {
          // A single labelled value remains a normal row; no parent heading.
          put(label, x.desc, x.review, x);
        }
        i = j;
        continue;
      }

      // For a normal one-value requirement, use its own requirement name.
      put(x.req || x.parent || '', x.desc, x.review, x);
      i++;
    }
  }
  // 4) review notes (hover comments only; no layout change)
  return ws;
}
root.CSBuilder = { fillTemplate, FIRST_BODY_ROW };
if (typeof module !== 'undefined') module.exports = root.CSBuilder;
})(typeof window !== 'undefined' ? window : globalThis);