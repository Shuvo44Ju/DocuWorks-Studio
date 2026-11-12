const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const MAX_HTML_CHARS = 12 * 1024 * 1024;
const MAX_PAGE_COUNT = 30;

const OUTPUT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    equipmentName: { type: "string" }, ursNumber: { type: "string" },
    referenceDocumentNumber: { type: "string" }, version: { type: "string" },
    department: { type: "string" }, title: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
    layout: { type: "string", enum: ["equipment", "software"] },
    sections: { type: "array", items: {
      type: "object", additionalProperties: false,
      properties: {
        title: { type: "string" },
        requirements: { type: "array", items: {
          type: "object", additionalProperties: false,
          properties: {
            requirement: { type: "string" }, specification: { type: "string" },
            requirementId: { type: "string" }, priority: { type: ["string", "integer"] },
            parentRequirement: { type: "string" }, parameterized: { type: "boolean" },
            sourcePages: { type: "array", items: { type: "integer" } },
            sourceQuote: { type: "string" }, confidence: { type: "number" },
            reviewRequired: { type: "boolean" }, reviewReason: { type: "string" }
          },
          required: ["requirement","specification","sourcePages","sourceQuote","confidence","reviewRequired","reviewReason"]
        }}
      },
      required: ["title","requirements"]
    }}
  },
  required: ["equipmentName","ursNumber","referenceDocumentNumber","version","department","title","warnings","sections"]
};

const SYSTEM_PROMPT = "You are a meticulous URS-to-Commercial Specification (CS) extraction engine. Read the uploaded URS source pages, not the source filename, and return complete structured data for the exact CS Vendor Feedback Sheet layout.\nUse only facts visible in the URS. Never infer the equipment name, department/division, URS number, reference document number, or version from the filename, company logo, or assumptions. Leave metadata empty when the source does not show it.\nPreserve original URS section headings and their order. Do not reorder sections into a standard order. Keep a source heading as a section heading, and exclude page headers, approval/signature tables, revision history, Format No., and page numbers.\nCreate one requirement object for every independent point: each bullet, each (a)/(b)/(i) item, each separate line in a description cell, and each clear 'Label: value' or 'Label = value' pair. Do this even when the source line has no bullet. A short point name goes in requirement; the value or complete sentence goes in specification. If there is no separate point name, use the source URS requirement name as requirement and put the sentence in specification. Remove list markers from the requirement text, not from values.\nUse a concise, clear Title Case requirement label. Never repeat serial numbering such as 2.1 in the requirement label. When a short label is ambiguous, retain its group as 'Group – Label' (for example, 'Design Parameters – Material').\nRead table cells using the visible table grid and their own row/column positions. For a data table (for example capacity, size, readability), create one point per meaningful column heading per table row, with labels in the form 'Table Topic – Column Heading'. Keep all table rows in source order. Do not merge multiple table-row values into one.\nPreserve values exactly as written: numbers, decimals, units, symbols, ±, inequalities, ranges, model numbers, leading zeros, and N/A/NA. Never normalize, convert, round or invent a value. Correct a character only when the source image makes it unmistakably an OCR recognition typo and the intended character is certain; never repair an ambiguous value. For every such correction, add a warnings entry with the source page and both the OCR-read text and the corrected text. If any cell or region is unreadable or ambiguous, keep the closest visible/OCR transcription without guessing, set reviewRequired=true, and explain exactly what is unreadable in reviewReason; also mention the page/cell in warnings. Check printed page numbers: if the first supplied page visibly starts at page 2 or later, or another numbered page is visibly absent from the sequence, add a warnings entry naming the missing page(s). Never claim a page is missing unless printed page numbering proves it.\nIf one source line contains two labelled values with different meanings (for example 'Max=6200 g; d=0.01 g'), create two rows, named 'Capacity' and 'Readability' as appropriate. But when the labels describe two dimensions of one combined item (for example 'ID: 4.8 mm, OD: 8.0 mm'), keep both values together in the same specification and do not drop either value. Separate independent time/quantity pairs such as '24 hours per day' and '07 days per week' into separate points.\nKeep every source sentence, qualification, option, and exception. Do not paraphrase or compress the specification. Preserve source order.\nDetect software/computerised-system URSs. When a source table has Requirement ID and Priority fields, set layout='software'; preserve the exact ID in requirementId, the complete requirement text in requirement, and the priority (1=Regulatory, 2=Business, 3=Desired) in priority. Keep subsection headings and their order. Do not merge the ID or priority into the description.\nFor normal equipment URSs, set layout='equipment'.\nUse sourcePages with the actual 1-based source page. sourceQuote must be a short verbatim excerpt from the correct cell. Confidence is a 0-to-1 estimate of legibility and cell association. Do not report high confidence for an unreadable or ambiguous OCR cell.\nReturn only one JSON object matching the supplied schema. No markdown, commentary, or invented example data."

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return origin === "https://shuvo44ju.github.io" ||
    /^https:\/\/[a-z0-9-]+\.pages\.dev$/i.test(origin) ||
    /^https:\/\/(?:[a-z0-9-]+\.)*[a-z0-9-]+\.workers\.dev$/i.test(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}
