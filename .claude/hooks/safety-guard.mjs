#!/usr/bin/env node
// Base Camp — Safety Guard (PreToolUse)
//
// The single most important hook for a non-technical builder. It makes the
// safe path the default path by stopping the handful of agent actions that are
// catastrophic, irreversible, or leak secrets — BEFORE they run.
//
// Two verdicts:
//   deny — hard stop. Catastrophic/irreversible with ~no legitimate reason
//          in a normal build session (wipes the repo, leaks a key, drops a DB,
//          runs untrusted code off the internet, force-pushes to main).
//   ask  — speed bump. Legitimate but risky; the human decides (deploy to
//          production, force-push a feature branch, discard local work, a
//          line that looks like a hardcoded secret).
//
// Everything else is allowed silently. This hook NEVER blocks safe work.
//
// Wire in .claude/settings.json:
//   PreToolUse matcher "Bash|Write|Edit|NotebookEdit" -> node this file.

import { getConfig, logHookError } from "./shared.mjs";

// ── Verdict helpers (Claude Code PreToolUse hook protocol) ───────────────────

function emit(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}
const deny = (reason) => emit("deny", reason);
const ask = (reason) => emit("ask", reason);
const allow = () => process.exit(0); // silent

// ── Secret detection ─────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI API key", re: /\bsk-(proj-)?[A-Za-z0-9]{20,}/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "Stripe secret key", re: /\b[rs]k_live_[A-Za-z0-9]{20,}/ },
  { name: "Private key block", re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  {
    name: "hardcoded credential",
    re: /(?:api[_-]?key|secret|token|passwd|password|private[_-]?key|client[_-]?secret)\s*[:=]\s*['"][^'"\n]{12,}['"]/i,
  },
];

