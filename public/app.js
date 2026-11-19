import { renderVisual } from "./charts.js";

const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const words = (t) => (t || "").trim().split(/\s+/).filter(Boolean).length;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json", "x-ielts": "1" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let cleanup = [];
function teardown() { cleanup.forEach((f) => f()); cleanup = []; document.body.className = ""; }
function every(ms, fn) { const t = setInterval(fn, ms); cleanup.push(() => clearInterval(t)); return t; }

// ---------- display settings (Options menu, as in the computer-delivered test) ----------
const prefs = store.get("ielts-prefs", { size: "standard", contrast: "bow" });
function applyPrefs(root = document.documentElement) {
  root.dataset.size = prefs.size;
  root.dataset.contrast = prefs.contrast;
}
applyPrefs();

// ---------- candidate ----------
function candidate() {
  let c = store.get("ielts-candidate", null);
  if (!c) {
    c = { name: "", number: String(Math.floor(100000 + Math.random() * 899999)) };
    store.set("ielts-candidate", c);
  }
  return c;
}

// ---------- router ----------
function route() {
  teardown();
  const [, view, id] = (location.hash || "#/").slice(1).split("/");
  if (view === "test" && id) return testFlow(id);
  if (view === "result" && id) return resultView(id);
  return dashboard();
}
window.addEventListener("hashchange", route);

// =====================================================================
// Dashboard
// =====================================================================
const STATUS = { generating: "Generating…", error: "Generation failed", ready: "Not started", in_progress: "In progress", grading: "Marking…", grade_error: "Marking failed", graded: "Marked" };

async function dashboard() {
  document.body.className = "site";
  app.innerHTML = `
    <header class="site-head"><div class="brand"><span class="logo">IELTS</span><span>Writing Practice</span></div><span class="tag">Tests written &amp; marked by Claude</span></header>
    <main class="site-main">
      <section class="card new">
        <h2>Start a new Writing test</h2>
        <p class="muted">Claude writes a fresh, exam-style paper: Task 1 and Task 2 in 60 minutes, in the computer-delivered IELTS interface. When you submit, Claude marks it against the four official criteria.</p>
        <form id="newform">
          <fieldset class="seg">
            <label><input type="radio" name="module" value="academic" checked /> Academic</label>
            <label><input type="radio" name="module" value="general" /> General Training</label>
          </fieldset>
          <label class="field">Theme <span class="muted">(optional, e.g. "technology", "environment")</span>
            <input name="topic" maxlength="200" placeholder="Leave blank for a surprise topic" /></label>
          <button class="btn primary" type="submit">Generate test</button>
        </form>
        <p id="mocknote" class="warn" hidden>Mock mode is on: Claude is not being called.</p>
      </section>
      <section class="card">
        <h2>Your tests</h2>
        <div id="list"><p class="muted">Loading…</p></div>
      </section>
    </main>`;
  document.getElementById("newform").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    e.target.querySelector("button").disabled = true;
    try {
      const { session } = await api("POST", "/api/sessions", { module: f.get("module"), topicHint: f.get("topic") });
      location.hash = `#/test/${session.id}`;
    } catch (err) {
      alert(err.message);
      e.target.querySelector("button").disabled = false;
    }
  };
  const draw = async () => {
    const { sessions, mock } = await api("GET", "/api/sessions");
    document.getElementById("mocknote").hidden = !mock;
    const list = document.getElementById("list");
    if (!list) return;
    if (!sessions.length) return (list.innerHTML = `<p class="muted">No tests yet.</p>`);
    const graded = sessions.filter((s) => s.overallBand != null);
    const avg = graded.length ? (graded.reduce((a, s) => a + s.overallBand, 0) / graded.length).toFixed(1) : null;
    list.innerHTML = `
      ${avg ? `<p class="stats">Average band over ${graded.length} marked test${graded.length > 1 ? "s" : ""}: <b>${avg}</b> · Latest: <b>${graded[0].overallBand.toFixed(1)}</b></p>` : ""}
      <table class="list"><thead><tr><th>Date</th><th>Test</th><th>Module</th><th>Status</th><th>Band</th><th></th></tr></thead><tbody>
      ${sessions.map((s) => `<tr>
        <td>${new Date(s.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
        <td>${esc(s.title)}</td><td>${s.module === "general" ? "General" : "Academic"}</td>
        <td><span class="pill ${s.status}">${STATUS[s.status] || s.status}</span></td>
        <td>${s.overallBand != null ? `<b>${s.overallBand.toFixed(1)}</b> <span class="muted">(T1 ${s.taskBands[0]} · T2 ${s.taskBands[1]})</span>` : "—"}</td>
        <td class="actions">
          <a class="btn sm" href="#/${["grading", "graded", "grade_error"].includes(s.status) ? "result" : "test"}/${s.id}">${s.status === "graded" ? "Feedback" : s.status === "in_progress" ? "Resume" : "Open"}</a>
          ${["graded", "grade_error", "grading", "ready", "in_progress"].includes(s.status) ? `<button class="btn sm ghost" data-retake="${s.id}" title="Take the same paper again">Retake</button>` : ""}
          <button class="btn sm ghost" data-del="${s.id}" title="Delete">✕</button>
        </td></tr>`).join("")}
      </tbody></table>`;
    list.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (confirm("Delete this test and its feedback?")) { await api("DELETE", `/api/sessions/${b.dataset.del}`); draw(); } }));
    list.querySelectorAll("[data-retake]").forEach((b) => (b.onclick = async () => { const { session } = await api("POST", "/api/sessions", { retakeOf: b.dataset.retake }); location.hash = `#/test/${session.id}`; }));
    if (sessions.some((s) => ["generating", "grading"].includes(s.status))) setTimeout(() => location.hash === "#/" || !location.hash ? draw() : null, 4000);
  };
  draw().catch((e) => (document.getElementById("list").innerHTML = `<p class="err">${esc(e.message)}</p>`));
}

