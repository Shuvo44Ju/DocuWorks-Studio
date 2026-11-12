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
  const lastLetter = lastCol === 5 ? 'E' : 'D';
  addMergedText(ws, 'A1:' + lastLetter + '1', makeBanner(model), {
    font: { name: 'Arial', size: 13, bold: true, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }
  });
  ws.getRow(1).height = 28;

  addMergedText(ws, 'A2:' + lastLetter + '2',
    'VENDOR FEEDBACK SHEET AGAINST USER REQUIREMENT SPECIFICATION (URS)', {
      font: { name: 'Arial', size: 12, bold: true, color: { argb: 'FF1F4E78' } },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }
    });
  ws.getRow(2).height = 24;

  const info = [
    ['Equipment Name', model.equipmentName],
    ['URS No.', model.ursNumber],
    ['Ref. Doc. No.', model.referenceDocumentNumber],
    ['Version No.', model.version],
    ['Department', model.department]
  ].filter(pair => String(pair[1] || '').trim());

  let row = 3;
  for (const [label, value] of info) {
    ws.mergeCells('A' + row + ':B' + row);
    ws.mergeCells('C' + row + ':' + lastLetter + row);
    ws.getCell('A' + row).value = label;
    ws.getCell('C' + row).value = value;
    setFont(ws.getCell('A' + row), { size: 10, bold: true, color: { argb: 'FF333333' } });
    setFont(ws.getCell('C' + row), { size: 10, color: { argb: 'FF333333' } });
    ws.getRow(row).height = 19;
    row++;
  }
  row++;
  const instruction = 'Instructions to Vendor: Review each requirement and fill in the Vendor Compliance (\'Comply\' / \'Partial Comply\' / \'Not Comply\') and the Vendor Remarks / Deviation & Justification column.';
  const instructionCell = addMergedText(ws, 'A' + row + ':' + lastLetter + row, instruction, {
    font: { name: 'Arial', size: 9, italic: true, color: { argb: 'FF777777' } },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true }
  });
  instructionCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  ws.getRow(row).height = 32;
  return row + 2;
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
  const lastLetter = lastCol === 5 ? 'E' : 'D';
  ws.mergeCells('A' + row + ':' + lastLetter + row);
  const cell = ws.getCell(row, 1);
  cell.value = title;
  cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF222222' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  ws.getRow(row).height = 20;
}
function writeStandardBody(ws, startRow, model) {
  let row = startRow;
  sectionRow(ws, row++, 'Vendor / Product Information', 4);
  for (const label of ['Manufacturer', 'Local Agent', 'Origin', 'Model']) {
    ws.getCell(row, 1).value = label;
    ws.getCell(row, 2).value = 'NA';
    ws.getCell(row, 3).value = null;
    ws.getCell(row, 4).value = null;
    styleBodyRow(ws, row, 4, false);
    row++;
  }
  for (const sheet of model.sheets || []) {
    for (const item of sheet.rows || []) {
      if (item.type === 'section') {
        sectionRow(ws, row++, item.title || 'Section', 4);
        continue;
      }
      if (item.type !== 'row' && item.type !== 'sw') continue;
      const req = item.req || item.id || '';
      const desc = item.desc || '';
      ws.getCell(row, 1).value = req;
      ws.getCell(row, 2).value = desc;
      ws.getCell(row, 3).value = null;
      ws.getCell(row, 4).value = null;
      styleBodyRow(ws, row, 4, Boolean(item.review));
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
  for (const sheet of model.sheets || []) {
    for (const item of sheet.rows || []) {
      if (item.type === 'section') {
        sectionRow(ws, row++, item.title || 'Sub-section', 5);
        continue;
      }
      if (item.type !== 'row' && item.type !== 'sw') continue;
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
  const lastCol = software ? 5 : 4;
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
      { width: 34 }, { width: 52 }, { width: 18 }, { width: 38 }
    ];
  }
  const headerRow = setTopBlock(ws, model, lastCol);
  const labels = software
    ? ['Requirement ID', 'Requirement Description', 'Priority (1=Regulatory, 2=Business, 3=Desired)', 'Vendor Compliance', 'Vendor Remarks']
    : ['Requirement', 'Incepta Specification / Description', 'Vendor Compliance (Comply / Partial / Not Comply)', 'Vendor Remarks / Offered Specification / Deviation & Justification (if any)'];
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
  ws.headerFooter = { oddFooter: '&CPage &P of &N' };
  ws.printArea = 'A1:' + (software ? 'E' : 'D') + lastDataRow;
  return { workbook, worksheet: ws, lastRow: lastDataRow, sheetName: ws.name, layout: software ? 'software' : 'equipment' };
}
function getFilename(model) {
  const equipment = safeFilenamePart(model.equipmentName) || 'Equipment';
  const urs = safeFilenamePart(model.ursNumber) || 'URS';
  return 'CS_' + equipment + '_' + urs + '.xlsx';
}
root.CSBuilder = { createWorkbook, getFilename, cleanSheetName, makeBanner };
if (typeof module !== 'undefined') module.exports = root.CSBuilder;
})(typeof window !== 'undefined' ? window : globalThis);
