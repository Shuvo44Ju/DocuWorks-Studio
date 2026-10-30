# conversion_method.md

## 0. Honest summary (read first)
- VERIFIED: In our chat I did NOT run a deterministic converter. For every URS I (a language model with vision) read the uploaded pages (page images, the embedded text layer when present, or DOCX tables via python-docx/`extract-text`; one scanned PDF I rasterised with `pdftoppm` and read visually), understood each requirement, and wrote a small Python/openpyxl script containing the rows. The accuracy came from reading comprehension plus hand curation, not from keyword rules.
- VERIFIED: that output used my own 4-column layout (Requirement | Spec | Vendor Compliance | Vendor Remarks). Your real template `CS.xlsx` is different (3 columns: Requirement | Incepta Specification / Description | Vendor Feedback). See excel_template_map.md.
- VERIFIED: the live `cs.html` maps URS text to FIXED row numbers using keyword rules and a hard-coded default matrix (inspect the first ~50 lines of its script and lines ~150-260). Any URS that differs from that layout lands in wrong rows. This is the main cause of wrong output.
- VERIFIED: `reference/core.js` + `builder.js` is a rules-based reconstruction I wrote and tested on 20+ real DOCX URS files, one born-digital PDF and one scanned PDF (Node + Tesseract CLI). It is NOT the method I used in chat and will not equal my accuracy on scans.
- UNCERTAIN: browser behaviour of pdf.js and tesseract.js (not run here).

## 1. Pipeline (implemented in reference/)
1. Detect type. DOCX: mammoth -> HTML tables (best accuracy: cells are already separated). PDF: pdf.js text items with x/y boxes; if the text layer lacks 'Requirements'/'Descriptions'/'General Information' (garbled) or is empty, render at ~200 dpi and OCR with tesseract.js (psm 6), keeping word boxes and confidence.
2. Layout: group words into lines by y; find column left edges from lines that start with a row number (1.1, 2.3...) with histogram fallback; assign each word to column 1 (Sl. No), 2 (Requirement), 3 (Description) by x. Cut page headers above the 'Requirements | Descriptions' line, drop 'Format No.' footers, stop at 'Revision History', skip the approval page.
3. Rows: a new URS row starts at a row number, or at a column-2 line that fuzzy-matches the canonical label list (rescues OCR-missed numbers). Open rows carry across pages.
4. Items: inside column 3, a new item starts at a bullet/(a)/(i)/1. marker, after a short line, or after a line ending ':'; full-width lines are wrapped continuations.
5. Rows -> CS rows: see mapping_rules.json (row_rules). Values are copied verbatim; nothing is invented.
6. Metadata: regexes for Equipment Name, URS No., Ref. Doc. No., Version, Department (DOCX headers read from word/header*.xml via JSZip, since mammoth ignores headers). Headline = `CS File of <Equipment> – <Department>  |  <URS No>`.
7. Write: ExcelJS loads CS.xlsx, keeps rows 1-7, un-merges and clears rows 8+, clones row 8 style (sections, merged A:C) and row 9 style (body), writes rows. Library limits: ExcelJS may drop printerSettings and thumbnail; check with validate_template.py. Alternative that never touches the package: SheetJS cannot style, so ExcelJS is recommended.
8. Validate: `validate_template.py` (exit 1 on any template change). Also re-read the output and check every source row appears once.

## 2. Accuracy and traceability
- Each row carries `raw` (source text), `loc` (page or table) and, for OCR, `conf`. Rows with conf < 80 or junk text get `review: true`; write them as Excel cell notes (no layout change). Never guess unreadable values.
- Duplicates: normalise req+desc (lowercase alphanumerics) and drop exact repeats; flag same requirement with different values.
- Mandatory/optional: keep words such as 'optional', 'preferred', 'or equivalent', '<', '>', '±' inside the text.

## 3. Architecture for GitHub Pages
- Browser only (free): pdf.js, tesseract.js, mammoth, ExcelJS. No upload leaves the device (good for confidentiality). Large PDFs: process page by page, free memory between pages.
- Accuracy (honest, UNMEASURED): DOCX very good; born-digital PDF good; scans fair and need review. Perfect conversion is not promised.
- AI option: a Cloudflare Worker (or Vercel function) holds the API key as a secret; the page sends page images to the Worker; the model must return strict JSON in the schema of sample_extraction.json; then the same builder writes Excel. Cost: per-document API usage plus a free Worker tier. Better on scans and wording, still needs review. Do not put keys in cs.html.

## 4. Implementation checklist for ChatGPT
1. Keep index.html and the template. Replace the keyword/fixed-row logic in cs.html with reference/core.js (parse) + reference/builder.js (write). 2. Load CS.xlsx with fetch and ExcelJS. 3. Add JSZip to read DOCX headers. 4. Implement the garbled-text-layer check. 5. Add cell notes for review rows. 6. Run validate_template.py on outputs of at least 5 URS files. 7. Hide all options except Upload and Convert.
Still needed from you: 3-4 URS files with their correct finished CS.xlsx outputs (to measure accuracy), and whether software-URS rows should go on a second sheet.
