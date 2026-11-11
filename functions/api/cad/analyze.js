const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_ENTITIES = 1200;
const MAX_TEXTS = 300;

function isAllowedOrigin(origin) {
  return origin === "https://shuvo44ju.github.io" ||
    /^https:\/\/[a-z0-9-]+\.pages\.dev$/i.test(origin) ||
    /^https:\/\/(?:[a-z0-9-]+\.)*[a-z0-9-]+\.workers\.dev$/i.test(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}
function respond(body, status, origin) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin"
  });
  if (isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return new Response(JSON.stringify(body), { status, headers });
}
function parseModelJson(result) {
  let value = result?.choices?.[0]?.message?.content ?? result?.response ?? result?.result;
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") throw new Error("The AI returned no readable response.");
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The AI response did not contain a complete JSON report.");
  return JSON.parse(cleaned.slice(start, end + 1));
}
function cleanDrawing(input) {
  const d = input?.drawing;
  if (!d || typeof d !== "object" || !Array.isArray(d.entities)) throw new Error("A parsed DXF drawing is required.");
  const entities = d.entities.slice(0, MAX_ENTITIES).map(e => ({
    type: String(e?.type || "UNKNOWN").slice(0,40),
    layer: String(e?.layer || "0").slice(0,120),
    points: Array.isArray(e?.points) ? e.points.slice(0,12).map(p => ({
      x: Number.isFinite(Number(p?.x)) ? Number(p.x) : null,
      y: Number.isFinite(Number(p?.y)) ? Number(p.y) : null
    })) : [],
    data: {
      radius: Number.isFinite(Number(e?.data?.r)) ? Number(e.data.r) : null,
      startAngle: Number.isFinite(Number(e?.data?.start)) ? Number(e.data.start) : null,
      endAngle: Number.isFinite(Number(e?.data?.end)) ? Number(e.data.end) : null,
      flags: Number.isFinite(Number(e?.data?.flags)) ? Number(e.data.flags) : null,
      text: typeof e?.data?.text === "string" ? e.data.text.slice(0,1500) : ""
    }
  }));
  return {
    fileName: String(input.fileName || "DXF drawing").slice(0,180),
    prompt: String(input.prompt || "Review this drawing for a project manager.").slice(0,3000),
    metadata: {
      totalSupportedEntities: Number(d.total) || entities.length,
      entitiesSentToAI: entities.length,
      entitiesOmitted: Math.max(0,(Number(d.total)||entities.length)-entities.length),
      bounds: d.bounds || null,
      entityCounts: Array.isArray(d.types) ? d.types.slice(0,40) : [],
      layers: Array.isArray(d.layers) ? d.layers.slice(0,60) : [],
      openPolylines: Number(d.open) || 0,
      closedPolylines: Number(d.closed) || 0,
      extractedText: Array.isArray(d.texts) ? d.texts.slice(0,MAX_TEXTS).map(x=>String(x).slice(0,1500)) : [],
      technicalInventory: d.technicalInventory && typeof d.technicalInventory === "object" ? {
        entityTypeCounts: d.technicalInventory.entityTypeCounts || {},
        dimensions: Array.isArray(d.technicalInventory.dimensions) ? d.technicalInventory.dimensions.slice(0,250) : [],
        blockReferences: Array.isArray(d.technicalInventory.blockReferences) ? d.technicalInventory.blockReferences.slice(0,300) : [],
        leaders: Array.isArray(d.technicalInventory.leaders) ? d.technicalInventory.leaders.slice(0,100) : [],
        hatches: Array.isArray(d.technicalInventory.hatches) ? d.technicalInventory.hatches.slice(0,150) : [],
        dimensionCount: Number(d.technicalInventory.dimensionCount) || 0,
        blockReferenceCount: Number(d.technicalInventory.blockReferenceCount) || 0,
        leaderCount: Number(d.technicalInventory.leaderCount) || 0,
        hatchCount: Number(d.technicalInventory.hatchCount) || 0
      } : null
    },
    entities
  };
}