// =====================================================================
// Test flow (mirrors the computer-delivered IELTS test)
// =====================================================================
function waitScreen(title, sub) {
  document.body.className = "exam-shell";
  app.innerHTML = `<div class="center-screen"><div class="spinner"></div><h2>${esc(title)}</h2><p class="muted">${esc(sub)}</p><p><a href="#/">Back to dashboard</a></p></div>`;
}

async function testFlow(id) {
  let s;
  try {
    ({ session: s } = await api("GET", `/api/sessions/${id}`));
  } catch (e) {
    app.innerHTML = `<div class="center-screen"><h2>Test not found</h2><a href="#/">Back</a></div>`;
    return;
  }
  if (s.status === "generating") {
    waitScreen("Claude is writing your test…", "This usually takes 30–90 seconds. You can leave this page; it will keep generating.");
    every(3000, async () => {
      const { session } = await api("GET", `/api/sessions/${id}`);
      if (session.status !== "generating") route();
    });
    return;
  }
  if (s.status === "error") {
    document.body.className = "exam-shell";
    app.innerHTML = `<div class="center-screen"><h2>Could not generate the test</h2><pre class="errbox">${esc(s.error)}</pre><button class="btn primary" id="retry">Try again</button> <a class="btn" href="#/">Back</a></div>`;
    document.getElementById("retry").onclick = async () => { await api("POST", `/api/sessions/${id}/retry-generate`); route(); };
    return;
  }
  if (["grading", "graded", "grade_error"].includes(s.status)) return (location.hash = `#/result/${id}`);
  if (s.status === "ready") return confirmDetails(s);
  if (s.status === "in_progress") return examScreen(s);
}

function shellHeader(s, { timer = false } = {}) {
  const c = candidate();
  return `<header class="xhead">
    <div class="xbrand"><span class="logo">IELTS</span></div>
    <div class="xcand"><span class="ico">👤</span> <span>${esc(c.name || "Test taker")} – ${esc(c.number)}</span></div>
    ${timer ? `<button class="xtimer" id="timer" title="Click to hide or show the time"><span class="ico">⏱</span> <span id="timetext"></span></button>` : `<div></div>`}
    <div class="xicons"><span class="ico" title="Connected">📶</span><span class="ico" title="Notifications">🔔</span><button class="ico menu" id="menuBtn" title="Options">☰</button></div>
  </header>`;
}

