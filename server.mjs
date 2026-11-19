// IELTS Writing test platform — zero-dependency Node server.
// Generates tests and grades answers through the local `claude` CLI.
import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGeneratePrompt, buildGradePrompt, TEST_SCHEMA, GRADE_SCHEMA } from "./prompts.mjs";
import { mockTest, mockGrade } from "./mock.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const SESSIONS = path.join(DATA, "sessions");
const WORKDIR = path.join(DATA, "claude-work"); // empty dir the CLI runs in
fs.mkdirSync(SESSIONS, { recursive: true });
fs.mkdirSync(WORKDIR, { recursive: true });

const PORT = Number(process.env.PORT || 4000);
const HOST = "127.0.0.1";
const MOCK = process.env.WRITING_MOCK === "1";
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || ""; // empty = CLI default
const TIMEOUT_MS = 8 * 60 * 1000;
const TEST_MINUTES = 60;

// ---------- storage ----------
const file = (id) => path.join(SESSIONS, `${id}.json`);
const validId = (id) => /^[a-f0-9-]{36}$/.test(id);
function load(id) {
  if (!validId(id) || !fs.existsSync(file(id))) return null;
  return JSON.parse(fs.readFileSync(file(id), "utf8"));
}
function save(s) {
  s.updatedAt = new Date().toISOString();
  const tmp = file(s.id) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, file(s.id));
  return s;
}
function listSessions() {
  return fs
    .readdirSync(SESSIONS)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(SESSIONS, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Jobs interrupted by a restart can't resume: mark them failed so they can be retried.
for (const s of listSessions()) {
  if (s.status === "generating" || s.status === "grading") {
    s.error = "Server restarted while Claude was working. Retry below.";
    s.status = s.status === "generating" ? "error" : "grade_error";
    save(s);
  }
}

// ---------- claude CLI ----------
function cleanEnv() {
  // Drop variables inherited from a parent Claude Code session so the CLI
  // uses the user's own login, not the parent's transport.
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (
      k === "CLAUDECODE" ||
      k === "ANTHROPIC_BASE_URL" ||
      k === "AI_AGENT" ||
      k.startsWith("CLAUDE_CODE_") ||
      k.startsWith("CLAUDE_AGENT_SDK") ||
      k === "CLAUDE_PID" ||
      k === "CLAUDE_EFFORT"
    )
      delete env[k];
  }
  return env;
}

function runClaude(prompt, schema) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--output-format", "json",
      "--tools", "",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--json-schema", JSON.stringify(schema),
    ];
    if (CLAUDE_MODEL) args.push("--model", CLAUDE_MODEL);
    const child = spawn(CLAUDE_BIN, args, { cwd: WORKDIR, env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Claude took longer than 8 minutes and was stopped."));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(e.code === "ENOENT" ? `Could not find the '${CLAUDE_BIN}' CLI on PATH. Set CLAUDE_BIN.` : e.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const line = out.trim().split("\n").filter(Boolean).pop() || "";
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return reject(new Error(`Claude CLI exited (${code}) without JSON output. ${err.slice(-400)}`));
      }
      if (msg.is_error) return reject(new Error(`Claude CLI error: ${msg.result || msg.terminal_reason}`));
      let data = msg.structured_output;
      if (!data && typeof msg.result === "string") {
        const m = msg.result.match(/\{[\s\S]*\}/);
        try {
          data = m && JSON.parse(m[0]);
        } catch {}
      }
      if (!data) return reject(new Error("Claude did not return structured JSON."));
      resolve(data);
    });
    child.stdin.end(prompt);
  });
}

// ---------- scoring ----------
// IELTS rounding: .25 rounds up to .5, .75 rounds up to the next whole band.
const roundBand = (x) => Math.min(9, Math.max(0, Math.floor(x * 2 + 0.5) / 2));
const countWords = (t) => (t || "").trim().split(/\s+/).filter(Boolean).length;

function finaliseGrade(g, session) {
  const tasks = (g.tasks || []).map((t) => {
    const crit = (t.criteria || []).map((c) => ({ ...c, band: Math.min(9, Math.max(0, Math.round(Number(c.band) || 0))) }));
    const avg = crit.length ? crit.reduce((a, c) => a + c.band, 0) / crit.length : 0;
    const answer = session.answers?.[`task${t.task}`] || "";
    return { ...t, criteria: crit, band: countWords(answer) === 0 ? 0 : roundBand(avg), wordCount: countWords(answer) };
  });
  const t1 = tasks.find((t) => t.task === 1)?.band ?? 0;
  const t2 = tasks.find((t) => t.task === 2)?.band ?? 0;
  return { ...g, tasks, overallBand: roundBand((t1 + 2 * t2) / 3) };
}

// ---------- jobs ----------
async function generate(id) {
  const s = load(id);
  try {
    const test = MOCK ? await mockTest(s.module) : await runClaude(buildGeneratePrompt(s.module, s.topicHint), TEST_SCHEMA);
    Object.assign(s, { test, status: "ready", error: null });
  } catch (e) {
    Object.assign(s, { status: "error", error: e.message });
  }
  save(s);
}

