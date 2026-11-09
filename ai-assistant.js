/* DocuWorks Studio — 100% local browser AI assistant
 * WebLLM + WebGPU. No API key. No AI backend. No server inference.
 * First run requires internet to download the model; WebLLM then caches
 * the model artifacts in the browser Cache API for later/offline use.
 */
import { CreateWebWorkerMLCEngine, prebuiltAppConfig } from "https://esm.run/@mlc-ai/web-llm@0.2.87";

const DW_AI_MODEL = "Llama-3.2-3B-Instruct-q4f16_1-MLC";
const DW_AI_FALLBACK_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
const DW_AI_MAX_TOKENS = 512;
const DW_AI_STORAGE_KEY = "docuworks-local-ai-chat-v1";

let dwAiEngine = null;
let dwAiWorker = null;
let dwAiLoading = false;
let dwAiMessages = loadHistory();

function loadHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(DW_AI_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.slice(-30) : [];
  } catch (_) { return []; }
}
function saveHistory() {
  try { localStorage.setItem(DW_AI_STORAGE_KEY, JSON.stringify(dwAiMessages.slice(-30))); } catch (_) {}
}
function addMessage(role, content) {
  dwAiMessages.push({ role, content });
  dwAiMessages = dwAiMessages.slice(-30);
  saveHistory();
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
}

function makeUI() {
  if (document.getElementById("dwAiLauncher")) return;
  const launcher = document.createElement("button");
  launcher.id = "dwAiLauncher";
  launcher.className = "dw-ai-launcher";
  launcher.type = "button";
  launcher.title = "Open local AI assistant";
  launcher.setAttribute("aria-label", "Open local AI assistant");
  launcher.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17.5 3.8 20l.8-4.3A8.5 8.5 0 0 1 3 10.8C3 6.5 7 3 12 3s9 3.5 9 7.8-4 7.7-9 7.7c-1.8 0-3.5-.4-5-1Z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></svg>';

  const panel = document.createElement("section");
  panel.id = "dwAiPanel";
  panel.className = "dw-ai-panel";
  panel.setAttribute("aria-label", "Local AI assistant");
  panel.innerHTML = `
    <div class="dw-ai-head">
      <div class="dw-ai-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="4.2"/></svg></div>
      <div class="dw-ai-head-copy"><strong>DocuWorks Local AI</strong><span id="dwAiModelLabel">Llama 3.2 3B · WebGPU</span></div>
      <button class="dw-ai-close" id="dwAiClose" type="button" aria-label="Close">×</button>
    </div>
    <div class="dw-ai-status" id="dwAiStatus"><span id="dwAiStatusText">Preparing AI engine…</span><div class="dw-ai-progress"><span id="dwAiProgress"></span></div></div>
    <div class="dw-ai-messages" id="dwAiMessages"></div>
    <div class="dw-ai-compose">
      <textarea id="dwAiInput" class="dw-ai-input" rows="1" placeholder="Ask anything…" aria-label="Message"></textarea>
      <button id="dwAiSend" class="dw-ai-send" type="button" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 4 16 8-16 8 3-8-3-8Z"/><path d="M7 12h13"/></svg></button>
    </div>
    <div class="dw-ai-note">Runs locally in this browser · No API key · No cloud inference</div>
  `;
  document.body.append(launcher, panel);

  launcher.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) {
      renderMessages();
      if (!dwAiEngine && !dwAiLoading) ensureEngine();
      setTimeout(() => document.getElementById("dwAiInput")?.focus(), 50);
    }
  });
  document.getElementById("dwAiClose").addEventListener("click", () => panel.classList.remove("open"));
  document.getElementById("dwAiSend").addEventListener("click", sendMessage);
  document.getElementById("dwAiInput").addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); }
  });
  document.getElementById("dwAiInput").addEventListener("input", autoGrow);
  renderMessages();
}

function autoGrow(event) {
  const el = event.target;
  el.style.height = "42px";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}