function optionsPanel() {
  const el = document.createElement("div");
  el.className = "modal-back";
  el.innerHTML = `<div class="modal options">
    <div class="modal-head"><b>Options</b><button class="x" aria-label="Close">✕</button></div>
    <h4>Contrast</h4>
    ${[["bow", "Black on white"], ["wob", "White on black"], ["yob", "Yellow on black"]].map(([v, l]) => `<label class="opt"><input type="radio" name="contrast" value="${v}" ${prefs.contrast === v ? "checked" : ""}/> ${l}</label>`).join("")}
    <h4>Text size</h4>
    ${[["standard", "Standard"], ["large", "Large"], ["xlarge", "Extra large"]].map(([v, l]) => `<label class="opt"><input type="radio" name="size" value="${v}" ${prefs.size === v ? "checked" : ""}/> ${l}</label>`).join("")}
    <p class="muted small">Writing tips: you can copy, cut and paste inside your answer. Spell check is turned off, as in the real test.</p>
  </div>`;
  el.addEventListener("change", (e) => { prefs[e.target.name] = e.target.value; store.set("ielts-prefs", prefs); applyPrefs(); });
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest(".x")) el.remove(); });
  document.body.appendChild(el);
}
function wireMenu() { const b = document.getElementById("menuBtn"); if (b) b.onclick = optionsPanel; }

function confirmDetails(s) {
  document.body.className = "exam-shell";
  const c = candidate();
  app.innerHTML = `${shellHeader(s)}
  <div class="center-screen confirm">
    <div class="panel">
      <h2>Confirm your details</h2>
      <div class="detail-row"><span>Name:</span><input id="cname" value="${esc(c.name)}" placeholder="Your name" /></div>
      <div class="detail-row"><span>Date of birth:</span><span>XX/XX/XXXX</span></div>
      <div class="detail-row"><span>Candidate number:</span><span>${esc(c.number)}</span></div>
      <p class="info">ⓘ If your details aren't correct, please inform the invigilator.</p>
      <button class="btn dark" id="ok">My details are correct</button>
    </div>
  </div>`;
  wireMenu();
  document.getElementById("ok").onclick = () => {
    c.name = document.getElementById("cname").value.trim();
    store.set("ielts-candidate", c);
    instructions(s);
  };
}

function instructions(s) {
  const gt = s.module === "general";
  app.innerHTML = `${shellHeader(s)}
  <div class="center-screen instr">
    <div class="panel wide">
      <h2>IELTS ${gt ? "General Training" : "Academic"} Writing</h2>
      <p class="sub">Time: 1 hour</p>
      <h3>INSTRUCTIONS TO CANDIDATES</h3>
      <ul>
        <li>Answer <b>both</b> parts.</li>
        <li>You can change your answers at any time during the test.</li>
      </ul>
      <h3>INFORMATION FOR CANDIDATES</h3>
      <ul>
        <li>There are two parts in this test.</li>
        <li>Part 2 contributes twice as much as Part 1 to the writing score.</li>
        <li>The test clock will show you when there are 10 minutes and 5 minutes remaining.</li>
      </ul>
      <p class="info">ⓘ Do not close the web browser. When the hour is up your answers are submitted automatically.</p>
      <button class="btn dark" id="start">Start test</button>
    </div>
  </div>`;
  wireMenu();
  document.getElementById("start").onclick = async () => {
    const { session } = await api("POST", `/api/sessions/${s.id}/start`);
    examScreen(session);
  };
}

function task1Html(s) {
  const t = s.test.task1;
  if (s.module === "general") {
    return `<p>${esc(t.prompt)}</p>
      <p>In your letter</p>
      <ul class="bul">${(t.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      <p class="mt">Write at least 150 words.</p>
      <p>You do <b>NOT</b> need to write any addresses.</p>
      <p>Begin your letter as follows:</p>
      <p><b>${esc(t.letterOpening || "Dear ...,")}</b></p>`;
  }
  return `<p>${esc(t.prompt)}</p>
    <p>Summarise the information by selecting and reporting the main features, and make comparisons where relevant.</p>
    <p class="mt">Write at least 150 words.</p>
    ${(t.visuals || []).map(renderVisual).join("")}`;
}
function task2Html(s) {
  const t = s.test.task2;
  return `<p>Write about the following topic:</p>
    <div class="topic"><p><b><i>${esc(t.statement)}</i></b></p><p><b><i>${esc(t.question)}</i></b></p></div>
    <p>Give reasons for your answer and include any relevant examples from your own knowledge or experience.</p>
    <p class="mt">Write at least 250 words.</p>`;
}

