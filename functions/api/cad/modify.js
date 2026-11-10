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
  const entities=input.entities.slice(0,MAX_ENTITIES).map((e,index)=>({
    index,type:String(e?.type||"UNKNOWN"),layer:String(e?.layer||"0"),
    points:Array.isArray(e?.points)?e.points.slice(0,12):[],
    radius:Number.isFinite(Number(e?.data?.r))?Number(e.data.r):null,
    text:typeof e?.data?.text==="string"?e.data.text.slice(0,500):""
  }));
  const system=[
    "You are a cautious CAD modification planner. You do not edit files. You propose explicit operations for a browser-side DXF editor.",
    "The supplied entity list is a partial DXF parse. Supported editable entity types are LINE, CIRCLE, ARC, LWPOLYLINE, POINT, TEXT and MTEXT. Do not target other types.",
    "Never guess which object the user means. If the user refers to Object #n, use entity index n-1. Use entity index only when the evidence clearly identifies the target by text, layer, type, position, or a uniquely described feature. If ambiguous, set clarification_required true and ask one precise question.",
    "Coordinates are drawing units, whose physical meaning is unknown unless the user explicitly states units or the file metadata proves them. Never convert mm/inches or assume scale. If the requested physical distance cannot be converted safely, ask what drawing units are used.",
    "Only return operations that can be represented exactly: move_entity {index,dx,dy}; delete_entity {index}; set_layer {index,layer}; update_text {index,text}; add_line {layer,x1,y1,x2,y2}; add_circle {layer,x,y,radius}; add_text {layer,x,y,text,height}.",
    "For a move, dx and dy are drawing-unit offsets. Moving a circle/arc changes its center. Moving a polyline changes all its vertices. Do not claim to move a whole equipment block if the block is not represented as a single supported entity.",
    "Do not alter dimensions, block references, hatches, external references, or unsupported objects. Do not invent geometry, dimensions, layers, or text. Prefer asking for clarification over guessing.",
    "If no safe exact operation is possible, return an empty operations array and explain why. Keep comments short and practical.",
    'Return ONLY JSON matching this schema: {"summary":"...","clarification_required":false,"clarification_question":"","operations":[{"type":"move_entity","index":0,"dx":0,"dy":0,"reason":"..."}],"warnings":["..."],"preview_notes":["..."]}. Use only the listed operation types and required fields.'
  ].join("\n");
  const started=Date.now();
  try {
    const result=await env.AI.run(MODEL,{
      messages:[
        {role:"system",content:system},
        {role:"user",content:"User instruction: "+String(input.prompt).slice(0,2500)+"\nDrawing file: "+String(input.fileName||"DXF").slice(0,160)+"\nDrawing units declared by user: "+String(input.units||"Not specified")+"\nEntities (index is stable within this upload): "+JSON.stringify(entities)}
      ],
      response_format:{type:"json_object"},max_completion_tokens:3000,temperature:0.05,
      chat_template_kwargs:{enable_thinking:false}
    });
    const plan=parseJson(result);
    const allowedTypes=new Set(["move_entity","delete_entity","set_layer","update_text","add_line","add_circle","add_text"]);
    const ops=Array.isArray(plan.operations)?plan.operations.slice(0,80).filter(op=>{
      if(!allowedTypes.has(op?.type))return false;
      if(["move_entity","delete_entity","set_layer","update_text"].includes(op.type))return Number.isInteger(op.index)&&op.index>=0&&op.index<entities.length;
      return true;
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
