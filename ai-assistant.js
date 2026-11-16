import "./agent-tools.js";
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
  const d = document;
  const parts = ["Page: " + (d.title || location.pathname)];
  const fields = [...d.querySelectorAll("input,textarea,select")].filter(el =>
    el.type !== "file" && el.type !== "password" && el.type !== "hidden" &&
    el.id !== "aiMessage" && el.offsetParent !== null
  );
  for (const el of fields) {
    const label = el.labels?.[0]?.innerText || el.getAttribute("aria-label") || el.name || el.id || el.tagName;
    const value = el.type === "checkbox" ? (el.checked ? "Yes" : "No") : String(el.value || "").trim();
    if (value) parts.push(label + ": " + value);
  }
  for (const el of d.querySelectorAll('input[type="file"]')) {
    for (const file of Array.from(el.files || [])) parts.push("Selected file: " + file.name + " (" + file.size + " bytes)");
  }
  const main = d.querySelector("main") || d.querySelector("#app");
  if (main?.innerText) parts.push("Visible workspace: " + main.innerText.replace(/\\n{3,}/g,"\\n\\n").slice(0,5000));
  return parts.join("\\n").slice(0,10000);
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
async function runAgent(message, history=[], context="", ui={}) {
  const transcript = Array.isArray(history) ? history : [];
  if (message) transcript.push({role:"user",content:String(message).slice(0,6000)});
  const availableTools = window.DocuWorksAgentTools?.getAvailableTools(AI_TOOL) || ["inspect_current_tool","open_docuworks_tool"];
  if (!transcript.some(item => item.role === "user")) throw new Error("Write a message before starting the agent.");
  for (let turn=0; turn<5; turn++) {
    if (typeof ui.onStatus === "function") ui.onStatus(turn===0 ? "Understanding your request…" : "Checking the result and deciding the next step…");
    const result = await callAI({
      tool:AI_TOOL, mode:"agent", history:transcript.slice(-18),
      context:context || toolContext(), availableTools
    });
    const calls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
    if (!calls.length) {
      const reply = result.reply || "I couldn't prepare a response.";
      transcript.push({role:"assistant",content:reply});
      if (transcript.length>24) transcript.splice(0,transcript.length-24);
      return reply;
    }
    const modelCalls = calls.map(call=>({
      id:String(call.id || "dw-call-"+turn),
      type:"function",
      function:{name:String(call.name||""),arguments:JSON.stringify(call.arguments||{})}
    }));
    transcript.push({role:"assistant",content:result.reply||"",tool_calls:modelCalls});
    for (const call of calls) {
      const name=String(call.name||"");
      if (!availableTools.includes(name) || !window.DocuWorksAgentTools) {
        transcript.push({role:"tool",name,tool_call_id:String(call.id||""),content:JSON.stringify({ok:false,error:"This action is not available in the current workspace."})});
        continue;
      }
      if (typeof ui.onStatus === "function") ui.onStatus("Preparing: "+name.replace(/_/g," ")+"…");
      let outcome;
      try {
        if (window.DocuWorksAgentTools.approvalRequired(name)) {
          const approve = typeof ui.approve === "function"
            ? await ui.approve(call)
            : window.confirm("DocuWorks AI wants to run: "+name.replace(/_/g," ")+". Proceed?");
          if (!approve) {
            outcome={ok:false,declined:true,message:"The user declined this action. Do not attempt it again unless the user asks."};
          } else {
            outcome={ok:true,result:await window.DocuWorksAgentTools.execute(name,call.arguments||{})};
          }
        } else {
          outcome={ok:true,result:await window.DocuWorksAgentTools.execute(name,call.arguments||{})};
        }
      } catch (error) {
        outcome={ok:false,error:error?.message||String(error)};
      }
      transcript.push({
        role:"tool",name,tool_call_id:String(call.id||""),
        content:JSON.stringify(outcome).slice(0,3000)
      });
    }
  }
  const reply="I completed the available action steps, but reached the action limit for this message. Check the current page for the progress or result before asking me to continue.";
  transcript.push({role:"assistant",content:reply});
  return reply;
}