function examScreen(s) {
  document.body.className = "exam-shell exam";
  const backupKey = `ielts-draft-${s.id}`;
  const backup = store.get(backupKey, null);
  const answers = { task1: s.answers.task1 || "", task2: s.answers.task2 || "" };
  if (backup) for (const k of ["task1", "task2"]) if ((backup[k] || "").length > answers[k].length) answers[k] = backup[k];

  let part = store.get(`${backupKey}-part`, 1);
  let split = store.get("ielts-split", 50);
  let hideTime = false;
  let submitted = false;
  let dirty = false;
  const offset = 0; // server and browser are the same machine
  const highlights = { 1: null, 2: null };

  app.innerHTML = `${shellHeader(s, { timer: true })}
    <div class="partbar" id="partbar"></div>
    <main class="split" id="split">
      <section class="pane task-pane" id="taskPane"></section>
      <div class="divider" id="divider" title="Drag to resize"><span>⋮</span></div>
      <section class="pane write-pane">
        <textarea id="answer" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" aria-label="Your answer"></textarea>
        <div class="wc" id="wc">Words: 0</div>
      </section>
    </main>
    <div class="navarrows"><button id="prev" title="Previous">◀</button><button id="next" title="Next">▶</button></div>
    <footer class="xfoot" id="foot"></footer>`;
  wireMenu();

  const $ = (id) => document.getElementById(id);
  const ta = $("answer");
  const taskPane = $("taskPane");

  function applySplit() { $("split").style.gridTemplateColumns = `${split}% 10px 1fr`; }
  applySplit();

  function renderPart() {
    $("partbar").innerHTML = `<b>Part ${part}</b><span>You should spend about ${part === 1 ? 20 : 40} minutes on this task. Write at least ${part === 1 ? 150 : 250} words.</span>`;
    taskPane.innerHTML = highlights[part] ?? (part === 1 ? task1Html(s) : task2Html(s));
    ta.value = answers[`task${part}`];
    $("wc").textContent = `Words: ${words(ta.value)}`;
    renderFoot();
    store.set(`${backupKey}-part`, part);
    $("prev").disabled = part === 1;
    $("next").disabled = part === 2;
  }
  function renderFoot() {
    $("foot").innerHTML = [1, 2].map((p) => {
      const done = words(answers[`task${p}`]) > 0 ? 1 : 0;
      return p === part
        ? `<button class="fpart active" data-p="${p}"><b>Part ${p}</b><span class="qbox ${done ? "done" : ""}">${p}</span></button>`
        : `<button class="fpart" data-p="${p}"><b>Part ${p}</b><span class="cnt">${done} of 1</span></button>`;
    }).join("") + `<button class="submit" id="submitBtn" title="Submit test">✓</button>`;
    $("foot").querySelectorAll(".fpart").forEach((b) => (b.onclick = () => go(+b.dataset.p)));
    $("submitBtn").onclick = () => confirmSubmit();
  }
  function go(p) {
    if (p === part) return;
    highlights[part] = taskPane.innerHTML;
    part = p;
    renderPart();
  }
  $("prev").onclick = () => go(1);
  $("next").onclick = () => go(2);

  ta.addEventListener("input", () => {
    answers[`task${part}`] = ta.value;
    $("wc").textContent = `Words: ${words(ta.value)}`;
    dirty = true;
    store.set(backupKey, answers);
    renderFootCounts();
  });
  function renderFootCounts() {
    const other = 3 - part;
    const el = $("foot").querySelector(`.fpart[data-p="${part}"] .qbox`);
    if (el) el.classList.toggle("done", words(answers[`task${part}`]) > 0);
    const cnt = $("foot").querySelector(`.fpart[data-p="${other}"] .cnt`);
    if (cnt) cnt.textContent = `${words(answers[`task${other}`]) > 0 ? 1 : 0} of 1`;
  }
  // Disable dropping text dragged in from the prompt, like the real test.
  ta.addEventListener("drop", (e) => e.preventDefault());

  async function save() {
    if (!dirty || submitted) return;
    dirty = false;
    try { await api("POST", `/api/sessions/${s.id}/answers`, answers); } catch { dirty = true; }
  }
  every(5000, save);
  cleanup.push(() => { save(); });

  // ---------- timer ----------
  $("timer").onclick = () => { hideTime = !hideTime; tick(); };
  function tick() {
    const left = Math.max(0, s.deadline - (Date.now() + offset));
    const mins = Math.ceil(left / 60000);
    const text = left <= 60000 ? `${Math.ceil(left / 1000)} seconds left` : `${mins} minutes left`;
    $("timetext").textContent = hideTime ? "Show time" : text;
    const warn = (left <= 10 * 60000 && left > 10 * 60000 - 20000) || (left <= 5 * 60000 && left > 5 * 60000 - 20000) || left <= 60000;
    $("timer").classList.toggle("flash", warn);
    if (left <= 0 && !submitted) doSubmit(true);
  }
  every(1000, tick);
  tick();

  // ---------- split pane drag ----------
  $("divider").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const box = $("split").getBoundingClientRect();
    const move = (ev) => { split = Math.min(80, Math.max(20, ((ev.clientX - box.left) / box.width) * 100)); applySplit(); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); store.set("ielts-split", split); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  // ---------- highlighter (right-click on the question, like the real test) ----------
  const menu = document.getElementById("ctxmenu");
  let target = null;
  const onCtx = (e) => {
    if (!taskPane.contains(e.target)) return;
    e.preventDefault();
    target = e.target.closest(".hl");
    menu.hidden = false;
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.querySelector('[data-act="clear"]').disabled = !target;
  };
  const hideMenu = (e) => { if (!menu.contains(e.target)) menu.hidden = true; };
  menu.onclick = (e) => {
    const act = e.target.dataset.act;
    if (act === "highlight") {
      const sel = window.getSelection();
      if (sel.rangeCount && !sel.isCollapsed && taskPane.contains(sel.anchorNode)) {
        const r = sel.getRangeAt(0);
        try { const span = document.createElement("span"); span.className = "hl"; r.surroundContents(span); }
        catch { // selection crosses elements: highlight each text node piece
          const walker = document.createTreeWalker(r.commonAncestorContainer, NodeFilter.SHOW_TEXT);
          const nodes = [];
          while (walker.nextNode()) if (r.intersectsNode(walker.currentNode)) nodes.push(walker.currentNode);
          for (const n of nodes) {
            const rr = document.createRange();
            rr.selectNodeContents(n);
            if (n === r.startContainer) rr.setStart(n, r.startOffset);
            if (n === r.endContainer) rr.setEnd(n, r.endOffset);
            if (!rr.toString().trim()) continue;
            const span = document.createElement("span"); span.className = "hl"; rr.surroundContents(span);
          }
        }
        sel.removeAllRanges();
      }
    } else if (act === "clear" && target) target.replaceWith(...target.childNodes);
    else if (act === "clearall") taskPane.querySelectorAll(".hl").forEach((h) => h.replaceWith(...h.childNodes));
    menu.hidden = true;
  };
  document.addEventListener("contextmenu", onCtx);
  document.addEventListener("mousedown", hideMenu);
  cleanup.push(() => { document.removeEventListener("contextmenu", onCtx); document.removeEventListener("mousedown", hideMenu); menu.hidden = true; });

  // ---------- submit ----------
  function confirmSubmit() {
    const el = document.createElement("div");
    el.className = "modal-back";
    const w1 = words(answers.task1), w2 = words(answers.task2);
    el.innerHTML = `<div class="modal">
      <div class="modal-head"><b>Submit test</b><button class="x">✕</button></div>
      <p>Are you sure you want to submit your answers? You will not be able to change them.</p>
      <table class="mini"><tr><td>Part 1</td><td>${w1} words${w1 < 150 ? ' <span class="warn">(under 150)</span>' : ""}</td></tr><tr><td>Part 2</td><td>${w2} words${w2 < 250 ? ' <span class="warn">(under 250)</span>' : ""}</td></tr></table>
      <div class="modal-actions"><button class="btn" data-c>Cancel</button><button class="btn dark" data-ok>Submit</button></div></div>`;
    el.onclick = (e) => { if (e.target === el || e.target.closest(".x,[data-c]")) el.remove(); if (e.target.closest("[data-ok]")) { el.remove(); doSubmit(false); } };
    document.body.appendChild(el);
  }
  async function doSubmit(timeUp) {
    if (submitted) return;
    submitted = true;
    ta.readOnly = true;
    try {
      await api("POST", `/api/sessions/${s.id}/submit`, answers);
    } catch {}
    store.del(backupKey);
    teardown();
    document.body.className = "exam-shell";
    app.innerHTML = `${shellHeader(s)}<div class="center-screen"><div class="panel"><h2>${timeUp ? "Time is up" : "Test submitted"}</h2><p>Your answers have been submitted. Claude is now marking your writing.</p><button class="btn dark" id="see">View results</button></div></div>`;
    document.getElementById("see").onclick = () => (location.hash = `#/result/${s.id}`);
    setTimeout(() => { if (document.getElementById("see")) location.hash = `#/result/${s.id}`; }, 2500);
  }

  renderPart();
  ta.focus();
}

