// Locates the Claude Code CLI so it can be spawned without a shell, on macOS, Linux and Windows.
// On Windows, `claude` is either a native claude.exe or an npm-generated claude.cmd shim;
// Node can't spawn a .cmd without a shell, so we resolve the shim to the real exe or .js file.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const isWin = process.platform === "win32";
const exists = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

// npm shim dir → the real entry point inside node_modules/@anthropic-ai/claude-code.
function fromNpmShim(shimPath) {
  const pkgDir = path.join(path.dirname(shimPath), "node_modules", "@anthropic-ai", "claude-code");
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
    const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.claude;
    if (rel) {
      const target = path.join(pkgDir, rel);
      if (exists(target)) return asCommand(target);
      // Some versions point bin at a script that launches a platform exe.
      if (exists(target + ".exe")) return asCommand(target + ".exe");
    }
  } catch {}
  for (const c of ["bin/claude.exe", "cli.js"]) if (exists(path.join(pkgDir, c))) return asCommand(path.join(pkgDir, c));
  return null;
}

function asCommand(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return { cmd: process.execPath, pre: [file], label: file };
  if (isWin && (ext === ".cmd" || ext === ".bat")) return fromNpmShim(file);
  return { cmd: file, pre: [], label: file };
}

export function resolveClaude() {
  const configured = process.env.CLAUDE_BIN?.trim().replace(/^"(.*)"$/, "$1");
  if (configured) {
    if (exists(configured)) return asCommand(configured) || { cmd: configured, pre: [], label: configured };
    if (!configured.includes("/") && !configured.includes("\\")) return search(configured);
    return { error: `CLAUDE_BIN is set to "${configured}", but no file exists there.` };
  }
  return search("claude");
}

function search(name) {
  const dirs = (process.env.PATH || process.env.Path || "").split(path.delimiter).filter(Boolean);
  const home = os.homedir();
  // Default install locations, in case PATH in this terminal hasn't been refreshed.
  dirs.push(path.join(home, ".local", "bin"), path.join(home, ".claude", "local"));
  if (isWin && process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, "npm"));
  if (!isWin) dirs.push("/opt/homebrew/bin", "/usr/local/bin");

  const exts = isWin ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (!exists(p)) continue;
      const c = asCommand(p);
      if (c) return c;
    }
  }
  return {
    error: isWin
      ? `Could not find the Claude Code CLI. Install it in PowerShell with:  irm https://claude.ai/install.ps1 | iex   then open a NEW terminal. If it is installed, run  where.exe claude  and start the app with:  $env:CLAUDE_BIN="<that path>"; npm start`
      : `Could not find the Claude Code CLI. Install it with:  curl -fsSL https://claude.ai/install.sh | bash   If it is installed, run  which claude  and start the app with:  CLAUDE_BIN="<that path>" npm start`,
  };
}
