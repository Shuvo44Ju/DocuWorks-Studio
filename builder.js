/* Builds the exact CS Vendor Feedback workbook layout. */
(function (root) {
'use strict';
function cleanSheetName(value) {
  const base = String(value || 'Equipment').replace(/[\\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim() || 'Equipment';
  return ('CS-' + base).slice(0,31);
}
function safeFilenamePart(value) {
  return String(value || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'');
}
function makeBanner(model) {
  const parts = [];
  if (model.equipmentName) parts.push('CS File of ' + model.equipmentName);
  else parts.push('CS File');
  if (model.department) parts[0] += ' – ' + model.department;
  if (model.ursNumber) parts[0] += '  |  ' + model.ursNumber;
  return parts.join('');
}
function setFont(range, options) {
  range.font = Object.assign({ name: 'Arial' }, options || {});
}
function addMergedText(ws, range, text, style) {
  ws.mergeCells(range);
  const cell = ws.getCell(range.split(':')[0]);
  cell.value = text;
  if (style) Object.assign(cell, style);
  return cell;
}
function setTopBlock(ws, model, lastCol) {
  const lastLetter = 'C';
  addMergedText(ws, 'A1:C1', makeBanner(model), {
    font: { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }
  });
  ws.getRow(1).height = 28;
  return 2;
}
function styleHeader(ws, row, labels, lastCol) {
  labels.forEach((label, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = label;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFB7B7B7' } },
      left: { style: 'thin', color: { argb: 'FFB7B7B7' } },
      bottom: { style: 'thin', color: { argb: 'FFB7B7B7' } },
      right: { style: 'thin', color: { argb: 'FFB7B7B7' } }
    };
  });
  ws.getRow(row).height = 36;
  return row;
}
function styleBodyRow(ws, row, lastCol, isReview) {
  for (let col = 1; col <= lastCol; col++) {
    const cell = ws.getCell(row, col);
    cell.font = { name: 'Arial', size: 10, color: { argb: 'FF222222' } };
    cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFB7B7B7' } },
      left: { style: 'thin', color: { argb: 'FFB7B7B7' } },
      bottom: { style: 'thin', color: { argb: 'FFB7B7B7' } },
      right: { style: 'thin', color: { argb: 'FFB7B7B7' } }
    };
  }
  if (isReview) {
    ws.getCell(row, 1).font = { name: 'Arial', size: 10, color: { argb: 'FF9C6500' }, bold: true };
  }
}
function sectionRow(ws, row, title, lastCol) {
  const lastLetter = lastCol === 5 ? 'E' : 'C';
  ws.mergeCells('A' + row + ':' + lastLetter + row);
  const cell = ws.getCell(row, 1);
  cell.value = title;
  cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF222222' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  ws.getRow(row).height = 20;
}
function parentHeadingRow(ws, row, title, lastCol) {
  const lastLetter = lastCol === 5 ? 'E' : 'C';
  ws.mergeCells('A' + row + ':' + lastLetter + row);
  const cell = ws.getCell(row, 1);
  cell.value = title;
  cell.font = { name: 'Arial', size: 10, bold: true, italic: true, color: { argb: 'FF404040' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } };
  cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
  ws.getRow(row).height = 19;
}
function normalizedHeadingKey(value) {
  return String(value || '').toLocaleLowerCase().replace(/[.。:：;；]+$/g, '').replace(/\s+/g, ' ').trim();
}
function writeStandardSpecOnlyRow(ws, row, item) {
  ws.getCell(row, 1).value = '';
  ws.getCell(row, 2).value = item.desc || '';
  ws.getCell(row, 3).value = null;
  styleBodyRow(ws, row, 3, Boolean(item.review));
  if (item.review) {
    ws.getCell(row, 2).note = [
      item.reviewReason || 'This cell needs verification against the original URS.',
      item.loc ? 'Source: ' + item.loc : '',
      item.minConf != null ? 'Minimum OCR confidence: ' + item.minConf + '%' : '',
      item.raw ? 'OCR source text: ' + item.raw : ''
    ].filter(Boolean).join('\n');
  }
}
function writeStandardBody(ws, startRow, model) {
  let row = startRow;
  let activeParent = '';
  sectionRow(ws, row++, 'Vendor / Product Information', 3);
  for (const label of ['Manufacturer', 'Local Agent', 'Origin', 'Model']) {
    ws.getCell(row, 1).value = label;
    ws.getCell(row, 2).value = 'NA';
    ws.getCell(row, 3).value = null;
    styleBodyRow(ws, row, 3, false);
    row++;
  }
  for (const sheet of model.sheets || []) {
    const items = sheet.rows || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type === 'section') {
        sectionRow(ws, row++, item.title || 'Section', 3);
        activeParent = '';
        continue;
      }
      if (item.type !== 'row' && item.type !== 'sw') continue;
      const parent = String(item.parentRequirement || '').trim();
      if (parent !== activeParent) {
        if (parent) parentHeadingRow(ws, row++, parent, 3);
        activeParent = parent;
      }
      const req = String(item.req || item.id || '').trim();
      const key = normalizedHeadingKey(req);
      let end = i + 1;
      while (key && end < items.length &&
        (items[end].type === 'row' || items[end].type === 'sw') &&
        normalizedHeadingKey(items[end].req || items[end].id || '') === key) end++;

      // Repeated labels are kept as a compact specification group:
      // first row carries the label + first specification; following rows
      // keep the specification only. This matches the CS template style.
      if (key && end - i > 1) {
        for (let j = i; j < end; j++) {
          const child = items[j];
          const childReq = j === i ? req : '';
          ws.getCell(row, 1).value = childReq;
          ws.getCell(row, 2).value = child.desc || '';
          ws.getCell(row, 3).value = null;
          styleBodyRow(ws, row, 3, Boolean(child.review));
          if (child.review) {
            ws.getCell(row, 2).note = [
              child.reviewReason || 'This cell needs verification against the original URS.',
              child.loc ? 'Source: ' + child.loc : '',
              child.minConf != null ? 'Minimum OCR confidence: ' + child.minConf + '%' : '',
              child.raw ? 'OCR source text: ' + child.raw : ''
            ].filter(Boolean).join('\n');
          }
          row++;
        }
        i = end - 1;
        continue;
      }

      ws.getCell(row, 1).value = req;
      ws.getCell(row, 2).value = item.desc || '';
      ws.getCell(row, 3).value = null;
      styleBodyRow(ws, row, 3, Boolean(item.review));
      if (item.review) {
        ws.getCell(row, 2).note = [
          item.reviewReason || 'This cell needs verification against the original URS.',
          item.loc ? 'Source: ' + item.loc : '',
          item.minConf != null ? 'Minimum OCR confidence: ' + item.minConf + '%' : '',
          item.raw ? 'OCR source text: ' + item.raw : ''
        ].filter(Boolean).join('\n');
      }
      row++;
    }
  }
  return row - 1;
}
function writeSoftwareBody(ws, startRow, model) {
  let row = startRow;
  let activeParent = '';
  for (const sheet of model.sheets || []) {
    for (const item of sheet.rows || []) {
      if (item.type === 'section') {
        sectionRow(ws, row++, item.title || 'Sub-section', 5);
        activeParent = '';
        continue;
      }
      if (item.type !== 'row' && item.type !== 'sw') continue;
      const parent = String(item.parentRequirement || '').trim();
      if (parent !== activeParent) {
        if (parent) parentHeadingRow(ws, row++, parent, 5);
        activeParent = parent;
      }
      const description = [item.req, item.desc].filter(Boolean).join(item.req && item.desc ? '\n' : '');
      ws.getCell(row, 1).value = item.requirementId || item.id || '';
      ws.getCell(row, 2).value = description;
      ws.getCell(row, 3).value = item.priority || '';
      ws.getCell(row, 4).value = null;
      ws.getCell(row, 5).value = null;
      styleBodyRow(ws, row, 5, Boolean(item.review));
      if (item.review) {
        ws.getCell(row, 2).note = [
          item.reviewReason || 'This cell needs verification against the original URS.',
          item.loc ? 'Source: ' + item.loc : '',
          item.minConf != null ? 'Minimum OCR confidence: ' + item.minConf + '%' : '',
          item.raw ? 'OCR source text: ' + item.raw : ''
        ].filter(Boolean).join('\n');
      }
      row++;
    }
  }
  return row - 1;
}
function createWorkbook(model) {
  if (!root.ExcelJS || !root.ExcelJS.Workbook) throw new Error('ExcelJS is not available.');
  const workbook = new root.ExcelJS.Workbook();
  const software = String(model.layout || '').toLowerCase() === 'software';
  const lastCol = software ? 5 : 3;
  const ws = workbook.addWorksheet(cleanSheetName(model.equipmentName));
  ws.properties.defaultRowHeight = 18;
  ws.views = [{ showGridLines: false }];
  ws.getRow(1).height = 28;
  if (software) {
    ws.columns = [
      { width: 24 }, { width: 70 }, { width: 18 }, { width: 22 }, { width: 42 }
    ];
  } else {
    ws.columns = [
      { width: 38 }, { width: 78 }, { width: 34 }
    ];
  }
  const headerRow = setTopBlock(ws, model, lastCol);
  const labels = software
    ? ['Requirement ID', 'Requirement Description', 'Priority (1=Regulatory, 2=Business, 3=Desired)', 'Vendor Compliance', 'Vendor Remarks']
    : ['Requirement', 'Incepta Specification / Description', 'Vendor Remarks'];
  styleHeader(ws, headerRow, labels, lastCol);
  const lastDataRow = software
    ? writeSoftwareBody(ws, headerRow + 1, model)
    : writeStandardBody(ws, headerRow + 1, model);
  ws.views = [{
    state: 'frozen',
    ySplit: headerRow,
    xSplit: 0,
    topLeftCell: 'A' + (headerRow + 1),
    showGridLines: false
  }];
  ws.autoFilter = undefined;
  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
  };
  // Professional CS print layout: repeat the title/header band on every page,
  // keep the three columns centered on A4 landscape, and show page numbering.
  ws.pageSetup.printTitlesRow = '1:2';
  ws.pageSetup.horizontalCentered = true;
  ws.pageSetup.showRowColHeaders = false;
  ws.headerFooter.oddFooter = '&LDocuWorks Studio  |  CS File&C&RPage &P of &N';
  ws.headerFooter.evenFooter = '&LDocuWorks Studio  |  CS File&C&RPage &P of &N';

  // Give long specification rows enough vertical room while keeping short rows compact.
  for (let r = 1; r <= lastDataRow; r++) {
    const values = [ws.getCell(r, 1).value, ws.getCell(r, 2).value, ws.getCell(r, 3).value]
      .map(v => String(v == null ? '' : v));
    const longest = Math.max(...values.map(v => v.length));
    if (r > 2 && longest > 95) {
      ws.getRow(r).height = Math.min(78, Math.max(30, Math.ceil(longest / 95) * 18));
    } else if (r > 2 && longest > 48) {
      ws.getRow(r).height = 30;
    }
  }
  // Do not add source/page numbering to the generated CS sheet.
  ws.printArea = 'A1:' + (software ? 'E' : 'C') + lastDataRow;
  return { workbook, worksheet: ws, lastRow: lastDataRow, sheetName: ws.name, layout: software ? 'software' : 'equipment' };
}
function getFilename(model) {
  const equipment = safeFilenamePart(model.equipmentName);
  const urs = safeFilenamePart(model.ursNumber);
  const parts = [equipment, urs].filter(Boolean);
  return 'CS_' + (parts.length ? parts.join('_') : 'Output') + '.xlsx';
}
root.CSBuilder = { createWorkbook, getFilename, cleanSheetName, makeBanner };
if (typeof module !== 'undefined') module.exports = root.CSBuilder;
})(typeof window !== 'undefined' ? window : globalThis);