function jsonResponse(body, status, origin) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Vary": "Origin"
  });
  if (isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return new Response(JSON.stringify(body), { status, headers });
}
function htmlToPlain(html) {
  return String(html || "").replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(td|th)>/gi, " | ").replace(/<\/tr>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function splitInlineParameterPairs(text) {
  const source = String(text || "").trim();
  if (!/[;\n]/.test(source)) return [];
  // Split only when the next segment looks like another named parameter.
  // Colons inside a value (for example, L: 140±20, W: 400±20) remain intact.
  const parts = source.split(/(?:;\s*|\n+)(?=[A-Za-z][A-Za-z0-9&/().,+ _-]{0,85}\s*[:=])/g)
    .map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return [];
  const pairs = parts.map(part => {
    const separator = part.search(/[:=]/);
    if (separator < 1) return null;
    const label = part.slice(0, separator).trim().replace(/^[•*\-–]+\s*/, "");
    const specification = part.slice(separator + 1).trim();
    if (!label || !specification || label.length > 90 || label.split(/\s+/).length > 12) return null;
    if (/[.!?]$/.test(label) || /\b(shall|should|must|will|whereas|therefore)\b/i.test(label)) return null;
    return { label, specification, sourceQuote: part };
  });
  return pairs.every(Boolean) && pairs.length >= 2 ? pairs : [];
}


const CS_SECTION_ORDER = [
  "1. General Information",
  "2. Functional Requirements",
  "3. Utility Services",
  "4. Validation Aspects / Regulatory Requirements",
  "5. Maintenance / Yearly Calibration"
];
function sectionFromHeading(title) {
  const t = String(title || "").toLowerCase();
  if (/maintenance|after.?sales|yearly calibration/.test(t)) return CS_SECTION_ORDER[4];
  if (/validation|regulatory|qualification/.test(t)) return CS_SECTION_ORDER[3];
  if (/utility|electrical/.test(t)) return CS_SECTION_ORDER[2];
  if (/general information/.test(t)) return CS_SECTION_ORDER[0];
  if (/functional|operational|process/.test(t)) return CS_SECTION_ORDER[1];
  return "";
}
function classifyCsSection(requirement, sourceTitle) {
  const r = String(requirement || "").toLowerCase();
  // Requirement semantics take precedence over a possibly incorrect source heading.
  if (/\bmaintenance\b|after.?sales|service support|spare parts|initial calibration|yearly calibration|annual calibration|calibration support/.test(r)) return CS_SECTION_ORDER[4];
  if (/\bqualification\b|\biq\b|\boq\b|\bpq\b|validation|regulatory|cleaning requirement|document(?:ation| language| control)|21\s*cfr|data integrity|\bgmp\b|\bglp\b/.test(r)) return CS_SECTION_ORDER[3];
  if (/\belectrical\b|\bvolts?\b|\bvoltage\b|\bcurrent\b|\bphase\b|\bfrequency\b|\bhz\b|power supply|power requirement|compressed air|water supply|gas supply|drainage|utility service/.test(r)) return CS_SECTION_ORDER[2];
  if (/\bdescription\b|\bcapacity\b|\breadability\b|platform size|\butilization\b|intended use|room condition|room temperature|relative humidity|\bambient\b|environmental condition/.test(r)) return CS_SECTION_ORDER[0];
  if (/design parameter|working temperature|operating temperature|\bdisplay\b|\bunits?\b|\bkeys?\b|accessor|material of construction|\bmoc\b|safety|alarm|control|printer|measuring|performance|accuracy|calibration parameter|weighing range/.test(r)) return CS_SECTION_ORDER[1];
  const fromHeading = sectionFromHeading(sourceTitle);
  if (fromHeading) return fromHeading;
  return CS_SECTION_ORDER[1];
}
function isCsDocumentFurniture(requirement, specification, sourceTitle) {
  const r = String(requirement || "").replace(/[|:;]+/g, " ").replace(/\s+/g, " ").trim();
  const s = String(specification || "").replace(/\s+/g, " ").trim();
  const h = String(sourceTitle || "").trim();
  if (/vendor\s*\/?\s*product information/i.test(h)) return true;
  // A generic USER REQUIREMENT table title is not itself a requirement. Only
  // remove its row when the paired cell is also recognizably a column heading.
  if (/^(?:user requirements?|user requirement specification|requirements?\s*(?:and|\/|&)\s*descriptions?)$/i.test(h) &&
      (!s || /^(?:description|descriptions|deemer|requirement|requirements?)$/i.test(s))) return true;
  if (/^(?:incepta pharmaceuticals?(?: ltd)?|hygiene division|user requirements?|user requirement specification|requirements?\s*(?:\/|and|&)\s*descriptions?|description\s*\/\s*requirement|manufacturer|local agent|origin|model)$/i.test(r)) return true;
  if (/\b(?:incepta\s+pharmaceuticals|hygiene\s+division)\b/i.test(r + " " + s)) return true;
  if (/^(?:page\s*)?\d+(?:\s+of\s+\d+)?$/i.test(r)) return true;
  if (/^(?:prepared by|reviewed by|approved by|authori[sz]ed by)\b/i.test(r)) return true;
  return false;
}
function normalizeForCsTemplate(data) {
  const sourceSections = Array.isArray(data.sections) ? data.sections : [];
  const software = String(data.layout || "").toLowerCase() === "software" ||
    sourceSections.some(section => (section.requirements || []).some(item =>
      String(item?.requirementId || "").trim() ||
      String(item?.priority == null ? "" : item.priority).trim()
    ));
  data.layout = software ? "software" : "equipment";
  let discardedFurniture = 0;
  const sections = [];

  for (const section of sourceSections) {
    const sourceTitle = String(section?.title || "").trim();
    const requirements = [];
    for (const item of section?.requirements || []) {
      let requirement = String(item?.requirement || "").trim();
      const specification = String(item?.specification || "").trim();
      const parent = String(item?.parentRequirement || "").trim();
      const parentIsSection = /^(?:[1-5][.)]?\s*)?(?:general information|functional requirements|utility services|validation aspects(?:\s*\/\s*regulatory requirements)?|maintenance(?:\s*\/\s*yearly calibration)?)$/i.test(parent);
      if (parent && !parentIsSection && requirement &&
          !requirement.toLowerCase().startsWith(parent.toLowerCase())) {
        requirement = parent + " – " + requirement;
      }
      if (isCsDocumentFurniture(requirement, specification, sourceTitle)) {
        discardedFurniture++;
        continue;
      }
      requirements.push({
        ...item,
        requirement: requirement || "UNRESOLVED REQUIREMENT — REVIEW SOURCE",
        specification,
        parentRequirement: "",
        parameterized: false
      });
    }
    // Do not change the source section title or its order.
    if (requirements.length || sourceTitle) {
      sections.push({ title: sourceTitle, requirements });
    }
  }
  data.sections = sections;
  if (!data.sections.some(section => section.requirements.length)) {
    throw new Error("No substantive requirement rows were found in the URS.");
  }
  if (discardedFurniture) {
    data.warnings = Array.isArray(data.warnings) ? data.warnings : [];
    data.warnings.push("Excluded " + discardedFurniture + " non-requirement header/footer item(s).");
  }
  if (/^(?:urs|user requirements?|user requirement specification|document)$/i.test(String(data.equipmentName || "").trim())) {
    data.equipmentName = "";
  }
  return data;
}
function validateExtraction(value) {
  if (!value || !Array.isArray(value.sections)) throw new Error("The AI response did not include a section list.");
  const safe = { ...value, warnings: Array.isArray(value.warnings) ? value.warnings : [] };
  safe.sections = safe.sections.map((section, si) => ({
    title: String(section?.title || ("Section " + (si + 1))).trim(),
    requirements: (Array.isArray(section?.requirements) ? section.requirements : []).flatMap(item => {
      const c = Number(item?.confidence);
      const base = {
        requirement: String(item?.requirement || "").trim(),
        specification: String(item?.specification || "").trim(),
        requirementId: String(item?.requirementId || "").trim(),
        priority: item?.priority == null ? "" : String(item.priority).trim(),
        parentRequirement: String(item?.parentRequirement || "").trim(),
        parameterized: Boolean(item?.parameterized),
        sourcePages: Array.isArray(item?.sourcePages) ? item.sourcePages.filter(n => Number.isInteger(n) && n > 0).slice(0,100) : [],
        sourceQuote: String(item?.sourceQuote || "").slice(0,1200),
        confidence: Number.isFinite(c) ? Math.max(0,Math.min(1,c)) : 0,
        reviewRequired: Boolean(item?.reviewRequired) || !Number.isFinite(c) || c < 0.8,
        reviewReason: String(item?.reviewReason || "").slice(0,1000)
      };
      // A source cell can contain multiple labeled parameter/value pairs.
      // Expand these into separate rows instead of leaving a semicolon list.
      const pairs = splitInlineParameterPairs(base.specification);
      const timePairs = base.specification.match(/(\d+(?:\.\d+)?\s*(?:hours?|hrs?)\s+per\s+day)[,;\/\n]+(\d+(?:\.\d+)?\s*(?:days?|weeks?)\s+per\s+(?:week|month))/i);
      const labelledPairs = pairs.length >= 2 &&
        !(pairs.some(p => /^id$/i.test(p.label)) && pairs.some(p => /^od$/i.test(p.label)));
      if (labelledPairs) {
        return pairs.map(pair => {
          const alias = pair.label.trim().toLowerCase();
          const capacityOrReadability = /capacity|readability|measuring|weighing/i.test(base.requirement + " " + base.parentRequirement);
          const specialLabel = capacityOrReadability && alias === "max" ? "Capacity" :
            capacityOrReadability && alias === "d" ? "Readability" : "";
          return ({
            ...base,
            requirement: specialLabel || pair.label,
            specification: pair.specification,
            parentRequirement: specialLabel ? "" : (base.parentRequirement || base.requirement),
            parameterized: !specialLabel,
            sourceQuote: pair.sourceQuote.slice(0,1200)
          });
        });
      }
      if (timePairs) {
        return [
          {...base,requirement:"Hours per Day",specification:timePairs[1],parentRequirement:"",parameterized:false},
          {...base,requirement:"Days per Week",specification:timePairs[2],parentRequirement:"",parameterized:false}
        ];
      }
      return [{ ...base, parameterized: Boolean(base.parentRequirement) }];
    }).filter(x => x.requirement || x.specification)
  })).filter(s => s.requirements.length || s.title);
  safe.rowCount = safe.sections.reduce((n,s)=>n+s.requirements.length,0);
  if (safe.rowCount < 1) throw new Error("No requirement/specification rows could be extracted; no workbook was created.");
  return safe;
}

