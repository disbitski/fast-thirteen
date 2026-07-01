import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeData } from "../src/storage.js";

test("static pages use project-relative assets for GitHub Pages", () => {
  const index = readFileSync("index.html", "utf8");
  const dashboard = readFileSync("dashboard.html", "utf8");

  for (const html of [index, dashboard]) {
    assert.doesNotMatch(html, /href="\/(?:dashboard\.html|styles\.css)?"/);
    assert.doesNotMatch(html, /src="\/(?:config\.js|src\/)/);
  }

  assert.match(index, /href="dashboard\.html"/);
  assert.match(index, /src="src\/app\.js"/);
  assert.match(dashboard, /href="index\.html"/);
  assert.match(dashboard, /src="src\/dashboard\.js"/);
});

test("sample data is versioned and dashboard-ready", () => {
  const sample = normalizeData(JSON.parse(readFileSync("sample-data.json", "utf8")));
  const completedSessions = sample.sessions.filter((session) => !session.deletedAt && session.endedAt);

  assert.equal(sample.version, 3);
  assert.equal(sample.settings.targetHours, 13);
  assert.ok(completedSessions.length >= 7);
});

test("tracker exposes the local-safe push preview surface", () => {
  const index = readFileSync("index.html", "utf8");
  const app = readFileSync("src/app.js", "utf8");

  for (const id of [
    "push-preview",
    "push-preview-title",
    "push-preview-message",
    "push-preview-stats",
    "push-preview-details",
    "push-preview-action",
    "push-preview-action-detail",
  ]) {
    assert.match(index, new RegExp(`id="${id}"`));
  }

  assert.match(app, /createCloudPushPlan/);
  assert.match(app, /createCloudPushPreviewModel/);
  assert.match(app, /syncPushReadiness/);
});