// =====================================================================
// Results
// =====================================================================
const CRIT_COLOR = { TA: "ta", TR: "ta", CC: "cc", LR: "lr", GRA: "gra" };
const CRIT_NAME = { TA: "Task Achievement", TR: "Task Response", CC: "Coherence & Cohesion", LR: "Lexical Resource", GRA: "Grammar" };

function annotate(text, anns) {
  // Locate each quote in the answer and wrap it; skip overlaps and quotes not found.
  const lower = text.toLowerCase();
  const spans = [];
  anns.forEach((a, i) => {
    const q = (a.quote || "").trim();
    if (!q) return;
    let at = text.indexOf(q);
    if (at < 0) at = lower.indexOf(q.toLowerCase());
    if (at < 0) return;
    a._found = true;
    spans.push({ start: at, end: at + q.length, i });
  });
  spans.sort((a, b) => a.start - b.start);
  let out = "", pos = 0;
  for (const sp of spans) {
    if (sp.start < pos) continue;
    const a = anns[sp.i];
    out += esc(text.slice(pos, sp.start)) + `<mark class="ann ${CRIT_COLOR[a.criterion] || ""} ${a.severity}" data-i="${sp.i}">${esc(text.slice(sp.start, sp.end))}<sup>${sp.i + 1}</sup></mark>`;
    pos = sp.end;
  }
  return out + esc(text.slice(pos));
}

