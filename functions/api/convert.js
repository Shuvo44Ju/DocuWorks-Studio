const MODEL = "claude-sonnet-5-5";
const MAX_FILE_BYTES = 24 * 1024 * 1024;
const API_URL = "https://api.anthropic.com/v1/messages";

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
async function handlePost({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (!isAllowedOrigin(origin)) return jsonResponse({ error: "Origin is not allowed." },403,origin);
  if (!env.ANTHROPIC_API_KEY) return jsonResponse({
    error: "AI conversion is not configured. Add ANTHROPIC_API_KEY as a server-side secret in Cloudflare Pages."
  },503,origin);
  let form;
  try { form = await request.formData(); }
  catch { return jsonResponse({ error: "Upload must use multipart form data." },400,origin); }
  const file = form.get("file");
  const fileName = String(form.get("fileName") || (file && file.name) || "URS document").slice(0,180);
  const documentHtml = String(form.get("documentHtml") || "");
  const extension = fileName.toLowerCase().split(".").pop();
  const content = [];
  let description = "";
  if (file && typeof file.arrayBuffer === "function" && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return jsonResponse({ error:"PDF exceeds the 24 MB AI upload limit. Compress it or use a smaller source file." },413,origin);
    if (extension !== "pdf" && file.type !== "application/pdf") return jsonResponse({
      error:"For DOCX files send table-preserving HTML in documentHtml. The file field is for PDFs."
    },415,origin);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i=0;i<bytes.length;i+=0x8000) binary += String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));
    content.push({ type:"document", source:{ type:"base64", media_type:"application/pdf", data:btoa(binary) } });
    description = "Filename: " + fileName + "\nRead every page of this PDF, including scanned tables and images.";
  } else if (documentHtml.trim()) {
    if (documentHtml.length > 12*1024*1024) return jsonResponse({ error:"DOCX content exceeds the 12 MB HTML limit." },413,origin);
    const text = htmlToPlain(documentHtml);
    if (!text) return jsonResponse({ error:"No readable text was extracted from the DOCX." },422,origin);
    description = "Filename: " + fileName + "\nDOCX table-preserving HTML:\n" + documentHtml + "\n\nPlain text:\n" + text;
  } else return jsonResponse({ error:"Please upload a PDF or DOCX document." },400,origin);

  content.push({ type:"text", text: description + "\n\nExtract all substantive URS requirements. Correctly map each requirement to its own specification. Source accuracy and row association are more important than brevity." });
  let response;
  try {
    response = await fetch(API_URL,{
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({
        model:env.ANTHROPIC_MODEL || MODEL, max_tokens:18000, system:SYSTEM_PROMPT,
        messages:[{role:"user",content}],
        output_config:{format:{type:"json_schema",schema:OUTPUT_SCHEMA}}
      })
    });
  } catch(e) {
    return jsonResponse({error:"Could not reach the AI provider. Check backend connectivity and retry."},502,origin);
  }
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) return jsonResponse({
    error:payload?.error?.message || "The AI provider rejected the conversion request.",
    providerStatus:response.status
  },502,origin);
  const textBlock=Array.isArray(payload.content)?payload.content.find(x=>x.type==="text"):null;
  if(!textBlock?.text) return jsonResponse({error:"The AI provider returned no structured extraction."},502,origin);
  try {
    const data=validateExtraction(JSON.parse(textBlock.text));
    data.model=env.ANTHROPIC_MODEL || MODEL;
    data.usage=payload.usage?{inputTokens:payload.usage.input_tokens||0,outputTokens:payload.usage.output_tokens||0}:null;
    return jsonResponse(data,200,origin);
  } catch(e) { return jsonResponse({error:e.message || "The AI extraction result was invalid."},422,origin); }
}
export async function onRequestGet({request,env}) {
  const origin=request.headers.get("Origin")||"";
  return jsonResponse({status:"ok",service:"DocuWorks URS AI extraction",configured:Boolean(env.ANTHROPIC_API_KEY),model:env.ANTHROPIC_MODEL||MODEL},200,origin);
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
    return jsonResponse({error:"The document could not be processed. Retry with the source file or check backend configuration."},500,origin);
  }
}