function renderMessages() {
  const box = document.getElementById("dwAiMessages");
  if (!box) return;
  if (!dwAiMessages.length) {
    box.innerHTML = '<div class="dw-ai-empty"><div class="dw-ai-empty-inner"><strong>Private, local AI</strong><p>Your messages stay in this browser. Open the assistant and send a message to load the local 3B model.</p></div></div>';
    return;
  }
  box.innerHTML = dwAiMessages.map(m =>
    '<div class="dw-ai-msg ' + (m.role === "user" ? "user" : "assistant") + '">' +
    '<div class="dw-ai-bubble">' + escapeHtml(m.content) + "</div></div>"
  ).join("");
  box.scrollTop = box.scrollHeight;
}
function setStatus(text, progress = null) {
  const status = document.getElementById("dwAiStatus");
  const label = document.getElementById("dwAiStatusText");
  const bar = document.getElementById("dwAiProgress");
  if (!status || !label || !bar) return;
  status.classList.add("show");
  label.textContent = text;
  bar.style.width = progress === null ? "100%" : Math.max(0, Math.min(100, progress * 100)) + "%";
}
function hideStatus() { document.getElementById("dwAiStatus")?.classList.remove("show"); }
function showUnsupported(message) {
  const box = document.getElementById("dwAiMessages");
  if (!box) return;
  box.innerHTML = '<div class="dw-ai-unsupported"><strong>Local AI unavailable</strong>' + escapeHtml(message) + '<br><br>This assistant requires WebGPU. Try a current Chrome, Edge, Safari, or another browser version with WebGPU enabled.</div>';
}

async function ensureEngine() {
  if (dwAiEngine || dwAiLoading) return;
  dwAiLoading = true;
  const send = document.getElementById("dwAiSend");
  if (send) send.disabled = true;

  if (!("gpu" in navigator)) {
    showUnsupported("WebGPU is not supported on this browser version.");
    dwAiLoading = false;
    return;
  }
  let adapter = null;
  try { adapter = await navigator.gpu.requestAdapter(); } catch (_) {}
  if (!adapter) {
    showUnsupported("WebGPU is available but no compatible GPU adapter could be initialized.");
    dwAiLoading = false;
    return;
  }

  setStatus("Loading AI Engine: 0% — preparing…", 0);
  try {
    dwAiWorker = new Worker("./webllm-worker.js", { type: "module" });
    const appConfig = { ...prebuiltAppConfig, cacheBackend: "cache" };
    dwAiEngine = await CreateWebWorkerMLCEngine(dwAiWorker, DW_AI_MODEL, {
      appConfig,
      initProgressCallback: report => {
        const progress = typeof report.progress === "number" ? report.progress : 0;
        setStatus(`Loading AI Engine: ${Math.round(progress * 100)}% — ${report.text || "Loading model…"}`, progress);
      },
      logLevel: "WARN"
    }, { context_window_size: 4096, temperature: 0.7, max_tokens: DW_AI_MAX_TOKENS });
    hideStatus();
    document.getElementById("dwAiModelLabel").textContent = "Llama 3.2 3B · ready offline";
  } catch (error) {
    console.error("WebLLM 3B initialization failed:", error);
    try { dwAiWorker?.terminate(); } catch (_) {}
    dwAiWorker = null;
    dwAiEngine = null;

    setStatus("3B model could not start. Trying the low-memory 1B model…", 0);
    try {
      dwAiWorker = new Worker("./webllm-worker.js", { type: "module" });
      dwAiEngine = await CreateWebWorkerMLCEngine(dwAiWorker, DW_AI_FALLBACK_MODEL, {
        appConfig: { ...prebuiltAppConfig, cacheBackend: "cache" },
        initProgressCallback: report => {
          const progress = typeof report.progress === "number" ? report.progress : 0;
          setStatus(`Loading AI Engine: ${Math.round(progress * 100)}% — low-memory fallback`, progress);
        },
        logLevel: "WARN"
      }, { context_window_size: 4096, temperature: 0.7, max_tokens: DW_AI_MAX_TOKENS });
      document.getElementById("dwAiModelLabel").textContent = "Llama 3.2 1B · low-memory fallback";
      hideStatus();
    } catch (fallbackError) {
      console.error("WebLLM fallback initialization failed:", fallbackError);
      showUnsupported("The browser has WebGPU, but this device could not initialize the local model. A smaller model may be required.");
      try { dwAiWorker?.terminate(); } catch (_) {}
      dwAiWorker = null;
      dwAiEngine = null;
    }
  } finally {
    dwAiLoading = false;
    if (send) send.disabled = !dwAiEngine;
  }
}