async function resultView(id) {
  document.body.className = "site";
  let s;
  try { ({ session: s } = await api("GET", `/api/sessions/${id}`)); }
  catch { app.innerHTML = `<div class="center-screen"><h2>Not found</h2><a href="#/">Back</a></div>`; return; }
  if (["ready", "in_progress", "generating", "error"].includes(s.status)) return (location.hash = `#/test/${id}`);

  const head = `<header class="site-head"><div class="brand"><span class="logo">IELTS</span><span>Writing Practice</span></div><a class="btn sm" href="#/">← Dashboard</a></header>`;
  if (s.status === "grading") {
    app.innerHTML = `${head}<div class="center-screen"><div class="spinner"></div><h2>Claude is marking your writing…</h2><p class="muted">An examiner-style assessment of both tasks usually takes 1–3 minutes.</p></div>`;
    every(4000, async () => { const { session } = await api("GET", `/api/sessions/${id}`); if (session.status !== "grading") route(); });
    return;
  }
  if (s.status === "grade_error") {
    app.innerHTML = `${head}<div class="center-screen"><h2>Marking failed</h2><pre class="errbox">${esc(s.error)}</pre><p class="muted">Your answers are saved.</p><button class="btn primary" id="retry">Retry marking</button></div>`;
    document.getElementById("retry").onclick = async () => { await api("POST", `/api/sessions/${id}/retry-grade`); route(); };
    return;
  }

  const r = s.result;
  const t1 = r.tasks.find((t) => t.task === 1), t2 = r.tasks.find((t) => t.task === 2);
  app.innerHTML = `${head}
  <main class="site-main result">
    <section class="card scorecard">
      <div class="overall"><div class="lbl">Writing band</div><div class="big">${r.overallBand.toFixed(1)}</div><div class="muted small">(Task 1 + 2 × Task 2) ÷ 3, rounded as IELTS does</div></div>
      <div class="taskbands">
        ${[t1, t2].map((t) => `<div class="tb"><div class="lbl">Task ${t.task}</div><div class="mid">${t.band.toFixed(1)}</div><div class="muted small">${t.wordCount} words</div>
          <div class="crit-mini">${t.criteria.map((c) => `<span title="${esc(c.name)}">${esc(abbr(c.name))} <b>${c.band}</b></span>`).join("")}</div></div>`).join("")}
      </div>
      <div class="ex-comment"><h3>Examiner's summary</h3><p>${esc(r.examinerComment)}</p>
        <p class="muted small">Practice estimate by Claude, not an official IELTS score. ${esc(s.test.title || "")} · ${s.module === "general" ? "General Training" : "Academic"} · submitted ${new Date(s.submittedAt).toLocaleString("en-GB")}</p>
        <div class="row"><button class="btn primary" id="retake">Retake this test</button><a class="btn" href="#/">New test</a></div>
      </div>
    </section>

    <section class="card">
      <h2>What to work on</h2>
      <ol class="priorities">${(r.priorities || []).map((p) => `<li><div class="ph"><b>${esc(p.title)}</b> <span class="ctag">${esc(p.criterion)}</span></div><p>${esc(p.detail)}</p>${p.practice ? `<p class="practice"><b>Practice:</b> ${esc(p.practice)}</p>` : ""}</li>`).join("")}</ol>
    </section>

    <div class="tabs" id="tabs"><button data-t="1" class="on">Task 1 feedback</button><button data-t="2">Task 2 feedback</button></div>
    <div id="taskfb"></div>
  </main>`;

  document.getElementById("retake").onclick = async () => { const { session } = await api("POST", "/api/sessions", { retakeOf: id }); location.hash = `#/test/${session.id}`; };
  const tabs = document.getElementById("tabs");
  const show = (n) => {
    tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.t == n));
    taskFeedback(s, r.tasks.find((t) => t.task === n));
  };
  tabs.onclick = (e) => { if (e.target.dataset.t) show(+e.target.dataset.t); };
  show(1);
}

