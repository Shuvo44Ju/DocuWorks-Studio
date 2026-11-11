const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_ENTITIES = 900;

function allowed(origin) {
  return origin === "https://shuvo44ju.github.io" ||
    /^https:\/\/[a-z0-9-]+\.pages\.dev$/i.test(origin) ||
    /^https:\/\/(?:[a-z0-9-]+\.)*[a-z0-9-]+\.workers\.dev$/i.test(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}
function reply(body,status,origin) {
  const h = new Headers({"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Vary":"Origin","X-Content-Type-Options":"nosniff"});
  if (allowed(origin)) {
    h.set("Access-Control-Allow-Origin",origin);
    h.set("Access-Control-Allow-Methods","POST, OPTIONS");
    h.set("Access-Control-Allow-Headers","Content-Type");
    h.set("Access-Control-Max-Age","86400");
  }
  return new Response(JSON.stringify(body),{status,headers:h});
}
function parseJson(result) {
  let v=result?.choices?.[0]?.message?.content ?? result?.response ?? result?.result;
  if(v&&typeof v==="object")return v;
  if(typeof v!=="string")throw new Error("AI returned no readable modification plan.");
  const t=v.trim().replace(/^\`\`\`(?:json)?\s*/i,"").replace(/\s*\`\`\`$/,"");
  const a=t.indexOf("{"),b=t.lastIndexOf("}");
  if(a<0||b<=a)throw new Error("AI did not return a complete modification plan.");
  return JSON.parse(t.slice(a,b+1));
}
export async function onRequestOptions({request}) {
  const origin=request.headers.get("Origin")||"";
  if(!allowed(origin))return new Response(null,{status:403});
  return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Access-Control-Max-Age":"86400","Vary":"Origin"}});
}
export async function onRequestPost({request,env}) {
  const origin=request.headers.get("Origin")||"";
  if(!allowed(origin))return reply({error:"Origin is not allowed."},403,origin);
  if(!env?.AI||typeof env.AI.run!=="function")return reply({error:"Cloudflare Workers AI is not connected to this Worker."},503,origin);
  const raw=await request.text();
  if(raw.length>MAX_BODY_BYTES)return reply({error:"The drawing extract is too large. Use a simplified DXF export."},413,origin);
  let input;try{input=JSON.parse(raw)}catch{return reply({error:"Invalid JSON request."},400,origin)}
  if(!input?.prompt||!Array.isArray(input?.entities))return reply({error:"A modification instruction and parsed DXF entities are required."},400,origin);
  const drawingImage=typeof input.drawingImage==="string"&&input.drawingImage.startsWith("data:image/")&&input.drawingImage.length<1800000?input.drawingImage:null;
  const analysisContext=input.analysisContext&&typeof input.analysisContext==="object"?JSON.stringify({drawing_summary:input.analysisContext.drawing_summary,identified_elements:input.analysisContext.identified_elements,potential_issues:input.analysisContext.potential_issues}).slice(0,12000):"No prior analysis available.";
  const changeHistory=Array.isArray(input.changeHistory)?input.changeHistory.slice(-8):[];
  const entities=input.entities.slice(0,MAX_ENTITIES).map((e,index)=>({
    index,type:String(e?.type||"UNKNOWN"),layer:String(e?.layer||"0"),
    points:Array.isArray(e?.points)?e.points.slice(0,12):[],
    radius:Number.isFinite(Number(e?.data?.r))?Number(e.data.r):null,
    text:typeof e?.data?.text==="string"?e.data.text.slice(0,500):""
  }));
  const system=[
    "You are a cautious CAD modification planner. You propose explicit edits for a browser-side DXF working copy; you do not directly alter the source file.",
    "Use the user's latest comment, the supplied current drawing preview, the prior analysis summary and extracted entities together. Treat the preview as essential context for locating the target.",
    "Never guess the target. If a room, wall, equipment item, symbol or group cannot be mapped unambiguously to supported editable entities, set clarification_required true and ask one precise question.",
    "Supported editable entity types are LINE, CIRCLE, ARC, LWPOLYLINE, POINT, TEXT and MTEXT. Do not target blocks, dimensions, hatches, leaders, external references or unsupported entities.",
    "Only return exact operations: move_entity {index,dx,dy}; delete_entity {index}; set_layer {index,layer}; update_text {index,text}; add_line {layer,x1,y1,x2,y2}; add_circle {layer,x,y,radius}; add_text {layer,x,y,text,height}.",
    "Coordinates are drawing units. Never assume units or scale. Ask the user if a requested physical distance cannot be converted safely.",
    "For moving a complete room, equipment assembly or block, do not move only one visible line. If the full target set cannot be identified, ask for clarification instead.",
    "Prefer minimal edits. Do not make unrelated changes. If the request cannot be performed safely by the supported editor, explain why and return no operations.",
    'Return ONLY JSON: {\\"summary\\":\\"...\\",\\"clarification_required\\":false,\\"clarification_question\\":\\"\\",\\"operations\\":[{\\"type\\":\\"move_entity\\",\\"index\\":0,\\"dx\\":0,\\"dy\\":0,\\"reason\\":\\"...\\"}],\\"warnings\\":[\\"...\\"]}.'
  ].join("\\n");
  const started=Date.now();
  try {
    const result=await env.AI.run(MODEL,{
      messages:[
        {role:"system",content:system},
        {role:"user",content:drawingImage?[{type:"text",text:"Latest user change request: "+String(input.prompt).slice(0,2500)+"\nDrawing file: "+String(input.fileName||"DXF").slice(0,160)+"\nDrawing units: "+String(input.units||"Not specified")+"\nPrior drawing interpretation: "+analysisContext+"\nPrevious change requests: "+JSON.stringify(changeHistory)+"\nCurrent supported entities (indices are stable in this working copy): "+JSON.stringify(entities)},{type:"image_url",image_url:{url:drawingImage,detail:"high"}}]:"Latest user change request: "+String(input.prompt).slice(0,2500)+"\nDrawing file: "+String(input.fileName||"DXF").slice(0,160)+"\nDrawing units: "+String(input.units||"Not specified")+"\nPrior drawing interpretation: "+analysisContext+"\nPrevious change requests: "+JSON.stringify(changeHistory)+"\nCurrent supported entities: "+JSON.stringify(entities)}
      ],
      response_format:{type:"json_object"},max_completion_tokens:3000,temperature:0.05,
      chat_template_kwargs:{enable_thinking:false}
    });
    const plan=parseJson(result);
    const allowedTypes=new Set(["move_entity","delete_entity","set_layer","update_text","add_line","add_circle","add_text"]);
    const ops=Array.isArray(plan.operations)?plan.operations.slice(0,80).filter(op=>{
      if(!allowedTypes.has(op?.type))return false;
      if(["move_entity","delete_entity","set_layer","update_text"].includes(op.type)){
        if(!Number.isInteger(op.index)||op.index<0||op.index>=entities.length)return false;
        const target=entities[op.index];
        if(op.type==="move_entity")return ["LINE","CIRCLE","ARC","LWPOLYLINE","POINT","TEXT","MTEXT"].includes(target.type)&&Number.isFinite(Number(op.dx))&&Number.isFinite(Number(op.dy));
        if(op.type==="update_text")return ["TEXT","MTEXT"].includes(target.type)&&typeof op.text==="string";
        if(op.type==="set_layer")return typeof op.layer==="string"&&op.layer.trim().length>0&&op.layer.length<=120;
        return ["LINE","CIRCLE","ARC","LWPOLYLINE","POINT","TEXT","MTEXT"].includes(target.type);
      }
      if(op.type==="add_line")return [op.x1,op.y1,op.x2,op.y2].every(v=>Number.isFinite(Number(v)))&&typeof op.layer==="string";
      if(op.type==="add_circle")return [op.x,op.y,op.radius].every(v=>Number.isFinite(Number(v)))&&Number(op.radius)>0&&typeof op.layer==="string";
      if(op.type==="add_text")return [op.x,op.y,op.height].every(v=>Number.isFinite(Number(v)))&&Number(op.height)>0&&typeof op.text==="string"&&op.text.length>0&&typeof op.layer==="string";
      return false;
    }):[];
    return reply({
      summary:String(plan.summary||"Modification plan prepared."),
      clarification_required:Boolean(plan.clarification_required),
      clarification_question:String(plan.clarification_question||""),
      operations:ops,
      warnings:Array.isArray(plan.warnings)?plan.warnings.slice(0,30).map(String):[],
      preview_notes:Array.isArray(plan.preview_notes)?plan.preview_notes.slice(0,30).map(String):[],
      model:MODEL,diagnostics:{inferenceMs:Date.now()-started,entitiesReviewed:entities.length}
    },200,origin);
  } catch(e) {
    console.error("CAD modification planning error:",e);
    const msg=String(e?.message||e||"");
    if(/daily free allocation|neurons|quota/i.test(msg))return reply({error:"Cloudflare AI's free daily allowance has been used. Try again after the daily quota resets."},429,origin);
    if(/model agreement|5016|acceptable use|license/i.test(msg))return reply({error:"Cloudflare requires acceptance of this model's license before first use."},403,origin);
    return reply({error:"The AI could not prepare a modification plan. "+msg.slice(0,180)},502,origin);
  }
}
