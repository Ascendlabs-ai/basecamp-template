#!/usr/bin/env node
// Base Camp — Workflow Guard (PreToolUse on Bash|Skill)
//
// The naysayer commit gate: code can't be committed until it has passed review.
// This is "quality handled by the setup itself" — the builder can't accidentally
// ship un-reviewed code, because the commit is blocked until /naysayer passes.
//
// Separate from safety-guard.mjs on purpose: safety-guard is always-on physics
// (never delete the repo); this is the quality gate that composes with the build
// workflow (GSD). Both can fire on Bash; the most restrictive verdict wins.
//
// Turn off per client with .claude/basecamp.json -> { "disable": ["naysayer"] }.

import { existsSync, readFileSync } from "node:fs";
import {
  NAYSAYER_RESULT_FILE, MAX_NAYSAYER_ITERATIONS,
  getState, getConfig, isGsdActive, logHookError,
} from "./shared.mjs";

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  }));
  process.exit(0);
}
const allow = () => process.exit(0);

function readResult() {
  try {
    if (existsSync(NAYSAYER_RESULT_FILE)) return JSON.parse(readFileSync(NAYSAYER_RESULT_FILE, "utf-8"));
  } catch (err) {
    logHookError("workflow-guard/readResult", err);
  }
  return null;
}

// Returns a denial message if review is required, or null if clear.
// `action` is the boundary being gated ("commit" normally, "publish" under GSD).
function checkGate(state, action) {
  const edits = state.file_edits_since_naysayer || 0;
  const iteration = state.naysayer_iteration || 0;

  // Nothing has been edited and no review is mid-flight → nothing to review.
  if (edits === 0 && iteration === 0) return null;
  // A completed pass (threshold met, or escape hatch) that hasn't been invalidated.
  if (state.naysayer_completed) return null;

  // Fallback: trust the result file directly, but only if the skill was actually run.
  if (state.naysayer_skill_invoked || (state.skills_used || []).includes("naysayer")) {
    const r = readResult();
    if (r && (r.threshold_met === true || r.exit_reason === "max_iterations")) return null;
  }

  const Cap = action === "publish" ? "Publishing" : "Commit";
  const goesOut = action === "publish" ? "goes live" : "gets committed";

  // Mid-loop: review ran but hasn't passed yet.
  if (iteration > 0) {
    const r = readResult();
    const remaining = r?.remaining_findings?.length ?? "some";
    const history = (state.naysayer_score_history || []).join(" → ") || "?";
    return [
      `${Cap} blocked — code review in progress (round ${iteration}/${MAX_NAYSAYER_ITERATIONS}, last score ${state.naysayer_last_score ?? "?"}/10).`,
      `Scores so far: ${history}. Findings still open: ${remaining}.`,
      "",
      "Ask the agent to fix the remaining findings, then run /naysayer again.",
      iteration >= MAX_NAYSAYER_ITERATIONS
        ? "This was the last round — running /naysayer once more will let it through."
        : `${MAX_NAYSAYER_ITERATIONS - iteration} round(s) left before the gate opens automatically.`,
    ].join("\n");
  }

  // First time: edits exist but no review has run.
  return [
    `${Cap} blocked — ${edits} file(s) changed since the last review.`,
    "",
    `Base Camp reviews your code before it ${goesOut}, so you don't ship something broken.`,
    "Run the /naysayer skill now. It reads your changes, finds problems, and only lets it",
    "through once the code scores 8/10 or better with no critical issues.",
    "",
    "Just say: run /naysayer",
  ].join("\n");
}

let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input || "{}");
    const cfg = getConfig();
    if (cfg.disable?.includes("naysayer")) allow();

    // Subagents/skills operate inside an already-approved step — don't gate them.
    if (data.agent_id) allow();

    const toolName = data.tool_name || "";
    const toolInput = data.tool_input || {};
    const base = toolName.includes("__") ? toolName.split("__").pop() : toolName;

    // Where the gate sits depends on who's driving:
    //  - GSD active → it auto-commits per wave locally; gate the PUBLISH boundary
    //    (git push / deploy / ship) so nothing goes live un-reviewed.
    //  - otherwise → gate the commit boundary.
    const gsd = isGsdActive();
    let triggersGate = false;
    let action = "commit";
    if (base === "Bash") {
      const cmd = toolInput.command || "";
      if (gsd) {
        action = "publish";
        triggersGate = /\bgit\s+push\b/.test(cmd) || (cfg.deploy_command_patterns || []).some((d) => cmd.includes(d));
      } else {
        triggersGate = /\bgit\s+commit\b/.test(cmd);
      }
    } else if (base === "Skill") {
      const skill = (toolInput.skill || "").toLowerCase().split(":").pop();
      if (gsd) { action = "publish"; triggersGate = skill === "gsd-ship"; }
      else { triggersGate = skill === "commit" || skill === "commit-push-pr"; }
    }
    if (!triggersGate) allow();

    const block = checkGate(getState(), action);
    if (block) deny(block);
    allow();
  } catch (err) {
    logHookError("workflow-guard", err);
    process.exit(0); // fail open — a broken gate must never wedge the user
  }
});