// Things that look like secrets but are placeholders / references — never flag.
const SECRET_ALLOWLIST =
  /(process\.env|import\.meta\.env|Deno\.env|os\.environ|getenv|\$\{|<[^>]+>|xxx+|your[-_ ]?|example|placeholder|dummy|redacted|changeme|todo|\.\.\.)/i;

function findSecret(text) {
  if (!text) return null;
  for (const { name, re } of SECRET_PATTERNS) {
    const m = text.match(re);
    if (m) {
      // For the generic "assignment" pattern, suppress obvious placeholders.
      if (name === "hardcoded credential" && SECRET_ALLOWLIST.test(m[0])) continue;
      return { name, sample: m[0].slice(0, 12) + "…" };
    }
  }
  return null;
}

// ── Bash command guards ──────────────────────────────────────────────────────

function checkBash(cmd, cfg) {
  const off = (id) => cfg.disable.includes(id);

  // curl|wget piped into a shell = run untrusted code off the internet.
  if (!off("remote-exec") && /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|python[0-9.]*|node)\b/.test(cmd)) {
    deny(
      "BLOCKED: piping a downloaded script straight into a shell runs code from the internet " +
        "with no review. If you trust this installer, download it to a file, open and read it, " +
        "then run it explicitly — or ask a human to install it.",
    );
  }

  // sudo rm — removing files as root.
  if (!off("sudo-rm") && /\bsudo\s+rm\b/.test(cmd)) {
    deny("BLOCKED: `sudo rm` deletes files as the system administrator and cannot be undone. Remove things without sudo, or ask a human.");
  }

  // Recursive force-delete: `rm` carrying both -r and -f (in any flag order/combo).
  if (!off("rm-rf")) {
    const isRm = /(^|[\s|&;])rm\s/.test(cmd);
    const hasR = /\s-[A-Za-z]*r/i.test(cmd);
    const hasF = /\s-[A-Za-z]*f/i.test(cmd);
    if (isRm && hasR && hasF) {
      // Catastrophic target: filesystem root, home, current/parent dir, or a wildcard.
      const catastrophic = /\brm\b[^\n]*\s(?:-\S+\s+)*(?:['"]?(?:\/|~|\$HOME|\$\{HOME\})['"]?(?:\s|\/|$)|['"]?\.{1,2}['"]?(?:\s|$)|\*)/.test(cmd);
      if (catastrophic) {
        deny(
          "BLOCKED: this `rm -rf` targets your home directory, the filesystem root, the current " +
            "directory, or a wildcard — it can erase everything and cannot be undone. If you meant " +
            "to delete one specific folder, name it explicitly (e.g. `rm -rf ./build`).",
        );
      }
      // Any other recursive force-delete → speed bump.
      ask("`rm -rf` permanently deletes a folder and everything in it. Confirm the path is right before allowing.");
    }
  }

  // Destructive SQL.
  if (!off("sql") && /\b(DROP\s+(DATABASE|TABLE|SCHEMA)|TRUNCATE\s+TABLE|DELETE\s+FROM\s+\w+\s*;)/i.test(cmd)) {
    deny(
      "BLOCKED: this SQL permanently destroys data (DROP / TRUNCATE / unfiltered DELETE) and cannot be undone. " +
        "If this is intentional, run it yourself against a database you have backed up.",
    );
  }

  // Force-push.
  if (!off("force-push") && /\bgit\s+push\b/.test(cmd) && /(--force\b|--force-with-lease\b|-\w*f)/.test(cmd)) {
    const branch = cfg.protected_branches.find((b) => new RegExp(`\\b${b}\\b`).test(cmd));
    if (branch) {
      deny(
        `BLOCKED: force-pushing to "${branch}" rewrites shared history and can erase other people's work. ` +
          "Never force-push a protected branch. Push to a feature branch and open a pull request instead.",
      );
    }
    ask("Force-push rewrites history on the remote branch. Confirm you know this branch isn't shared before allowing.");
  }

  // Discarding local work.
  if (!off("discard") && (/\bgit\s+reset\s+--hard\b/.test(cmd) || /\bgit\s+clean\s+-[a-z]*f/.test(cmd) || /\bgit\s+checkout\s+--\s+\./.test(cmd))) {
    ask("This throws away uncommitted changes and can't be undone. Confirm you don't need that work before allowing.");
  }

  // Staging/committing a real secrets file.
  if (!off("env-commit") && /\bgit\s+(add|commit)\b/.test(cmd) && /(^|\s|\/)\.env(\.[\w.-]+)?(\s|$)/.test(cmd) && !/\.env\.example/.test(cmd)) {
    deny(
      "BLOCKED: `.env` holds your secret keys and must never be committed to git — once pushed, treat those keys as leaked. " +
        "Add `.env` to `.gitignore` instead. Commit `.env.example` (with placeholder values) if you want to document what keys are needed.",
    );
  }

  // chmod 777 — world-writable.
  if (!off("chmod") && /\bchmod\s+(-R\s+)?0?777\b/.test(cmd)) {
    ask("`chmod 777` makes files writable by anyone on the machine — a security risk. Confirm you really need this.");
  }

  // Deploy to production → speed bump.
  if (!off("deploy")) {
    const hit = cfg.deploy_command_patterns.find((p) => cmd.includes(p));
    if (hit) {
      ask(
        `This deploys to a LIVE environment ("${hit}") — real users will see the result immediately. ` +
          "Make sure it's been tested first. Allow the deploy?",
      );
    }
  }

  allow();
}

// ── Write/Edit guards ────────────────────────────────────────────────────────

function checkWrite(toolInput, cfg) {
  if (cfg.disable.includes("secret-write")) allow();
  const filePath = toolInput.file_path || toolInput.notebook_path || "";
  // Don't nag on example/template files — they're supposed to show the shape.
  if (/\.(example|sample|template|dist)$/i.test(filePath) || /\.env\.example$/i.test(filePath)) allow();

  const text = toolInput.content ?? toolInput.new_string ?? "";
  const hit = findSecret(text);
  if (hit) {
    ask(
      `This looks like it contains a real ${hit.name} (starts "${hit.sample}"). ` +
        "Hardcoded keys leak the moment the file is committed. Put the value in a `.env` file and read it with " +
        "an environment variable instead. Write the file anyway?",
    );
  }
  allow();
}

// ── Main ─────────────────────────────────────────────────────────────────────

let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input || "{}");
    const toolName = data.tool_name || "";
    const toolInput = data.tool_input || {};
    const base = toolName.includes("__") ? toolName.split("__").pop() : toolName;
    const cfg = getConfig();

    if (base === "Bash") return checkBash(toolInput.command || "", cfg);
    if (base === "Write" || base === "Edit" || base === "NotebookEdit") return checkWrite(toolInput, cfg);

    allow();
  } catch (err) {
    logHookError("safety-guard", err);
    // On our own error, fail OPEN — a broken guard must never wedge the user.
    process.exit(0);
  }
});