function extractJson(value) {
  // Cloudflare chat-completion responses commonly place the generated
  // text at choices[0].message.content. Keep walking nested objects/arrays
  // so wrappers and typed content parts are not accidentally discarded.
  const seen = new Set();
  function findPayload(input, depth = 0) {
    if (depth > 10 || input == null) return null;
    if (typeof input === "string") return input.trim() ? input : null;
    if (Array.isArray(input)) {
      const parts = input.map(item => findPayload(item, depth + 1))
        .filter(item => typeof item === "string" && item.trim());
      return parts.length ? parts.join("\n") : null;
    }
    if (typeof input !== "object" || seen.has(input)) return null;
    seen.add(input);

    // Already-decoded JSON object from a model/runtime wrapper.
    if (Array.isArray(input.sections)) return input;

    // Check common Workers AI / OpenAI chat response containers in priority order.
    const keys = [
      "response", "result", "output_text", "generated_text",
      "choices", "message", "delta", "text", "content", "output"
    ];
    for (const key of keys) {
      if (!(key in input)) continue;
      const found = findPayload(input[key], depth + 1);
      if (found !== null) return found;
    }
    return null;
  }

  const root = value;
  value = findPayload(root);
  if (value && typeof value === "object" && !Array.isArray(value) &&
      Array.isArray(value.sections)) return value;
  if (typeof value !== "string") {
    const shape = root && typeof root === "object"
      ? Object.keys(root).slice(0, 12).join(", ")
      : (root === null ? "null" : typeof root);
    throw new Error("The AI response contained no text at its expected content fields (top-level response keys: " + (shape || "none") + "). Please retry; no workbook was created.");
  }

  let text = value.trim().replace(/^\uFEFF/, "");
  text = text.replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "").trim();
  // Extract complete JSON objects one at a time. Do not take everything
  // from the first "{" to the last "}", because Gemma may append commentary
  // or another block after the JSON and make that combined slice invalid.
  let lastParseError = null;
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let end = start; end < text.length; end++) {
      const ch = text[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch.charCodeAt(0) === 92) escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, end + 1);
          try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === "object" && Array.isArray(parsed.sections)) {
              return parsed;
            }
          } catch (error) {
            lastParseError = error;
          }
          break;
        }
      }
    }
  }
  const detail = lastParseError && lastParseError.message ? " Last JSON parse issue: " + lastParseError.message : "";
  throw new Error("The AI response did not contain a complete valid extraction JSON object. Extra text outside the JSON is ignored; no usable sections were found." + detail);
}