export async function onRequestOptions({ request }) {
  const origin = request.headers.get("Origin") || "";
  if (!isAllowedOrigin(origin)) return new Response(null,{status:403});
  return new Response(null,{status:204,headers:{
    "Access-Control-Allow-Origin":origin,
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type",
    "Access-Control-Max-Age":"86400",
    "Vary":"Origin"
  }});
}
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  if (!isAllowedOrigin(origin)) return respond({error:"Origin is not allowed."},403,origin);
  if (!env?.AI || typeof env.AI.run !== "function") return respond({
    error:"Cloudflare Workers AI is not connected. The AI binding must be enabled on this Worker."
  },503,origin);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return respond({error:"This drawing extract is too large for one analysis request. Try a simplified DXF export."},413,origin);
  let input;
  try { input = JSON.parse(raw); } catch { return respond({error:"The analysis request was not valid JSON."},400,origin); }
  let drawing;
  try { drawing = cleanDrawing(input); } catch(e) { return respond({error:e.message},400,origin); }

  const system = [
    "You are a cautious technical drawing review assistant supporting a pharmaceutical project manager.",
    "You receive a partial structured extraction from a DXF file, not the complete original CAD drawing. The parser supports only a subset of DXF entities and does not currently expand blocks or fully interpret dimensions, hatches, leaders, external references, or all text styles.",
    "Analyze only the evidence supplied. Never invent equipment, tags, dimensions, units, scale, clearances, utility connections, materials, standards, or compliance results.",
    "Do not infer physical distances from raw coordinate extents unless drawing units and scale are explicitly known. Treat coordinates as drawing units of unknown meaning.",
    "Distinguish observed facts from potential issues and questions requiring human confirmation. A missing item from this extract is not proof that it is absent from the original drawing.",
    "Do not claim compliance against any external specification or project requirement because none is included in this request.",
    "For each finding, include evidence such as entity type, layer, or exact extracted text when possible. If there is insufficient evidence, say so clearly.",
    "Perform an advanced, evidence-led technical review, not a generic summary. Examine geometry distribution and extents, entity and layer structure, extracted labels/text, dimension entities and their available text/measurement/style metadata, block references, hatches, leaders, and likely annotation or coordination dependencies. Explicitly distinguish actual evidence from a review question. Flag suspicious or incomplete patterns only as potential risks, never as proven design errors without evidence.",
    "Review dimensions for missing/unreadable overrides, mixed or absent dimension metadata, possible annotation gaps, and values that merit human cross-checking. Do not decide dimensions are incorrect merely because they differ. Do not infer units or scale.",
    "Review equipment/block references and layer usage for duplicated, inconsistent, unexplained or coordination-relevant patterns only when the supplied data supports that observation. Identify the discipline-specific checks a project manager should request from the responsible engineer.",
    "Prioritize findings by potential project impact and state exactly what evidence supports each. Give actionable next steps and supplier questions. Avoid generic boilerplate.",
    "Be useful to a non-CAD project manager. Explain technical terms briefly and prioritize practical actions before approval.",
    "Return only a JSON object with this shape: {\"drawing_summary\":\"...\",\"identified_elements\":[{\"name\":\"...\",\"observation\":\"...\",\"evidence\":\"...\"}],\"potential_issues\":[{\"severity\":\"High|Medium|Low|Information\",\"issue\":\"...\",\"why_it_matters\":\"...\",\"evidence\":\"...\",\"recommended_action\":\"...\"}],\"missing_information\":[{\"item\":\"...\",\"reason\":\"...\"}],\"approval_readiness\":\"Not ready|Needs review|Insufficient information\",\"approval_explanation\":\"...\",\"supplier_comments\":[\"...\"],\"limitations\":[\"...\"],\"confidence\":0.0}.",
    "Use concise, source-grounded content. If the extract is sparse, return a short report and explain the limitation rather than filling sections with generic assumptions."
  ].join("\\n");

  let result;
  const started = Date.now();
  try {
    result = await env.AI.run(MODEL,{
      messages:[
        {role:"system",content:system},
        {role:"user",content:"Analyze this DXF extract for the following request: "+drawing.prompt+"\\n\\nStructured drawing extract:\\n"+JSON.stringify(drawing)}
      ],
      response_format:{type:"json_object"},
      max_completion_tokens:5000,
      temperature:0.1,
      top_p:0.9,
      chat_template_kwargs:{enable_thinking:false}
    });
  } catch(e) {
    console.error("CAD drawing AI inference error:",e);
    const msg=String(e?.message||e||"");
    if (/daily free allocation|neurons|quota/i.test(msg)) return respond({error:"The Cloudflare AI free daily allowance has been used. Try again after the daily quota resets."},429,origin);
    if (/model agreement|5016|acceptable use|license/i.test(msg)) return respond({error:"Cloudflare requires acceptance of this model's license before first use."},403,origin);
    return respond({error:"Cloudflare Workers AI could not analyze this drawing. "+msg.slice(0,220)},502,origin);
  }
  try {
    const report = parseModelJson(result);
    const arr = key => Array.isArray(report[key]) ? report[key].slice(0,40) : [];
    return respond({
      ...report,
      identified_elements:arr("identified_elements"),
      potential_issues:arr("potential_issues"),
      missing_information:arr("missing_information"),
      supplier_comments:arr("supplier_comments"),
      technical_findings:arr("technical_findings"),
      dimension_review:arr("dimension_review"),
      coordination_review:arr("coordination_review"),
      recommended_next_steps:arr("recommended_next_steps"),
      limitations:[...arr("limitations"),"AI reviewed only the supported DXF extract sent by this browser. It did not inspect unsupported DXF structures or verify the original drawing visually."],
      model:MODEL,
      provider:"Cloudflare Workers AI",
      diagnostics:{inferenceMs:Date.now()-started,entitiesReviewed:drawing.entities.length,entitiesOmitted:drawing.metadata.entitiesOmitted}
    },200,origin);
  } catch(e) {
    console.error("CAD report parsing error:",e);
    return respond({error:"The AI response could not be converted into a valid drawing report. Please retry."},422,origin);
  }
}