function abbr(name) {
  const n = name.toLowerCase();
  if (n.startsWith("task a")) return "TA";
  if (n.startsWith("task r")) return "TR";
  if (n.startsWith("coh")) return "CC";
  if (n.startsWith("lex")) return "LR";
  return "GRA";
}

function taskFeedback(s, t) {
  const el = document.getElementById("taskfb");
  const answer = s.answers[`task${t.task}`] || "";
  const anns = (t.annotations || []).map((a) => ({ ...a }));
  const marked = annotate(answer, anns);
  el.innerHTML = `
    <section class="card">
      <p>${esc(t.overview)}</p>
      <div class="criteria">${t.criteria.map((c) => `
        <div class="crit"><div class="ch"><span>${esc(c.name)}</span><span class="cb">${c.band}</span></div>
          <p>${esc(c.summary)}</p>
          ${c.strengths?.length ? `<div class="good"><b>Strengths</b><ul>${c.strengths.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
          ${c.weaknesses?.length ? `<div class="bad"><b>To improve</b><ul>${c.weaknesses.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
        </div>`).join("")}</div>
    </section>
    <section class="card">
      <h2>Your answer, marked up</h2>
      <p class="legend-row"><span class="ann ta">Task</span><span class="ann cc">Coherence</span><span class="ann lr">Vocabulary</span><span class="ann gra">Grammar</span> <span class="muted small">Click a highlight to see the comment.</span></p>
      <div class="annot-grid">
        <div class="essay">${marked || '<p class="muted">No answer was written.</p>'}</div>
        <ol class="annlist">${anns.map((a, i) => `<li id="ann-${i}" class="${CRIT_COLOR[a.criterion] || ""}"><div><span class="num">${i + 1}</span> <span class="ctag">${esc(CRIT_NAME[a.criterion] || a.criterion)}</span> ${a.severity === "major" ? '<span class="sev">major</span>' : ""}</div>
          <q>${esc(a.quote)}</q><p>${esc(a.issue)}</p><p class="fix">→ ${esc(a.fix)}</p>${a._found ? "" : '<p class="muted small">(quote not located in the text)</p>'}</li>`).join("")}</ol>
      </div>
    </section>
    <section class="card">
      <details><summary><b>Band 8–9 version of your answer</b></summary><div class="essay model">${esc(t.improvedVersion)}</div></details>
      <details><summary><b>The question</b></summary><div class="qrecap">${t.task === 1 ? task1Html(s) : task2Html(s)}</div></details>
    </section>`;
  el.querySelectorAll("mark.ann").forEach((m) => (m.onclick = () => {
    const li = document.getElementById(`ann-${m.dataset.i}`);
    li.scrollIntoView({ behavior: "smooth", block: "center" });
    li.classList.add("pulse");
    setTimeout(() => li.classList.remove("pulse"), 1200);
  }));
}

route();
