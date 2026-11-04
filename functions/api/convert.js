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
    sections: { type: "array", items: {
      type: "object", additionalProperties: false,
      properties: {
        title: { type: "string" },
        requirements: { type: "array", items: {
          type: "object", additionalProperties: false,
          properties: {
            requirement: { type: "string" }, specification: { type: "string" },
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

const SYSTEM_PROMPT = "You are a careful document-extraction engine for pharmaceutical User Requirement Specifications (URS). Read each uploaded document as a document, not as a machine-specific template from memory.\n\n" +
"Extract source-grounded data only. Never invent a requirement, specification, value, unit, model, limit, standard, or missing text. Preserve units, tolerances, inequality signs, decimal places, punctuation, and multi-line meaning. If unreadable, mark reviewRequired=true and explain why.\n\n" +
"Identify the actual requirement/specification structure dynamically. Headings may say Requirement/Description, Requirements/Descriptions, Item/Specification, Parameter/Acceptance criteria, or use another layout. Use row boundaries, column headers, visual table rules, section numbering, and nearby context together. Do not use a centered heading's x-position as the column boundary. Carry multi-page tables across pages without duplicating headers.\n\n" +
"Return meaningful sections in source order. Put the true requirement in requirement, and its corresponding acceptance value or source description in specification. Do not concatenate unrelated rows. Keep long prose requirements intact. For labeled sub-requirements and specification matrices, expand into separate pairs only when the source supports it; use actual row/column labels to associate each cell with its correct parameter. Do not copy a neighbouring column into the requirement field. Exclude approval signatures, document-control headers, repeated page headers/footers, and revision history unless the URS makes them requirements.\n\n" +
"Use PDF page visuals and embedded text together; PDFs may be scanned or mixed. DOCX HTML preserves table boundaries. Include sourcePages as 1-based page numbers and a short sourceQuote for each pair. Confidence is an estimate from 0 to 1. Set reviewRequired when text is blurry, a table association ambiguous, a matrix cell uncertain, or content unreadable. Vendor compliance and vendor remarks must remain outside the extracted fields and will be blank in the CS workbook.\n\n" +
"Do not assume any equipment type. Extract the machine described by this upload, preserve substantive requirements in order, and never use hardcoded example machine data.";

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
function validateExtraction(value) {
  if (!value || !Array.isArray(value.sections)) throw new Error("The AI response did not include a section list.");
  const safe = { ...value, warnings: Array.isArray(value.warnings) ? value.warnings : [] };
  safe.sections = safe.sections.map((section, si) => ({
    title: String(section?.title || ("Section " + (si + 1))).trim(),
    requirements: (Array.isArray(section?.requirements) ? section.requirements : []).map(item => {
      const c = Number(item?.confidence);
      return {
        requirement: String(item?.requirement || "").trim(),
        specification: String(item?.specification || "").trim(),
        sourcePages: Array.isArray(item?.sourcePages) ? item.sourcePages.filter(n => Number.isInteger(n) && n > 0).slice(0,100) : [],
        sourceQuote: String(item?.sourceQuote || "").slice(0,1200),
        confidence: Number.isFinite(c) ? Math.max(0,Math.min(1,c)) : 0,
        reviewRequired: Boolean(item?.reviewRequired) || !Number.isFinite(c) || c < 0.8,
        reviewReason: String(item?.reviewReason || "").slice(0,1000)
      };
    }).filter(x => x.requirement || x.specification)
  })).filter(s => s.requirements.length || s.title);
  safe.rowCount = safe.sections.reduce((n,s)=>n+s.requirements.length,0);
  if (safe.rowCount < 1) throw new Error("No requirement/specification rows could be extracted; no workbook was created.");
  return safe;
}

function extractJson(value) {
  // Workers AI model responses vary by model/runtime version. Walk only
  // recognized response fields and accept direct structured JSON as well.
  const seen = new Set();
  function findPayload(input, depth = 0) {
    if (depth > 6 || input == null) return null;
    if (typeof input === "string") return input.trim() ? input : null;
    if (Array.isArray(input)) {
      const parts = input.map(part => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") return part.text ?? part.content ?? null;
        return null;
      }).filter(x => typeof x === "string" && x.trim());
      return parts.length ? parts.join("\n") : null;
    }
    if (typeof input !== "object" || seen.has(input)) return null;
    seen.add(input);
    if (Array.isArray(input.sections)) return input;
    const keys = [
      "response", "result", "output_text", "generated_text",
      "text", "content", "output", "choices", "message", "delta"
    ];
    for (const key of keys) {
      if (!(key in input)) continue;
      const found = findPayload(input[key], depth + 1);
      if (found !== null) return found;
    }
    return null;
  }

  value = findPayload(value);
  if (value && typeof value === "object" && !Array.isArray(value) &&
      Array.isArray(value.sections)) return value;
  if (typeof value !== "string") {
    const shape = value && typeof value === "object"
      ? Object.keys(value).slice(0, 12).join(", ")
      : (value === null ? "null/empty" : typeof value);
    throw new Error("The AI model returned no readable text payload (response shape: " + shape + "). Please retry; no workbook was created.");
  }
  let text = value.trim().replace(/^\uFEFF/, "");
  text = text.replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/, "").trim();
  const first = text.indexOf("{"), last = text.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new Error("The AI response did not contain valid JSON. Returned text begins: " + text.slice(0, 180));
  }
  return JSON.parse(text.slice(first, last + 1));
}

async function handlePost({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: "Origin is not allowed." },403,origin);
  if (!env?.AI || typeof env.AI.run !== "function") return jsonResponse({
    error: "Cloudflare Workers AI is not connected. Deploy the latest Worker configuration with the AI binding enabled."
  },503,origin);

  let form;
  try { form = await request.formData(); }
  catch { return jsonResponse({ error: "Upload must use multipart form data." },400,origin); }
  const fileName = String(form.get("fileName") || "URS document").slice(0,180);
  const documentHtml = String(form.get("documentHtml") || "");
  const pageImagesRaw = String(form.get("pageImages") || "");
  const extension = fileName.toLowerCase().split(".").pop();
  let userContent = [];
  let description = "Filename: " + fileName + "\n";

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
    description += "The user supplied " + pageImages.length + " rendered PDF page images. Read every page in order. Page numbers are supplied before each image.";
    userContent.push({type:"text",text:description});
    for (const p of pageImages) {
      userContent.push({type:"text",text:"SOURCE PDF PAGE " + p.page});
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
    "Extract every substantive URS requirement and its correct corresponding specification from this source. " +
    "Preserve source order, values, units, tolerances and table row associations. " +
    "Return ONLY one JSON object matching this schema exactly; do not add markdown fences or commentary. " +
    "If uncertain, preserve the source text and set reviewRequired=true. Never invent data.\n\n" +
    "JSON schema:\n" + JSON.stringify(OUTPUT_SCHEMA);
  userContent[0].text += prompt;

  let result;
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
      max_tokens:7000,
      temperature:0.2,
      top_p:0.9
    });
    console.log("Workers AI URS extraction completed", {
      model: MODEL,
      elapsedMs: Date.now() - startedAt
    });
  } catch(e) {
    console.error("Workers AI inference error:",e);
    const msg=String(e?.message||e||"");
    if (/daily free allocation|neurons|quota/i.test(msg)) return jsonResponse({
      error:"The Cloudflare AI free daily allowance has been used. Please try again after the daily quota resets (00:00 UTC)."
    },429,origin);
    if (/model agreement|5016|acceptable use|license/i.test(msg)) return jsonResponse({
      error:"Cloudflare requires acceptance of the model's license and acceptable-use policy before first use. Please review the model terms in Cloudflare Workers AI and retry."
    },403,origin);
    return jsonResponse({error:"Cloudflare Workers AI could not process this document. Please retry later. " + msg.slice(0,240)},502,origin);
  }

  try {
    const raw = result?.response ?? result?.result ?? result?.output_text ?? result;
    const extracted = extractJson(raw);
    const data = validateExtraction(extracted);
    data.model = MODEL;
    data.usage = result?.usage || null;
    data.provider = "Cloudflare Workers AI (free daily allocation)";
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
      build:"cloudflare-workers-ai-gemma4-fast-20261104",
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
