# test_cases.md

All cases below are REAL: outputs of `reference/core.js`. Cases 1-4 come from `URS_Biosafety_Cabinet.docx`; cases 5-7 were run on `URS_Sterile_Tubing_Welder.pdf` (born-digital) and `URS_BOD_Incubator.pdf` (scan, Tesseract CLI at 200 dpi). Re-run them before trusting them.

## Case 1 (DOCX table)
- Source text: `None`
- Location: None
- Column A: `Room condition – Room temperature`
- Column B: `25±10°C`
- Target: sheet CS, columns A/B of the next free body row (row number assigned at write time)

## Case 2 (DOCX table)
- Source text: `None`
- Location: None
- Column A: `Design parameters/ Dimensions – External Dimensions (W x D x H) (Including support stand)`
- Column B: `1645 mm × 1057 mm × 2200 mm`
- Target: sheet CS, columns A/B of the next free body row (row number assigned at write time)

## Case 3 (DOCX table)
- Source text: `None`
- Location: None
- Column A: `Utilization`
- Column B: `The Biosafety Cabinet will be used 90 days per year to ensure safety of from surrounding environment having potentially biohazard materials.`
- Target: sheet CS, columns A/B of the next free body row (row number assigned at write time)

## Case 4 (DOCX table)
- Source text: `None`
- Location: None
- Column A: `Design parameters/ Dimensions – Airflow Volume – Inflow`
- Column B: `432 cmh (254 cfm)`
- Target: sheet CS, columns A/B of the next free body row (row number assigned at write time)

## Case 5 (born-digital PDF, table row 1.2 with 9 tube sizes)
- Source: `ID: 4.8 mm, OD: 8.0 mm` (one of 9 bullets)
- Output: A = `Capacity/Memory`, B = `ID: 4.8 mm, OD: 8.0 mm` (9 rows). A naive colon split made 'ID' the label; fixed by the 'second Label: inside value => do not split' rule.

## Case 6 (scanned PDF, rows 2.5 and 2.6 had no readable row number)
- Source: `Power failure & recovery` -> `UPS system`; `Material of construction (MOC)` -> `NA`
- Output: two separate rows. Earlier version merged them into one; fixed by 'number + label on same line starts a new row' and fuzzy matching against the canonical label list.

## Case 7 (scanned PDF, OCR misread)
- Source (true value from the image): `111L`; OCR read `RIL`, confidence below 80.
- Expected behaviour: keep the OCR text, mark the row review=true (cell note), never guess. Also `23±2 °C` was read as `2342 °C` (UNRESOLVED, flagged).

## Known edge cases to test next (UNCERTAIN: not run)
- In-browser pdf.js + tesseract.js (all tests above used Node/CLI equivalents).
- Skewed/rotated scans; a table row split across two pages (code carries the open row over pages); URS with two documents in one PDF (software ID table inside a PDF is NOT parsed).
- PDFs whose embedded text layer is garbled OCR (code should detect missing keywords like 'Requirements', 'Descriptions' and OCR instead; this check is described but not yet implemented in the reference code).