async function sendMessage() {
  const input = document.getElementById("dwAiInput");
  const send = document.getElementById("dwAiSend");
  const box = document.getElementById("dwAiMessages");
  if (!input || !send || !box) return;
  const text = input.value.trim();
  if (!text || send.disabled) return;

  if (!dwAiEngine) {
    await ensureEngine();
    if (!dwAiEngine) return;
  }

  input.value = "";
  input.style.height = "42px";
  addMessage("user", text);
  renderMessages();

  const assistantWrap = document.createElement("div");
  assistantWrap.className = "dw-ai-msg assistant";
  assistantWrap.innerHTML = '<div class="dw-ai-bubble"><span class="dw-ai-typing"><i></i><i></i><i></i></span></div>';
  box.appendChild(assistantWrap);
  box.scrollTop = box.scrollHeight;

  send.disabled = true;
  let answer = "";
  try {
    const stream = await dwAiEngine.chat.completions.create({
      model: dwAiEngine.modelId?.[0] || DW_AI_MODEL,
      messages: dwAiMessages,
      temperature: 0.7,
      max_tokens: DW_AI_MAX_TOKENS,
      stream: true
    });
    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content || "";
      if (!delta) continue;
      answer += delta;
      assistantWrap.querySelector(".dw-ai-bubble").textContent = answer;
      box.scrollTop = box.scrollHeight;
    }
    if (!answer) answer = "I could not generate a response.";
    addMessage("assistant", answer);
  } catch (error) {
    console.error("Local AI generation failed:", error);
    assistantWrap.querySelector(".dw-ai-bubble").textContent = "The local model stopped unexpectedly. Please try again.";
  } finally {
    send.disabled = false;
    input.focus();
  }
}

document.addEventListener("DOMContentLoaded", makeUI);

/* Conservative local review: hierarchy metadata only; never rewrites source text. */
async function reviewCSRows(sheets) {
  await ensureEngine();
  if (!dwAiEngine) return { sheets, reviewed: false, reason: "Local AI unavailable." };
  const resultSheets = sheets.map(sheet => ({ ...sheet, rows: sheet.rows.map(row => ({ ...row })) }));
  let applied = 0;
  for (let si = 0; si < resultSheets.length; si++) {
    const rows = resultSheets[si].rows;
    const targets = rows.map((row, ri) => ({ ri, row }))
      .filter(x => x.row?.type === "row" && !x.row.parentDisplay && !x.row.parentRequirement && !x.row.parameterized && x.row.req);
    const suggestions = new Map();
    for (let start = 0; start < targets.length; start += 6) {
      const batch = targets.slice(start, start + 6);
      const prompt = "Review these extracted URS requirement labels. Find only obvious repeated parent-heading groups. Never invent a heading. For every input row return index, parent and child. Use empty parent/child if uncertain or standalone. Child is the label with the parent prefix removed. Do not rewrite source text or specifications. Return ONLY a JSON array. Rows: " +
        JSON.stringify(batch.map((x, index) => ({ index, requirement: String(x.row.req || "").slice(0, 220) })));
      try {
        const response = await dwAiEngine.chat.completions.create({
          model: dwAiEngine.modelId?.[0] || DW_AI_MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1, max_tokens: 768
        });
        const raw = response?.choices?.[0]?.message?.content || "";
        const match = raw.match(/\[[\s\S]*\]/);
        if (!match) continue;
        const parsed = JSON.parse(match[0]);
        if (!Array.isArray(parsed)) continue;
        for (const item of parsed) {
          if (!Number.isInteger(item.index) || item.index < 0 || item.index >= batch.length) continue;
          const parent = String(item.parent || "").trim(), child = String(item.child || "").trim();
          if (!parent || !child || parent.length > 120 || child.length > 180 || parent.toLowerCase() === child.toLowerCase()) continue;
          suggestions.set(batch[item.index].ri, { parent, child });
        }
      } catch (error) { console.warn("Local AI review batch skipped:", error); }
    }
    // Apply only adjacent groups of at least two rows sharing exactly one parent.
    for (let i = 0; i < rows.length;) {
      const first = suggestions.get(i);
      if (!first) { i++; continue; }
      const key = first.parent.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      let j = i + 1;
      while (j < rows.length) {
        const next = suggestions.get(j);
        if (!next || next.parent.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() !== key) break;
        j++;
      }
      if (j - i >= 2) {
        for (let k = i; k < j; k++) {
          const suggestion = suggestions.get(k), row = rows[k];
          row.parent = suggestion.parent;
          row.parentDisplay = suggestion.parent;
          row.parentRequirement = suggestion.parent;
          row.parentKey = "local-ai:" + key;
          row.label = suggestion.child;
          row.parameterized = true;
          applied++;
        }
      }
      i = Math.max(i + 1, j);
    }
  }
  return { sheets: resultSheets, reviewed: true, applied };
}
window.DWLocalAIReviewCS = reviewCSRows;
