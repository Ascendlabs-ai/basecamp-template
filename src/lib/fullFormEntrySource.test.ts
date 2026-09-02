import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const entriesPanel = readFileSync(
  path.join(process.cwd(), "src/components/admin/EntriesPanel.tsx"),
  "utf8",
);
const entryDialog = readFileSync(
  path.join(process.cwd(), "src/components/admin/EntryDialog.tsx"),
  "utf8",
);

test("Add an app has one path and opens the complete dialog", () => {
  assert.doesNotMatch(entriesPanel, /quickName|quickUrl|quickCategory|All fields/);
  assert.match(
    entriesPanel,
    /onClick=\{\(\) => setDialog\(\{ mode: "create", draft: blankDraft\(/,
  );
});

test("the creation dialog reviews every meaningful app configuration area", () => {
  for (const label of [
    "App name",
    "Description",
    "Owner",
    "Category",
    "Entry type",
    "Catalog status",
    "Hosting",
    "Trigger",
    "App URL",
    "Repository URL",
    "Runbook URL",
    "Visible and available to the team",
    "Who can use this app",
    "Sign-in behavior",
  ]) {
    assert.match(entryDialog, new RegExp(label), `the full form no longer exposes ${label}`);
  }
});

test("the creation defaults fail closed until an administrator reviews the app", () => {
  assert.match(entriesPanel, /access_mode: "selected"/);
  assert.match(entriesPanel, /is_active: false/);
  assert.match(entriesPanel, /description: ""/);
  assert.match(entriesPanel, /owner: ""/);
});