async function handlePost({ request, env }) {
  const requestStartedAt = Date.now();
  const origin = request.headers.get("Origin") || "";
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: "Origin is not allowed." },403,origin);
  if (!env?.AI || typeof env.AI.run !== "function") return jsonResponse({
    error: "Cloudflare Workers AI is not connected. Deploy the latest Worker configuration with the AI binding enabled."
  },503,origin);

  let form;
  try { form = await request.formData(); }
  catch { return jsonResponse({ error: "Upload must use multipart form data." },400,origin); }
  const formParsedAt = Date.now();
  const fileName = String(form.get("fileName") || "URS document").slice(0,180);
  const documentHtml = String(form.get("documentHtml") || "");
  const pageImagesRaw = String(form.get("pageImages") || "");
  const referenceStructureRaw = String(form.get("referenceStructure") || "");
  const equipmentNameOverride = String(form.get("equipmentNameOverride") || "").trim().slice(0,180);
  const ursNumberOverride = String(form.get("ursNumberOverride") || "").trim().slice(0,100);
  const extension = fileName.toLowerCase().split(".").pop();
  let userContent = [];
  let description = "Read the supplied URS source document only.\n";

  if (extension === "pdf") {
    let pageImages;
    try { pageImages = JSON.parse(pageImagesRaw); }
    catch {
      const legacyPdf = form.get("file");
      return jsonResponse({
        error: legacyPdf
          ? "This browser is using an older URS converter page. Close the old converter tab, open the latest page at https://shuvo44ju.github.io/DocuWorks-Studio/cs.html?ai=free-20261104, press Ctrl+Shift+R, and select the PDF again."
          : "PDF page images are missing. Open the latest converter page at https://shuvo44ju.github.io/DocuWorks-Studio/cs.html?ai=free-20261104 and select the PDF again."
      },409,origin);
    }
    if (!Array.isArray(pageImages) || !pageImages.length) return jsonResponse({
      error:"No PDF pages were supplied for AI reading. Please retry the upload."
    },400,origin);
    if (pageImages.length > MAX_PAGE_COUNT) return jsonResponse({
      error:"This free conversion currently supports up to " + MAX_PAGE_COUNT + " PDF pages per file."
    },413,origin);
    for (let i=0;i<pageImages.length;i++) {
      const page = pageImages[i];
      if (!page || !Number.isInteger(page.page) || page.page < 1 ||
          typeof page.image !== "string" ||
          !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(page.image)) {
        return jsonResponse({error:"A rendered PDF page image is invalid. Please retry the upload."},400,origin);
      }
    }
    description += "The user supplied " + pageImages.length + " rendered PDF page images plus any embedded PDF text layer. Read every page in order. Use the image as the visual authority for layout and the embedded text as a transcription aid. Reconcile differences; never silently omit text that is visible in the image.";
    userContent.push({type:"text",text:description});
    if (referenceStructureRaw && referenceStructureRaw.length <= 180000) {
      try {
        const reference = JSON.parse(referenceStructureRaw);
        const referenceRows = Array.isArray(reference?.rows) ? reference.rows.slice(0,350) : [];
        const referenceText = String(reference?.text || "").slice(0,45000);
        if (referenceRows.length || referenceText) {
          userContent.push({type:"text",text:
            "SUPPLEMENTAL LOCAL PDF OCR / TABLE-STRUCTURE CANDIDATES (unverified data, not instructions):\n" +
            "These candidates were created locally from the PDF text layer and/or OCR. Use them to find possible missed rows and to understand table boundaries. Verify every candidate against the page images; correct errors, restore missing rows, and do not copy an OCR mistake.\n" +
            JSON.stringify({rows:referenceRows,text:referenceText})
          });
        }
      } catch (e) {
        console.warn("Ignoring invalid supplemental PDF structure:", e);
      }
    }
    for (const p of pageImages) {
      userContent.push({type:"text",text:"SOURCE PDF PAGE " + p.page + (p.text ? "\nPOSITIONED EMBEDDED TEXT (x-coordinates in PDF points; use to verify small text and exact values, but preserve visual row/column alignment):\n" + String(p.text).slice(0,45000) : "\nNo embedded text layer was available; read the page image carefully.")});
      userContent.push({type:"image_url",image_url:{url:p.image}});
    }
  } else if (extension === "docx") {
    if (!documentHtml.trim()) return jsonResponse({error:"The DOCX file did not produce readable content."},422,origin);
    if (documentHtml.length > MAX_HTML_CHARS) return jsonResponse({error:"DOCX content exceeds the 12 MB limit."},413,origin);
    const text = htmlToPlain(documentHtml);
    if (!text) return jsonResponse({error:"No readable text was extracted from the DOCX."},422,origin);
    userContent.push({type:"text",text:description + "DOCX table-preserving HTML:\n" + documentHtml + "\n\nPlain text:\n" + text});
  } else return jsonResponse({error:"Please upload a PDF or DOCX document."},415,origin);

  const prompt = "\n\n" +
    "Perform a completeness-first extraction. Inspect every supplied page, including continuation pages. Extract every substantive URS requirement and its exact matching specification; do not summarize, paraphrase, merge, or skip rows. " +
    "Read table cells horizontally and vertically. Use the visible table grid, column positions, serial numbers, row boundaries and positioned OCR hints together. Never shift a value to a neighbouring requirement. " +
    "Return one row for every distinct leaf-level parameter. If the source has a parent label such as Room Condition and children such as Room Temperature and Relative Humidity, return requirement labels 'Room Condition – Room Temperature' and 'Room Condition – Relative Humidity', each with its own specification. Put the complete hierarchy in requirement; leave parentRequirement empty and parameterized=false. Do not make a separate parent heading row. " +
    "Split every bullet, lettered point, numbered sub-point, separate description line, and clear Label: value / Label = value pair into its own row. Split two values into separate rows when their meanings differ (for example Max=6200 g and d=0.01 g become Capacity and Readability; 24 hours per day and 07 days per week are separate points). Keep paired dimensions of the same item together (for example ID: 4.8 mm, OD: 8.0 mm); never drop either value. Never split a unit away from its number. " +
    "Keep the exact URS section headings and their original order. Do not rename, regroup, sort or move rows into a standard category order. Only create a section heading where a genuine URS section/sub-section heading exists. " +
    "Do not output logos, company/division names, cover titles, document-control information, revision history, signatures, page headers/footers, page numbers, the table headings 'Requirement'/'Description', or a generic 'USER REQUIREMENT' heading as requirements. Keep the equipment description row when it describes the equipment itself. Do not turn header fragments into CS rows. " +
    "equipmentName must be the actual equipment name from the main title or an explicit equipment-name field; never return the company, division, 'URS', or 'User Requirement' as the equipment name. If it cannot be identified, return an empty string. " +
    "Preserve every value verbatim. Correct only an unmistakable OCR character typo when the page image proves the correct character; record every correction in warnings as 'OCR correction — page N: OCR read [original]; source reads [corrected].' Do not silently correct wording. For unreadable or uncertain cells, retain the closest visible transcription, set reviewRequired=true, explain the uncertainty in reviewReason, and add a page-specific warnings entry. Inspect printed page numbers and report a missing page only when the visible sequence proves it (for example, the supplied scan starts at printed page 2, so page 1 is missing). Do not infer missing pages from filename or assumptions. " +
    "Before returning, cross-check each visible substantive table row against the output and ensure it appears exactly once, with its original value and unit. Use warnings to report all unreadable areas, OCR typos actually corrected, and missing pages established by printed numbering. " +
    "sourceQuote must be a short verbatim excerpt supporting that exact pair; sourcePages must identify its actual 1-based page. Confidence must reflect legibility and row/column association, not guesswork. " +
    "Return ONLY one JSON object matching this schema exactly; no markdown fences or commentary. " +
    "JSON schema:\n" + JSON.stringify(OUTPUT_SCHEMA);
  userContent[0].text += prompt;
  const inputPreparedAt = Date.now();

  let result;
  let inferenceMs = 0;
  try {
    const startedAt = Date.now();
    console.log("Workers AI URS extraction started", {
      model: MODEL,
      pageCount: extension === "pdf" ? JSON.parse(pageImagesRaw).length : 0,
      inputChars: extension === "docx" ? documentHtml.length : pageImagesRaw.length
    });
    result = await env.AI.run(MODEL,{
      messages:[
        {role:"system",content:SYSTEM_PROMPT},
        {role:"user",content:userContent}
      ],
      // Gemma 4 is not listed among Cloudflare's currently supported JSON Mode
      // models, so do not send response_format here. The extraction prompt and
      // the defensive JSON parser below enforce the response shape instead.
      // Use the Workers AI option name supported by the binding.
      max_tokens:10000,
      temperature:0.1,
      top_p:0.9,
      // Gemma 4 has a built-in thinking channel. Disable it so the token
      // budget is used for the final JSON payload rather than hidden reasoning.
      chat_template_kwargs:{enable_thinking:false}
    });
    inferenceMs = Date.now() - startedAt;
    const firstChoice = result?.choices?.[0];
    const firstMessage = firstChoice?.message || {};
    console.log("Workers AI URS response summary", {
      resultType: result === null ? "null" : typeof result,
      topLevelKeys: result && typeof result === "object" ? Object.keys(result).slice(0,16) : [],
      choicesCount: Array.isArray(result?.choices) ? result.choices.length : null,
      firstChoiceKeys: firstChoice && typeof firstChoice === "object" ? Object.keys(firstChoice).slice(0,12) : [],
      messageKeys: firstMessage && typeof firstMessage === "object" ? Object.keys(firstMessage).slice(0,12) : [],
      contentType: firstMessage.content === null ? "null" : typeof firstMessage.content,
      contentLength: typeof firstMessage.content === "string" ? firstMessage.content.length : null,
      finishReason: firstChoice?.finish_reason || null,
      usage: result?.usage || null
    });
    console.log("Workers AI URS extraction completed", {
      model: MODEL,
      elapsedMs: inferenceMs
    });
  } catch(e) {
    console.error("Workers AI inference error:",e);
    const msg=String(e?.message||e||"");
    if (/daily free allocation|neurons|quota/i.test(msg)) return jsonResponse({
      error:"The Cloudflare AI free daily allowance has been used. Please try again after the daily quota resets (00:00 UTC)."
    },429,origin);
    if (/not.?found|model.*not.*found|unknown model|does not exist/i.test(msg)) return jsonResponse({
      error:"The configured Cloudflare Workers AI model could not be found by the deployed Worker. The model ID is currently configured as " + MODEL + ". Please redeploy the latest Worker so the current AI binding and model configuration are used."
    },502,origin);
    if (/model agreement|5016|acceptable use|license/i.test(msg)) return jsonResponse({
      error:"Cloudflare requires acceptance of the model's license and acceptable-use policy before first use. Please review the model terms in Cloudflare Workers AI and retry."
    },403,origin);
    return jsonResponse({error:"Cloudflare Workers AI could not process this document. Please retry later. " + msg.slice(0,240)},502,origin);
  }

  try {
    const validationStartedAt = Date.now();
    const extracted = extractJson(result);
    const validated = validateExtraction(extracted);
    // Explicit values entered by the user take precedence over OCR/model guesses.
    if (equipmentNameOverride) validated.equipmentName = equipmentNameOverride;
    if (ursNumberOverride) validated.ursNumber = ursNumberOverride;
    const data = normalizeForCsTemplate(validated);
    const validationMs = Date.now() - validationStartedAt;
    data.model = MODEL;
    data.usage = result?.usage || null;
    data.provider = "Cloudflare Workers AI (free daily allocation)";
    data.diagnostics = {
      formParseMs: formParsedAt - requestStartedAt,
      inputPreparationMs: inputPreparedAt - formParsedAt,
      inferenceMs,
      validationMs,
      workerTotalMs: Date.now() - requestStartedAt
    };
    return jsonResponse(data,200,origin);
  } catch(e) {
    console.error("Workers AI extraction validation error:",e);
    return jsonResponse({error:e.message || "The AI extraction result was invalid. No workbook was created."},422,origin);
  }
}