window.DocuWorksAI = {
  ask: (message, history=[], context="") => callAI({tool:AI_TOOL,message,history,context}),
  askDesign: (message, design, intent="update") => callAI({tool:"project360",mode:"design",intent,message,design}),
  runAgent
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
  .dw-ai-approval{align-self:flex-start;max-width:96%;background:#fff;border:1px solid #e6b85c;border-radius:12px;padding:11px 12px;color:#293b52}
  .dw-ai-approval strong{display:block;font-size:12px;margin-bottom:4px}
  .dw-ai-approval p{font-size:11px;color:#64748b;margin:0 0 9px;white-space:pre-wrap}
  .dw-ai-approval-actions{display:flex;gap:7px}
  .dw-ai-approval button{border:0;border-radius:8px;padding:8px 11px;font-size:11px;font-weight:800;cursor:pointer}
  .dw-ai-approval .allow{background:#176b55;color:#fff}.dw-ai-approval .deny{background:#edf1f6;color:#52627a}
  .dw-ai-step{align-self:flex-start;color:#61748f;background:#edf3ff;border-radius:8px;padding:6px 9px;font-size:10px}
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
  function showApprovalCard(call){
    return new Promise(resolve=>{
      const card=document.createElement("div");card.className="dw-ai-approval";
      const title=document.createElement("strong");title.textContent="Approval required";
      const detail=document.createElement("p");
      const labels={
        start_urs_cs_conversion:"Send the selected URS document to Cloudflare AI for requirement extraction?",
        create_cs_excel:"Create and download the CS Excel workbook from the reviewed rows?",
        scan_export_pdf:"Continue with the scanner's PDF export action?",
        optimize_pdfs:"Run the PDF optimizer on the selected documents?",
        export_cleaned_pdf:"Download the cleaned PDF?"
      };
      detail.textContent=labels[call.name]||("Allow DocuWorks to run "+String(call.name||"this action").replace(/_/g," ")+"?");
      const actions=document.createElement("div");actions.className="dw-ai-approval-actions";
      const yes=document.createElement("button");yes.className="allow";yes.type="button";yes.textContent="Approve";
      const no=document.createElement("button");no.className="deny";no.type="button";no.textContent="Decline";
      const finish=value=>{yes.disabled=true;no.disabled=true;card.remove();resolve(value);};
      yes.addEventListener("click",()=>finish(true));no.addEventListener("click",()=>finish(false));
      actions.append(yes,no);card.append(title,detail,actions);messages.appendChild(card);messages.scrollTop=messages.scrollHeight;
    });
  }
  async function submit(){
    const message=input.value.trim();if(!message)return;
    const context=panel.querySelector("#dw-ai-include").checked?toolContext():"";
    add("user",message);history.push({role:"user",content:message});input.value="";send.disabled=true;send.textContent="…";
    const wait=document.createElement("div");wait.className="dw-ai-msg bot";wait.textContent="Thinking…";messages.appendChild(wait);messages.scrollTop=messages.scrollHeight;
    try{
      const reply=await runAgent(message,history.slice(0,-1),context,{
        onStatus:label=>{wait.textContent=label;},
        approve:call=>showApprovalCard(call)
      });
      wait.remove();add("assistant",reply);
    }
    catch(e){wait.remove();add("assistant","I couldn't complete that task. "+e.message);}
    finally{send.disabled=false;send.textContent="Send";input.focus();}
  }
  launcher.addEventListener("click",()=>panel.classList.toggle("open"));
  panel.querySelector("#dw-ai-close").addEventListener("click",()=>panel.classList.remove("open"));
  send.addEventListener("click",submit);
  input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();submit();}});
}
// Project 360 has its own compact circular launcher and design-edit popup in project360.html.
// Keep the shared AI API available there, but do not inject a second text launcher over it.
if (AI_TOOL !== "project360") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",mountAssistant,{once:true});
  else mountAssistant();
}
