const DOCUWORKS_AI_URL = "https://docuworks-studio.shuvokh97.workers.dev/api/assistant";
const AI_TOOL = (() => {
  const p = location.pathname.toLowerCase();
  if (p.includes("project360")) return "project360";
  if (p.includes("cs.html")) return "cs";
  if (p.includes("scan.html")) return "scan";
  if (p.includes("ink-saver")) return "pdf";
  if (p.includes("price-reduction")) return "priceReduction";
  return "workspace";
})();
const AI_LABEL = ({
  project360:"Project 360 Design Assistant", cs:"URS → CS Assistant",
  scan:"Document Scanner Assistant", pdf:"PDF Optimizer Assistant",
  priceReduction:"Price Reduction Assistant", workspace:"DocuWorks AI Assistant"
})[AI_TOOL];

function toolContext() {
  const parts = [];
  const fields = [...document.querySelectorAll("input,textarea,select")].filter(el =>
    el.type !== "file" && el.type !== "password" && el.type !== "hidden" &&
    el.id !== "aiMessage" && el.offsetParent !== null
  );
  for (const el of fields) {
    const label = el.labels?.[0]?.innerText || el.getAttribute("aria-label") || el.name || el.id || el.tagName;
    const value = el.type === "checkbox" ? (el.checked ? "Yes" : "No") : String(el.value || "").trim();
    if (value) parts.push(label + ": " + value);
  }
  return parts.join("\n").slice(0,10000);
}
async function callAI(payload) {
  const response = await fetch(DOCUWORKS_AI_URL, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload)
  });
  let data;
  try { data = await response.json(); } catch { throw new Error("The AI service returned an unreadable response."); }
  if (!response.ok) throw new Error(data?.error || "AI request failed ("+response.status+").");
  return data;
}
window.DocuWorksAI = {
  ask: (message, history=[], context="") => callAI({tool:AI_TOOL,message,history,context}),
  askDesign: (message, design) => callAI({tool:"project360",mode:"design",message,design})
};

function mountAssistant() {
  if (document.getElementById("dw-ai-launcher")) return;
  const style = document.createElement("style");
  style.textContent = `
  #dw-ai-launcher{position:fixed;right:18px;bottom:18px;z-index:99990;border:0;border-radius:999px;background:#2458d3;color:#fff;padding:13px 17px;font:700 13px system-ui;box-shadow:0 8px 28px #102b5b40;cursor:pointer}
  #dw-ai-panel{position:fixed;right:16px;bottom:76px;z-index:99991;width:min(390px,calc(100vw - 24px));height:min(590px,calc(100dvh - 100px));background:#fff;border:1px solid #dce4ef;border-radius:16px;box-shadow:0 18px 55px #102b5b35;display:none;flex-direction:column;overflow:hidden;color:#172b4d;font:13px/1.45 system-ui}
  #dw-ai-panel.open{display:flex}#dw-ai-head{padding:13px 15px;background:#17335e;color:#fff;display:flex;align-items:center;gap:10px}
  #dw-ai-head strong{font-size:13px}#dw-ai-head small{display:block;color:#c9d7ef;font-size:10px}
  #dw-ai-close{margin-left:auto;background:transparent;border:0;color:#fff;font-size:22px;cursor:pointer}
  #dw-ai-messages{padding:13px;overflow:auto;flex:1;background:#f6f8fc;display:flex;flex-direction:column;gap:9px}
  .dw-ai-msg{max-width:92%;padding:10px 12px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere}
  .dw-ai-msg.bot{align-self:flex-start;background:#fff;border:1px solid #e2e8f1}.dw-ai-msg.user{align-self:flex-end;background:#2458d3;color:#fff}
  #dw-ai-controls{padding:10px;border-top:1px solid #e6ebf2;background:#fff}
  #dw-ai-context{display:flex;align-items:center;gap:6px;color:#718099;font-size:10px;margin:0 0 7px}
  #dw-ai-inputrow{display:flex;gap:7px;align-items:flex-end}#dw-ai-input{flex:1;min-width:0;min-height:42px;max-height:115px;resize:vertical;border:1px solid #dce4ef;border-radius:9px;padding:10px;font:12px system-ui;color:#172b4d}
  #dw-ai-send{border:0;border-radius:9px;background:#2458d3;color:#fff;font-weight:800;padding:11px 13px;cursor:pointer}#dw-ai-send:disabled{opacity:.5}
  #dw-ai-foot{font-size:9px;color:#9aa6b8;margin-top:6px}
  @media(max-width:520px){#dw-ai-panel{right:8px;bottom:68px;width:calc(100vw - 16px);height:calc(100dvh - 82px)}#dw-ai-launcher{right:12px;bottom:12px}}
  `;
  document.head.appendChild(style);
  const launcher = document.createElement("button");
  launcher.id = "dw-ai-launcher"; launcher.type = "button"; launcher.textContent = "✦ Ask DocuWorks AI";
  const panel = document.createElement("section");
  panel.id = "dw-ai-panel"; panel.setAttribute("aria-label",AI_LABEL);
  panel.innerHTML = `<div id="dw-ai-head"><div>✦</div><div><strong>${AI_LABEL}</strong><small>Explain naturally. Ask follow-up questions.</small></div><button id="dw-ai-close" aria-label="Close">×</button></div><div id="dw-ai-messages"><div class="dw-ai-msg bot">Hello! Tell me what you want to do. You can write naturally—no special commands needed.</div></div><div id="dw-ai-controls"><label id="dw-ai-context"><input id="dw-ai-include" type="checkbox" checked> Include current tool details in my message</label><div id="dw-ai-inputrow"><textarea id="dw-ai-input" placeholder="Describe what you need…" rows="2"></textarea><button id="dw-ai-send" type="button">Send</button></div><div id="dw-ai-foot">AI runs through the DocuWorks server. Provider free-use limits may apply. Review sensitive details before including them.</div></div>`;
  document.body.append(launcher,panel);
  const messages = panel.querySelector("#dw-ai-messages"), input=panel.querySelector("#dw-ai-input"), send=panel.querySelector("#dw-ai-send");
  const history=[];
  function add(role,text){const el=document.createElement("div");el.className="dw-ai-msg "+(role==="user"?"user":"bot");el.textContent=text;messages.appendChild(el);messages.scrollTop=messages.scrollHeight;}
  async function submit(){
    const message=input.value.trim();if(!message)return;
    const context=panel.querySelector("#dw-ai-include").checked?toolContext():"";
    add("user",message);history.push({role:"user",content:message});input.value="";send.disabled=true;send.textContent="…";
    const wait=document.createElement("div");wait.className="dw-ai-msg bot";wait.textContent="Thinking…";messages.appendChild(wait);messages.scrollTop=messages.scrollHeight;
    try{const result=await callAI({tool:AI_TOOL,message,history:history.slice(0,-1),context});wait.remove();add("assistant",result.reply||"I couldn't prepare a response.");history.push({role:"assistant",content:result.reply||""});if(history.length>12)history.splice(0,history.length-12);}
    catch(e){wait.remove();add("assistant","I couldn't reach the AI service. "+e.message);}
    finally{send.disabled=false;send.textContent="Send";input.focus();}
  }
  launcher.addEventListener("click",()=>panel.classList.toggle("open"));
  panel.querySelector("#dw-ai-close").addEventListener("click",()=>panel.classList.remove("open"));
  send.addEventListener("click",submit);
  input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submit();}});
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",mountAssistant,{once:true}); else mountAssistant();
