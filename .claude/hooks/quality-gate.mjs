#!/usr/bin/env node
// Base Camp — Auto-Format Quality Gate (PostToolUse on Edit/Write)
//
// After the agent writes a file, quietly run the project's formatter so code
// stays consistent without the builder ever having to think about it. Runs
// ONLY if the project actually has a formatter config (Biome/Prettier/Ruff).
// Silent, never blocks. If nothing is configured, it does nothing.

import { existsSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { spawnSync } from "node:child_process";
import { logHookError } from "./shared.mjs";

const SKIP = [".claude/", "node_modules/", ".git/", "dist/", "build/"];

const FORMATTER_MAP = {
  ".ts": ["biome", "prettier"], ".tsx": ["biome", "prettier"],
  ".js": ["biome", "prettier"], ".jsx": ["biome", "prettier"],
  ".mjs": ["biome", "prettier"], ".cjs": ["biome", "prettier"],
  ".json": ["biome", "prettier"], ".css": ["prettier"], ".scss": ["prettier"],
  ".md": ["prettier"], ".py": ["ruff"],
};

const FORMATTER_CONFIGS = {
  biome: ["biome.json", "biome.jsonc"],
  prettier: [
    ".prettierrc", ".prettierrc.json", ".prettierrc.js", ".prettierrc.cjs",
    ".prettierrc.yml", ".prettierrc.yaml", "prettier.config.js", "prettier.config.cjs",
  ],
  ruff: ["ruff.toml", "pyproject.toml"],
};

function findProjectRoot(filePath) {
  let dir = dirname(filePath);
  for (let i = 0; i < 12; i++) {
    if (existsSync(resolve(dir, "package.json")) || existsSync(resolve(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirname(filePath);
}

function hasConfig(formatter, root) {
  return (FORMATTER_CONFIGS[formatter] || []).some((c) => existsSync(resolve(root, c)));
}

function run(formatter, filePath, root) {
  const table = {
    biome: ["npx", ["biome", "format", "--write", filePath]],
    prettier: ["npx", ["prettier", "--write", filePath]],
    ruff: ["ruff", ["format", filePath]],
  };
  const [cmd, args] = table[formatter] || [];
  if (!cmd) return null;
  const res = spawnSync(cmd, args, { cwd: root, timeout: 8000, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  if (res.status !== 0 && res.stderr) logHookError("quality-gate:" + formatter, new Error(res.stderr.trim()));
  return res.status === 0 ? formatter : null;
}

let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input || "{}");
    const toolName = data.tool_name || "";
    const base = toolName.includes("__") ? toolName.split("__").pop() : toolName;
    if (!["Edit", "Write", "NotebookEdit"].includes(base)) process.exit(0);

    const filePath = (data.tool_input || {}).file_path || (data.tool_input || {}).notebook_path || "";
    if (!filePath || SKIP.some((p) => filePath.includes(p))) process.exit(0);

    const formatters = FORMATTER_MAP[extname(filePath).toLowerCase()];
    if (!formatters) process.exit(0);

    const root = findProjectRoot(filePath);
    for (const f of formatters) {
      if (hasConfig(f, root)) {
        if (run(f, filePath, root)) console.log(`Auto-formatted ${filePath.split("/").slice(-2).join("/")} (${f})`);
        break;
      }
    }
  } catch (err) {
    logHookError("quality-gate", err);
  }
  process.exit(0);
});
