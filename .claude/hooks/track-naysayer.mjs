#!/usr/bin/env node
// Base Camp — Naysayer state tracker (PostToolUse on Write|Edit|NotebookEdit|Skill)
//
// Half of the review gate. It watches what the agent does and maintains the
// small state machine the gate reads. Three transitions:
//
//   ARM        Skill("naysayer") invoked  -> naysayer_skill_invoked = true,
//              edit counter reset. (The skill runs AFTER this fires, so we only
//              arm here; completion lands later via a Write.)
//   FIRE       .naysayer-result.json written WHILE armed -> read it, and if the
//              review passed (or hit max rounds), naysayer_completed = true.
//   INVALIDATE any real code edit after a pass -> naysayer_completed = false
//              (the reviewed code no longer matches what's on disk).
//
// Never blocks — PostToolUse can't. It only records state for workflow-guard.mjs.

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import {
  NAYSAYER_RESULT_FILE, MAX_NAYSAYER_ITERATIONS,
  isInfraFile, isDocFile, getState, setState, logHookError,
} from "./shared.mjs";

let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input || "{}");
    const toolName = data.tool_name || "";
    const toolInput = data.tool_input || {};
    const base = toolName.includes("__") ? toolName.split("__").pop() : toolName;
    const state = getState();
    let changed = false;

    // ── ARM: naysayer skill invoked ─────────────────────────────────────────
    if (base === "Skill") {
      const skill = (toolInput.skill || "").toLowerCase().split(":").pop();
      state.skills_used = [...new Set([...(state.skills_used || []), skill])];
      if (skill === "naysayer") {
        state.naysayer_skill_invoked = true;
        state.file_edits_since_naysayer = 0;
      }
      changed = true;
    }

    // ── Write/Edit: FIRE (result file) or count / INVALIDATE (code) ──────────
    if (base === "Write" || base === "Edit" || base === "NotebookEdit") {
      const filePath = toolInput.file_path || toolInput.notebook_path || "";

      if (filePath.endsWith(".naysayer-result.json")) {
        // FIRE — only trust a result the agent actually armed via the skill.
        if (state.naysayer_skill_invoked && existsSync(NAYSAYER_RESULT_FILE)) {
          try {
            const r = JSON.parse(readFileSync(NAYSAYER_RESULT_FILE, "utf-8"));
            state.naysayer_iteration = r.iteration || 0;
            state.naysayer_last_score = r.score || 0;
            state.naysayer_score_history = (r.score_history || []).slice(-MAX_NAYSAYER_ITERATIONS);
            state.file_edits_since_naysayer = 0;
            if (r.threshold_met === true) {
              state.naysayer_completed = true;
              state.naysayer_exit_reason = "threshold_met";
            } else if (r.exit_reason === "max_iterations") {
              state.naysayer_completed = true; // escape hatch
              state.naysayer_exit_reason = "max_iterations";
            }
            state.naysayer_skill_invoked = false; // disarm
            changed = true;
          } catch (err) {
            logHookError("track-naysayer/parse-result", err);
          }
        }
      } else if (filePath && !isInfraFile(filePath) && !isDocFile(filePath)) {
        // Real code edit.
        state.file_edits_since_naysayer = (state.file_edits_since_naysayer || 0) + 1;
        changed = true;
        // INVALIDATE — a prior pass no longer describes the code on disk.
        if (state.naysayer_completed) {
          state.naysayer_completed = false;
          state.naysayer_iteration = 0;
          state.naysayer_score_history = [];
          state.naysayer_skill_invoked = false;
          try { if (existsSync(NAYSAYER_RESULT_FILE)) unlinkSync(NAYSAYER_RESULT_FILE); } catch { /* noop */ }
        }
      }
    }

    if (changed) setState(state);
  } catch (err) {
    logHookError("track-naysayer", err);
  }
  process.exit(0);
});
