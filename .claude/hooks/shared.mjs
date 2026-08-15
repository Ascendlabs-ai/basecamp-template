/**
 * Base Camp — shared hook utilities.
 * Single source of truth imported by safety-guard.mjs, quality-gate.mjs, etc.
 *
 * Kept deliberately small and infra-free so the whole hooks/ folder is a
 * drop-in: copy it into any project's .claude/ and it works with zero wiring
 * beyond settings.json.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, appendFileSync, renameSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Paths ────────────────────────────────────────────────────────────────────
// PROJECT_ROOT is the directory that CONTAINS .claude/ (i.e. the repo root).
// hooks/ lives at .claude/hooks/, so go up two levels.
export const PROJECT_ROOT = resolve(__dirname, "..", "..");
export const STATE_FILE = resolve(PROJECT_ROOT, ".claude", ".session-state.json");
export const HOOK_ERROR_LOG = resolve(PROJECT_ROOT, ".claude", ".hook-errors.log");
export const CONFIG_FILE = resolve(PROJECT_ROOT, ".claude", "basecamp.json");
// Pinned next to STATE_FILE, resolved off THIS file's location (never process.cwd()).
// This is the anti-trap: the review skill, the tracker, and the gate all compute the
// exact same absolute path, so they can never disagree about where the result lives.
export const NAYSAYER_RESULT_FILE = resolve(PROJECT_ROOT, ".claude", ".naysayer-result.json");

// ── Naysayer gate constants ──────────────────────────────────────────────────

/** After this many failing review rounds, the gate opens anyway (escape hatch). */
export const MAX_NAYSAYER_ITERATIONS = 3;

/** Files that don't count as "code" for the review gate (config/docs/infra). */
export const INFRA_PATTERNS = [
  ".claude/", ".claude\\", "CLAUDE.md", ".gitignore",
  "settings.json", "basecamp.json", "package-lock.json", "pnpm-lock.yaml",
];

/** Prose files — exempt from the CODE review gate (but the file still gets written). */
export const DOC_PATTERNS = ["docs/", "README", ".planning/", "CONTEXT.md", "SUMMARY.md"];

/** True if the path is infra/config — not counted toward "unreviewed code edits". */
export function isInfraFile(filePath) {
  return INFRA_PATTERNS.some((p) => filePath.includes(p));
}

// ── GSD detection ────────────────────────────────────────────────────────────
// GSD writes a .planning/config.json when a project is initialized. Its presence
// means GSD is driving the build (and auto-committing per wave), which changes
// where the naysayer gate belongs — see workflow-guard.mjs.
export const PLANNING_CONFIG = resolve(PROJECT_ROOT, ".planning", "config.json");
export function isGsdActive() {
  try { return existsSync(PLANNING_CONFIG); } catch { return false; }
}

/** True if the path is documentation/prose (also exempt from the code gate). */
export function isDocFile(filePath) {
  if (DOC_PATTERNS.some((p) => filePath.includes(p))) return true;
  // Standalone markdown, but NOT executable prompt/command files.
  if (/\.md$/i.test(filePath) && !filePath.includes("commands/") && !filePath.includes("prompts/")) return true;
  return false;
}

// ── Config ───────────────────────────────────────────────────────────────────

/**
 * Optional per-client tuning, read from .claude/basecamp.json.
 * Everything has a safe default so the file is never required.
 */
export function getConfig() {
  const defaults = {
    // Branches where a force-push is treated as catastrophic (hard block).
    protected_branches: ["main", "master", "production", "prod", "release"],
    // Commands that push code to a live environment (speed-bump before running).
    deploy_command_patterns: [
      "wrangler deploy",
      "wrangler pages deploy",
      "vercel --prod",
      "vercel deploy --prod",
      "vercel deploy --prebuilt --prod",
      "netlify deploy --prod",
      "supabase db push",
      "supabase functions deploy",
      "fly deploy",
      "flyctl deploy",
      "npx sst deploy",
      "firebase deploy",
      "eas submit",
    ],
    // Turn any individual guardrail off if a client genuinely needs to.
    disable: [],
  };
  try {
    if (existsSync(CONFIG_FILE)) {
      const user = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
      return { ...defaults, ...user };
    }
  } catch (err) {
    logHookError("getConfig", err);
  }
  return defaults;
}

// ── State ────────────────────────────────────────────────────────────────────

/** Read session state, returning {} on any error. */
export function getState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

/** Write session state atomically, logging (not throwing) on error. */
export function setState(state) {
  try {
    const tmp = STATE_FILE + ".tmp." + process.pid;
    writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
    renameSync(tmp, STATE_FILE);
  } catch (err) {
    logHookError("setState", err);
  }
}

// ── Logging ──────────────────────────────────────────────────────────────────

/** Append a hook error to .claude/.hook-errors.log. Never throws. */
export function logHookError(hook, err) {
  try {
    const ts = new Date().toISOString();
    const msg = err instanceof Error ? err.message : String(err);
    appendFileSync(HOOK_ERROR_LOG, `[${ts}] ${hook}: ${msg}\n`, "utf-8");
  } catch {
    // Last resort — can't even write the log. Nothing to do.
  }
}