async function grade(id) {
  const s = load(id);
  try {
    const raw = MOCK ? await mockGrade() : await runClaude(buildGradePrompt(s), GRADE_SCHEMA);
    const cur = load(id);
    Object.assign(cur, { result: finaliseGrade(raw, cur), status: "graded", error: null, gradedAt: new Date().toISOString() });
    save(cur);
  } catch (e) {
    const cur = load(id);
    Object.assign(cur, { status: "grade_error", error: e.message });
    save(cur);
  }
}

function newSession({ module, topicHint, test }) {
  const s = {
    id: randomUUID(),
    module: module === "general" ? "general" : "academic",
    topicHint: String(topicHint || "").slice(0, 200),
    createdAt: new Date().toISOString(),
    status: test ? "ready" : "generating",
    test: test || null,
    answers: { task1: "", task2: "" },
    startedAt: null,
    deadline: null,
    submittedAt: null,
    result: null,
    error: null,
  };
  return save(s);
}

function summary(s) {
  return {
    id: s.id,
    module: s.module,
    status: s.status,
    createdAt: s.createdAt,
    submittedAt: s.submittedAt,
    title: s.test?.title || (s.topicHint ? `Topic: ${s.topicHint}` : "New test"),
    overallBand: s.result?.overallBand ?? null,
    taskBands: s.result?.tasks?.map((t) => t.band) ?? null,
  };
}

// ---------- http ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

function send(res, code, body) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  let raw = "";
  for await (const c of req) {
    raw += c;
    if (raw.length > 2_000_000) throw new Error("Body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}`);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] !== "api") {
      const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const p = path.normalize(path.join(PUBLIC, rel));
      const target = p.startsWith(PUBLIC) && fs.existsSync(p) && fs.statSync(p).isFile() ? p : path.join(PUBLIC, "index.html");
      res.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
      return fs.createReadStream(target).pipe(res);
    }

    if (req.method !== "GET" && req.headers["x-ielts"] !== "1") return send(res, 403, { error: "Missing header" });

    // GET /api/sessions
    if (parts[1] === "sessions" && parts.length === 2) {
      if (req.method === "GET") return send(res, 200, { sessions: listSessions().map(summary), mock: MOCK });
      if (req.method === "POST") {
        const body = await readBody(req);
        let test = null;
        if (body.retakeOf) {
          const prev = load(body.retakeOf);
          if (!prev?.test) return send(res, 404, { error: "Original test not found" });
          test = prev.test;
          body.module = prev.module;
        }
        const s = newSession({ ...body, test });
        if (!test) generate(s.id);
        return send(res, 201, { session: s });
      }
    }

    const s = parts[1] === "sessions" && parts[2] ? load(parts[2]) : null;
    if (parts[1] === "sessions" && parts[2] && !s) return send(res, 404, { error: "Not found" });
    const action = parts[3];

    if (s && !action && req.method === "GET") {
      // Time ran out while the page was closed: submit what was autosaved.
      if (s.status === "in_progress" && Date.now() > s.deadline + 15000) {
        Object.assign(s, { status: "grading", submittedAt: new Date(s.deadline).toISOString() });
        save(s);
        grade(s.id);
      }
      return send(res, 200, { session: s, now: Date.now() });
    }

    if (s && !action && req.method === "DELETE") {
      fs.rmSync(file(s.id), { force: true });
      return send(res, 200, { ok: true });
    }

    if (s && req.method === "POST") {
      const body = await readBody(req);
      if (action === "retry-generate" && s.status === "error") {
        Object.assign(s, { status: "generating", error: null });
        save(s);
        generate(s.id);
        return send(res, 200, { session: s });
      }
      if (action === "start") {
        if (s.status === "ready") {
          s.status = "in_progress";
          s.startedAt = new Date().toISOString();
          s.deadline = Date.now() + TEST_MINUTES * 60 * 1000;
          save(s);
        }
        return send(res, 200, { session: s, now: Date.now() });
      }
      if (action === "answers") {
        if (s.status !== "in_progress") return send(res, 409, { error: "Test is not in progress" });
        // Allow a short grace window for the final autosave after time expires.
        if (Date.now() > s.deadline + 15000) return send(res, 409, { error: "Time is up" });
        for (const k of ["task1", "task2"]) if (typeof body[k] === "string") s.answers[k] = body[k].slice(0, 20000);
        save(s);
        return send(res, 200, { ok: true, savedAt: s.updatedAt });
      }
      if (action === "submit") {
        if (s.status === "in_progress") {
          for (const k of ["task1", "task2"]) if (typeof body[k] === "string" && Date.now() <= s.deadline + 15000) s.answers[k] = body[k].slice(0, 20000);
          Object.assign(s, { status: "grading", submittedAt: new Date().toISOString() });
          save(s);
          grade(s.id);
        }
        return send(res, 200, { session: s });
      }
      if (action === "retry-grade" && s.status === "grade_error") {
        Object.assign(s, { status: "grading", error: null });
        save(s);
        grade(s.id);
        return send(res, 200, { session: s });
      }
      return send(res, 409, { error: `Cannot ${action} while ${s.status}` });
    }

    send(res, 404, { error: "Not found" });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`IELTS Writing platform: http://${HOST}:${PORT}${MOCK ? "  (MOCK mode — Claude not called)" : ""}`);
});
