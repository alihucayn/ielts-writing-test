// Locates the Claude Code CLI so it can be spawned without a shell, on macOS, Linux and Windows.
//
// Windows is the tricky case. Depending on how Claude Code was installed, PATH holds:
//   - claude.exe                       native installer (%USERPROFILE%\.local\bin) — spawnable
//   - claude / claude.cmd / claude.ps1 npm shims in %APPDATA%\npm — NOT spawnable by Node
// The npm package @anthropic-ai/claude-code ships bin/claude.exe as a ~500-byte placeholder that its
// postinstall replaces with the real binary from @anthropic-ai/claude-code-win32-<arch>. If postinstall
// didn't run, the placeholder stays, so we look for the platform package's claude.exe directly.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
const size = (p) => {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
};
// The real binary is tens of MB; the npm placeholder is a few hundred bytes.
const isRealBinary = (p) => isFile(p) && size(p) > 100_000;

export function resolveClaude({ platform = process.platform, env = process.env, home = os.homedir(), arch = process.arch } = {}) {
  const win = platform === "win32";
  const notes = [];

  const asCommand = (file) => {
    const ext = path.extname(file).toLowerCase();
    if ([".js", ".mjs", ".cjs"].includes(ext)) return { cmd: process.execPath, pre: [file], label: file };
    if (win) {
      if (ext === ".exe" || ext === ".com") {
        if (isRealBinary(file)) return { cmd: file, pre: [], label: file };
        notes.push(`${file} is only the npm placeholder (its install step did not finish).`);
        return fromPackageDir(path.dirname(path.dirname(file)));
      }
      // Any other file on Windows is an npm/shell shim: follow it to the real program.
      return fromShim(file);
    }
    return { cmd: file, pre: [], label: file };
  };

  // Read a shim (.cmd, .ps1 or the extensionless sh script) and follow the path it launches.
  const fromShim = (shim) => {
    const dir = path.dirname(shim);
    let text = "";
    try {
      text = fs.readFileSync(shim, "utf8");
    } catch {}
    const rels = [...text.matchAll(/(?:%dp0%|\$basedir|\$PSScriptRoot|%~dp0)[\\/]+([^"'\s%$]+?\.(?:exe|js|cjs|mjs))/gi)].map((m) => m[1]);
    for (const rel of rels) {
      const target = path.join(dir, ...rel.split(/[\\/]+/));
      const c = isFile(target) ? asCommand(target) : null;
      if (c) return c;
    }
    return fromPackageDir(path.join(dir, "node_modules", "@anthropic-ai", "claude-code"));
  };

  // Find a runnable entry point inside an installed @anthropic-ai/claude-code package directory.
  const fromPackageDir = (pkgDir) => {
    if (!fs.existsSync(pkgDir)) return null;
    const plat = `@anthropic-ai/claude-code-${win ? "win32" : platform}-${arch}`.split("/");
    const candidates = [
      path.join(pkgDir, "bin", "claude.exe"),
      path.join(pkgDir, "node_modules", ...plat, "claude.exe"), // nested optional dependency
      path.join(pkgDir, "..", plat[1], "claude.exe"), // hoisted sibling
      path.join(pkgDir, "node_modules", ...plat, "claude"),
      path.join(pkgDir, "..", plat[1], "claude"),
    ];
    for (const c of candidates) if (isRealBinary(c)) return { cmd: c, pre: [], label: c };
    for (const js of ["cli.js", "cli.mjs"]) if (isFile(path.join(pkgDir, js))) return asCommand(path.join(pkgDir, js));
    notes.push(`Found the npm package at ${pkgDir}, but not its Windows program.`);
    return null;
  };

  const search = (name) => {
    const dirs = (env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
    // Default install locations, in case PATH in this terminal is stale.
    dirs.push(path.join(home, ".local", "bin"), path.join(home, ".claude", "local"));
    if (win && env.APPDATA) dirs.push(path.join(env.APPDATA, "npm"));
    if (!win) dirs.push("/opt/homebrew/bin", "/usr/local/bin");
    // On Windows prefer the real exe, then npm shims (which we follow); never run a shim directly.
    const exts = win ? [".exe", ".cmd", "", ".ps1"] : [""];
    for (const ext of exts) {
      for (const dir of dirs) {
        const p = path.join(dir, name + ext);
        if (!isFile(p)) continue;
        const c = asCommand(p);
        if (c) return c;
      }
    }
    return null;
  };

  const configured = env.CLAUDE_BIN?.trim().replace(/^"(.*)"$/, "$1");
  let found = null;
  if (configured) {
    if (isFile(configured)) found = asCommand(configured);
    else if (fs.existsSync(configured)) found = fromPackageDir(configured);
    else if (!/[\\/]/.test(configured)) found = search(configured);
    else notes.push(`CLAUDE_BIN is set to "${configured}", but nothing exists there.`);
  } else found = search("claude");
  if (found) return found;

  const why = notes.length ? `\n${[...new Set(notes)].join("\n")}\n` : "";
  return {
    error: win
      ? `Could not find a runnable Claude Code program.${why}\nFix: install the native version in PowerShell:\n    irm https://claude.ai/install.ps1 | iex\nthen close and reopen the terminal and run npm start again.\nOr, if you installed with npm, reinstall it so its install step runs:\n    npm install -g @anthropic-ai/claude-code`
      : `Could not find the Claude Code CLI.${why}\nInstall it with:  curl -fsSL https://claude.ai/install.sh | bash\nIf it is installed, run  which claude  and start with:  CLAUDE_BIN="<that path>" npm start`,
  };
}