export async function onRequestGet({request,env}) {
  const origin=request.headers.get("Origin")||"";
  const bindingPresent=Boolean(env?.AI && typeof env.AI.run==="function");
  return jsonResponse({
    status:"ok",
    service:"DocuWorks URS AI extraction",
    configured:bindingPresent,
    model:MODEL,
    billing:"Cloudflare Workers AI free daily allocation (10,000 neurons/day; subject to model usage)",
    architecture:"Mixture of Experts (4B active parameters)",
    reasoningEffort:"medium",
    diagnostic:{
      build:"cs-partial-scan-cs-format-20261112-v5",
      workersAIBindingPresent:bindingPresent,
      assetsBindingPresent:Boolean(env?.ASSETS),
      anthropicApiKeyRequired:false
    }
  },200,origin);
}

export async function onRequestOptions({request}) {
  const origin=request.headers.get("Origin")||"";
  if(!isAllowedOrigin(origin)) return new Response(null,{status:403});
  return new Response(null,{status:204,headers:{
    "Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"POST, OPTIONS, GET",
    "Access-Control-Allow-Headers":"Content-Type","Access-Control-Max-Age":"86400","Vary":"Origin"
  }});
}

export async function onRequestPost(context) {
  try { return await handlePost(context); }
  catch(e) {
    console.error("URS AI conversion error:",e);
    const origin=context.request.headers.get("Origin")||"";
    return jsonResponse({error:"The document could not be processed. Retry with the source file or check the Cloudflare AI binding."},500,origin);
  }
}
