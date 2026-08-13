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

test("history edit controls identify the completed fast", () => {
  const app = readFileSync("src/app.js", "utf8");

  assert.match(
    app,
    /aria-label="Edit fast completed \$\{formatDate\(session\.endedAt\)\}"/,
  );
});

test("active fast history avoids repeated live announcements", () => {
  const app = readFileSync("src/app.js", "utf8");

  assert.match(
    app,
    /sessionList\.setAttribute\("aria-live", activeSession \? "off" : "polite"\)/,
  );
});

test("fast button ignores duplicate taps before changing session state", () => {
  const app = readFileSync("src/app.js", "utf8");

  assert.match(app, /const FAST_BUTTON_COOLDOWN_MS = 500;/);
  assert.match(
    app,
    /if \(actionAt - lastFastButtonActionAt < FAST_BUTTON_COOLDOWN_MS\) return;/,
  );
});

test("active fast history labels the goal completion time", () => {
  const app = readFileSync("src/app.js", "utf8");

  assert.match(app, /Started \$\{formatTime\(session\.startedAt\)\} · Goal time/);
});

test("session correction dialog describes the fast being edited", () => {
  const index = readFileSync("index.html", "utf8");

  assert.match(index, /id="session-dialog"[\s\S]*aria-describedby="session-summary"/);
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

test("tracker exposes the local-safe sync orchestration surface", () => {
  const index = readFileSync("index.html", "utf8");
  const app = readFileSync("src/app.js", "utf8");

  for (const id of [
    "orchestration-preview",
    "orchestration-preview-title",
    "orchestration-preview-message",
    "orchestration-preview-stats",
    "orchestration-preview-details",
    "orchestration-preview-action",
    "orchestration-preview-action-detail",
  ]) {
    assert.match(index, new RegExp(`id="${id}"`));
  }

  assert.match(app, /createSyncOrchestrationModel/);
  assert.match(app, /createSyncOrchestrationStatusModel/);
  assert.match(app, /renderOrchestrationPreview/);
  assert.match(app, /supabasePushRepositoryReadiness/);
});

test("tracker renders cloud read diagnostics in the sync preview", () => {
  const index = readFileSync("index.html", "utf8");
  const app = readFileSync("src/app.js", "utf8");

  for (const id of [
    "sync-diagnostics",
    "sync-diagnostics-safety",
    "sync-diagnostics-stages",
    "sync-diagnostics-next-step",
    "sync-preview-refresh",
    "sync-preview-refresh-detail",
  ]) {
    assert.match(index, new RegExp(`id="${id}"`));
  }

  assert.match(app, /createSyncDiagnosticsViewModel/);
  assert.match(app, /createCloudReadApplyDiagnostics/);
  assert.match(app, /createCloudPullRequestController/);
  assert.match(app, /createSyncRefreshControlModel/);
  assert.match(app, /renderSyncDiagnostics/);
  assert.match(app, /syncPullController\.refresh/);
});

test("tracker bootstraps Supabase only through the local-safe SDK controller", () => {
  const index = readFileSync("index.html", "utf8");
  const app = readFileSync("src/app.js", "utf8");

  assert.doesNotMatch(index, /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/);
  assert.match(app, /createSupabaseSdkBootstrap/);
  assert.match(app, /initializeSupabaseAuth/);
  assert.match(app, /bootstrapState\.status !== "ready"/);
});

test("tracker renders each Google OAuth readiness gate", () => {
  const index = readFileSync("index.html", "utf8");
  const app = readFileSync("src/app.js", "utf8");

  for (const id of [
    "oauth-readiness-grid",
    "oauth-sdk-status",
    "oauth-provider-status",
    "oauth-redirect-status",
    "oauth-callback-status",
    "oauth-signin-status",
  ]) {
    assert.match(index, new RegExp(`id="${id}"`));
  }

  assert.match(app, /renderOAuthReadiness/);
  assert.match(app, /!readiness\.canSignIn/);
});

test("tracker exposes the token-free OAuth controller and read validation report", () => {
  const index = readFileSync("index.html", "utf8");
  const app = readFileSync("src/app.js", "utf8");

  for (const id of [
    "oauth-validation",
    "oauth-validation-title",
    "oauth-validation-status",
    "oauth-validation-message",
    "oauth-validation-stats",
    "oauth-validation-stages",
    "oauth-validation-safety",
  ]) {
    assert.match(index, new RegExp(`id="${id}"`));
  }

  assert.match(app, /createGoogleOAuthLaunchController/);
  assert.match(app, /createAuthProfileCoordinator/);
  assert.match(app, /createOAuthReadValidationReport/);
  assert.match(app, /authProfileCoordinator\.scopeKey/);
  assert.match(app, /oauthLaunchController\.start/);
  assert.match(app, /renderOAuthValidationReport/);
});

test("tracker exposes local-safe session health and recovery controls", () => {
  const index = readFileSync("index.html", "utf8");
  const app = readFileSync("src/app.js", "utf8");

  for (const id of [
    "session-health",
    "session-health-status",
    "session-health-message",
    "session-health-last-check",
    "session-health-preview",
    "session-health-recovery",
    "session-health-freshness",
    "session-health-source",
    "session-health-check",
  ]) {
    assert.match(index, new RegExp(`id="${id}"`));
  }

  assert.match(app, /createAuthSessionHealthController/);
  assert.match(app, /createAuthSessionRecoveryCoordinator/);
  assert.match(app, /createAuthSessionExpiryController/);
  assert.match(app, /createAuthLifecycleCoordinator/);
  assert.match(app, /createAuthSubscriptionCoordinator/);
  assert.match(app, /authService\.currentAuthState\(\)/);
  assert.match(app, /authSessionHealthController\.check/);
  assert.match(app, /authSessionHealthController\.observeAuthState/);
  assert.match(app, /sessionHealth: authSessionHealthController\.current\(\)/);
  assert.match(app, /persistAuthProfileState/);
  assert.match(app, /addEventListener\("visibilitychange"/);
  assert.match(app, /addEventListener\("online"/);
  assert.match(app, /addEventListener\("offline"/);
  assert.match(app, /authSessionRecoveryCoordinator\.resume/);
  assert.match(app, /authSessionRecoveryCoordinator\.reconnect/);
  assert.match(app, /authSessionRecoveryCoordinator\.invalidate/);
  assert.match(app, /authLifecycleCoordinator\.observeAuthState/);
  assert.match(app, /authSubscriptionCoordinator\.attach/);
  assert.match(app, /authSubscriptionCoordinator\.detach/);
  assert.match(app, /addEventListener\("pagehide"/);
  assert.match(app, /addEventListener\("pageshow"/);
});

test("tracker renders the read-only authenticated profile provisioning preview", () => {
  const index = readFileSync("index.html", "utf8");
  const app = readFileSync("src/app.js", "utf8");

  for (const id of [
    "profile-provisioning",
    "profile-provisioning-title",
    "profile-provisioning-status",
    "profile-provisioning-message",
    "profile-provisioning-refresh",
    "profile-provisioning-refresh-detail",
    "profile-provisioning-stages",
    "profile-provisioning-safety",
    "profile-validation",
    "profile-validation-title",
    "profile-validation-status",
    "profile-validation-message",
    "profile-validation-stats",
    "profile-validation-stages",
    "profile-validation-safety",
    "profile-execution-confirm",
    "profile-execution-confirm-detail",
  ]) {
    assert.match(index, new RegExp(`id="${id}"`));
  }

  assert.match(app, /createProfileProvisioningPreviewController/);
  assert.match(app, /createSupabaseProfileReadRepository/);
  assert.match(app, /profileReadReadiness/);
  assert.match(app, /createProfileProvisioningPreviewModel/);
  assert.match(app, /createProfileProvisioningRefreshControlModel/);
  assert.match(app, /createProfileValidationReport/);
  assert.match(app, /createProfileExecutionReadiness/);
  assert.match(app, /createProfileExecutionOrchestrationModel/);
  assert.match(app, /createProfileExecutionResultStatusModel/);
  assert.match(app, /createProfileMutationPreflightModel/);
  assert.match(app, /createProfileWriteActivationPolicy/);
  assert.match(app, /supabaseProfileWriteRepositoryReadiness/);
  assert.match(app, /executeConfirmations: false/);
  assert.match(app, /executeWrites: false/);
  assert.match(app, /mockScenario: false/);
  assert.match(app, /activationEnabled: false/);
  assert.match(app, /operatorTestMode: false/);
  assert.match(app, /fastSessionsWritesEnabled: false/);
  assert.match(app, /target: "profiles"/);
  assert.doesNotMatch(app, /createSupabaseProfileWriteRepository/);
  assert.doesNotMatch(app, /createProfileExecutionController/);
  assert.doesNotMatch(app, /createProfileExecutionScenarioHarness/);
  assert.match(app, /profileProvisioningController\.invalidate/);
  assert.match(app, /renderProfileProvisioning/);
  assert.match(app, /renderProfileProvisioningRefresh/);
  assert.match(app, /renderProfileValidationReport/);
  assert.match(app, /renderProfileExecutionControl/);
  assert.match(app, /refreshProfileProvisioning/);
  assert.match(app, /profileProvisioningRefresh\.addEventListener/);
});

test("tracker homepage keeps cloud scope creep out of the daily fasting loop", () => {
  const index = readFileSync("index.html", "utf8");
  const styles = readFileSync("styles.css", "utf8");

  for (const id of [
    "profile-badge",
    "migration-preview",
    "sync-preview",
    "push-preview",
    "orchestration-preview",
  ]) {
    assert.match(index, new RegExp(`id="${id}"[^>]*hidden`));
  }

  assert.match(index, /class="dashboard"[^>]*hidden/);
  assert.match(index, /id="fast-button"/);
  assert.match(index, /id="timer"/);
  assert.match(index, /id="target-hours"/);
  assert.match(index, /id="session-list"[^>]*aria-live="polite"/);
  assert.match(index, /href="dashboard\.html"/);
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
});
