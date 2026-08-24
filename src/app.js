import {
  correctSession,
  deleteSession,
  durationMs,
  endFast,
  formatDuration,
  formatHoursAndMinutes,
  isComplete,
  normalizeTargetHours,
  progress,
  startFast,
  summarize,
} from "./fasting.js";
import {
  loadData,
  mergeData,
  normalizeData,
  parseBackup,
  saveData,
  serializeBackup,
} from "./storage.js";
import { applyTheme, loadTheme, saveTheme } from "./theme.js";
import {
  cloudDataUrl,
  cloudRequestHeaders,
  isGitHubPagesLocation,
  loadCloudSyncKey,
  loadDataSource,
} from "./dataSource.js";
import {
  cleanAuthCallbackUrl,
  createAuthService,
  mapAuthStateToProfile,
  readAuthCallbackState,
  resolveAuthCallbackState,
} from "./auth.js";
import { recentSessionsForDays } from "./analytics.js";
import { authReadiness } from "./authReadiness.js";
import { createAuthProfileCoordinator } from "./authProfileCoordinator.js";
import { createAuthLifecycleCoordinator } from "./authLifecycleCoordinator.js";
import { createAuthSubscriptionCoordinator } from "./authSubscriptionCoordinator.js";
import { createProfileProvisioningPreviewController } from "./profileProvisioning.js";
import {
  createProfileProvisioningPreviewModel,
  createProfileProvisioningRefreshControlModel,
} from "./profileProvisioningPreview.js";
import { createProfileValidationReport } from "./profileValidationReport.js";
import { createProfileExecutionReadiness } from "./profileExecutor.js";
import { createProfileExecutionOrchestrationModel } from "./profileExecutionOrchestration.js";
import { createProfileExecutionResultStatusModel } from "./profileExecutionResult.js";
import { createProfileMutationPreflightModel } from "./profileMutationPreflight.js";
import { createProfileWriteActivationPolicy } from "./profileWriteActivationPolicy.js";
import {
  AUTH_SESSION_CHECK_SOURCE,
  createAuthSessionHealthController,
} from "./authSessionHealth.js";
import { createAuthSessionExpiryController } from "./authSessionFreshness.js";
import { createAuthSessionRecoveryCoordinator } from "./authSessionRecovery.js";
import { createGoogleOAuthLaunchController } from "./googleOAuthController.js";
import { createOAuthReadValidationReport } from "./oauthValidationReport.js";
import { createGuestMigrationPlan } from "./migrationPlan.js";
import { createMigrationPreviewModel } from "./migrationPreview.js";
import { loadSupabaseConfig } from "./supabaseConfig.js";
import { createSupabaseSdkBootstrap } from "./supabaseSdkBootstrap.js";
import {
  createSupabaseProfileReadRepository,
  profileReadReadiness,
} from "./supabaseProfileRepository.js";
import { supabaseProfileWriteRepositoryReadiness } from "./supabaseProfileWriteRepository.js";
import {
  supabaseMigrationRepositoryReadiness,
  supabasePushRepositoryReadiness,
} from "./supabaseMigrationRepository.js";
import { syncApplyReadiness } from "./syncApply.js";
import {
  createFailedSyncReadPlan,
  createSupabaseSyncReadRepository,
  syncReadReadiness,
} from "./syncReadPlan.js";
import {
  createCloudPullPreview,
  createCloudReadApplyDiagnostics,
} from "./syncPull.js";
import { createCloudPullRequestController } from "./syncPullController.js";
import {
  createCloudPushPlan,
  createCloudPushPreviewModel,
  syncPushReadiness,
} from "./syncPushPlan.js";
import { createPushFinalizationReadiness } from "./syncPushFinalizer.js";
import {
  createSyncOrchestrationModel,
  createSyncOrchestrationStatusModel,
} from "./syncOrchestration.js";
import {
  createSyncDiagnosticsViewModel,
  createSyncLoadingPreviewModel,
  createSyncPreviewModel,
  createSyncRefreshControlModel,
} from "./syncPreview.js";

let appData = loadData(localStorage);
const sessions = appData.sessions;
let activeSession = sessions.find((session) => !session.deletedAt && !session.endedAt) ?? null;
let editingSessionId = null;
let deleteConfirmationPending = false;
let lastFastButtonActionAt = Number.NEGATIVE_INFINITY;
let selectedTheme = applyTheme(document.documentElement, loadTheme(localStorage));
const supabaseConfig = loadSupabaseConfig(globalThis);
const supabaseSdkBootstrap = createSupabaseSdkBootstrap();
let supabaseClient = supabaseSdkBootstrap.prepare(supabaseConfig);
let authService = createAuthService({
  config: supabaseConfig,
  clientStatus: supabaseClient.status,
  location: globalThis.location,
  supabaseClient: supabaseClient.client,
});
const callbackAuthState = readAuthCallbackState(
  new URLSearchParams(globalThis.location?.search ?? ""),
);
let authState = authService.initialState(callbackAuthState);
if (callbackAuthState) cleanAuthCallbackUrl(globalThis.location, globalThis.history);

const SAMPLE_DATA_URL = "sample-data.json";
const FAST_BUTTON_COOLDOWN_MS = 500;
let dataSource = loadDataSource(localStorage, globalThis.location);
let cloudSyncKey = loadCloudSyncKey(localStorage);

const elements = {
  button: document.querySelector("#fast-button"),
  completedFasts: document.querySelector("#completed-fasts"),
  currentStreak: document.querySelector("#current-streak"),
  cancelSessionEdit: document.querySelector("#cancel-session-edit"),
  closeSessionDialog: document.querySelector("#close-session-dialog"),
  deleteSession: document.querySelector("#delete-session"),
  emptyState: document.querySelector("#empty-state"),
  exportButton: document.querySelector("#export-button"),
  googleSignIn: document.querySelector("#google-sign-in"),
  heroCopy: document.querySelector("#hero-copy"),
  heroTitle: document.querySelector("#hero-title"),
  importButton: document.querySelector("#import-button"),
  importFile: document.querySelector("#import-file"),
  migrationPreview: document.querySelector("#migration-preview"),
  migrationConfirm: document.querySelector("#migration-confirm"),
  migrationConfirmDetail: document.querySelector("#migration-confirm-detail"),
  migrationPreviewDetails: document.querySelector("#migration-preview-details"),
  migrationPreviewMessage: document.querySelector("#migration-preview-message"),
  migrationPreviewStats: document.querySelector("#migration-preview-stats"),
  migrationPreviewTitle: document.querySelector("#migration-preview-title"),
  profileBadge: document.querySelector("#profile-badge"),
  profileMenu: document.querySelector("#profile-menu"),
  profileMenuDetail: document.querySelector("#profile-menu-detail"),
  profileMenuTitle: document.querySelector("#profile-menu-title"),
  profileMode: document.querySelector("#profile-mode"),
  profileProvisioning: document.querySelector("#profile-provisioning"),
  profileProvisioningMessage: document.querySelector("#profile-provisioning-message"),
  profileProvisioningRefresh: document.querySelector("#profile-provisioning-refresh"),
  profileProvisioningRefreshDetail: document.querySelector("#profile-provisioning-refresh-detail"),
  profileProvisioningSafety: document.querySelector("#profile-provisioning-safety"),
  profileProvisioningStages: document.querySelector("#profile-provisioning-stages"),
  profileProvisioningStatus: document.querySelector("#profile-provisioning-status"),
  profileProvisioningTitle: document.querySelector("#profile-provisioning-title"),
  profileValidation: document.querySelector("#profile-validation"),
  profileValidationMessage: document.querySelector("#profile-validation-message"),
  profileValidationSafety: document.querySelector("#profile-validation-safety"),
  profileValidationStages: document.querySelector("#profile-validation-stages"),
  profileValidationStats: document.querySelector("#profile-validation-stats"),
  profileValidationStatus: document.querySelector("#profile-validation-status"),
  profileValidationTitle: document.querySelector("#profile-validation-title"),
  profileExecutionConfirm: document.querySelector("#profile-execution-confirm"),
  profileExecutionConfirmDetail: document.querySelector("#profile-execution-confirm-detail"),
  progressRing: document.querySelector("#progress-ring"),
  orchestrationPreview: document.querySelector("#orchestration-preview"),
  orchestrationPreviewAction: document.querySelector("#orchestration-preview-action"),
  orchestrationPreviewActionDetail: document.querySelector("#orchestration-preview-action-detail"),
  orchestrationPreviewDetails: document.querySelector("#orchestration-preview-details"),
  orchestrationPreviewMessage: document.querySelector("#orchestration-preview-message"),
  orchestrationPreviewStats: document.querySelector("#orchestration-preview-stats"),
  orchestrationPreviewTitle: document.querySelector("#orchestration-preview-title"),
  pushPreview: document.querySelector("#push-preview"),
  pushPreviewAction: document.querySelector("#push-preview-action"),
  pushPreviewActionDetail: document.querySelector("#push-preview-action-detail"),
  pushPreviewDetails: document.querySelector("#push-preview-details"),
  pushPreviewMessage: document.querySelector("#push-preview-message"),
  pushPreviewStats: document.querySelector("#push-preview-stats"),
  pushPreviewTitle: document.querySelector("#push-preview-title"),
  saveStatus: document.querySelector("#save-status"),
  sessionHealth: document.querySelector("#session-health"),
  sessionHealthCheck: document.querySelector("#session-health-check"),
  sessionHealthFreshness: document.querySelector("#session-health-freshness"),
  sessionHealthLastCheck: document.querySelector("#session-health-last-check"),
  sessionHealthMessage: document.querySelector("#session-health-message"),
  sessionHealthPreview: document.querySelector("#session-health-preview"),
  sessionHealthRecovery: document.querySelector("#session-health-recovery"),
  sessionHealthSource: document.querySelector("#session-health-source"),
  sessionHealthStatus: document.querySelector("#session-health-status"),
  sessionDialog: document.querySelector("#session-dialog"),
  sessionEndedAt: document.querySelector("#session-ended-at"),
  sessionError: document.querySelector("#session-error"),
  sessionForm: document.querySelector("#session-form"),
  sessionList: document.querySelector("#session-list"),
  sessionStartedAt: document.querySelector("#session-started-at"),
  sessionSummary: document.querySelector("#session-summary"),
  syncDescription: document.querySelector("#sync-description"),
  syncDiagnostics: document.querySelector("#sync-diagnostics"),
  syncDiagnosticsNextStep: document.querySelector("#sync-diagnostics-next-step"),
  syncDiagnosticsSafety: document.querySelector("#sync-diagnostics-safety"),
  syncDiagnosticsStages: document.querySelector("#sync-diagnostics-stages"),
  syncPreview: document.querySelector("#sync-preview"),
  syncPreviewAction: document.querySelector("#sync-preview-action"),
  syncPreviewActionDetail: document.querySelector("#sync-preview-action-detail"),
  syncPreviewDetails: document.querySelector("#sync-preview-details"),
  syncPreviewLastSync: document.querySelector("#sync-preview-last-sync"),
  syncPreviewMessage: document.querySelector("#sync-preview-message"),
  syncPreviewRefresh: document.querySelector("#sync-preview-refresh"),
  syncPreviewRefreshDetail: document.querySelector("#sync-preview-refresh-detail"),
  syncPreviewStats: document.querySelector("#sync-preview-stats"),
  syncPreviewTitle: document.querySelector("#sync-preview-title"),
  syncStatus: document.querySelector("#sync-status"),
  authHelp: document.querySelector("#auth-help"),
  authReadinessDetail: document.querySelector("#auth-readiness-detail"),
  authReadinessStatus: document.querySelector("#auth-readiness-status"),
  oauthCallbackStatus: document.querySelector("#oauth-callback-status"),
  oauthProviderStatus: document.querySelector("#oauth-provider-status"),
  oauthRedirectStatus: document.querySelector("#oauth-redirect-status"),
  oauthSdkStatus: document.querySelector("#oauth-sdk-status"),
  oauthSignInStatus: document.querySelector("#oauth-signin-status"),
  oauthValidation: document.querySelector("#oauth-validation"),
  oauthValidationMessage: document.querySelector("#oauth-validation-message"),
  oauthValidationSafety: document.querySelector("#oauth-validation-safety"),
  oauthValidationStages: document.querySelector("#oauth-validation-stages"),
  oauthValidationStats: document.querySelector("#oauth-validation-stats"),
  oauthValidationStatus: document.querySelector("#oauth-validation-status"),
  oauthValidationTitle: document.querySelector("#oauth-validation-title"),
  signOut: document.querySelector("#sign-out"),
  statusLabel: document.querySelector("#status-label"),
  targetCopy: document.querySelector("#target-copy"),
  timer: document.querySelector("#timer"),
  timerLabel: document.querySelector("#timer-label"),
  themeOptions: [...document.querySelectorAll("[data-theme-option]")],
  targetHours: document.querySelector("#target-hours"),
  totalHours: document.querySelector("#total-hours"),
};

const syncPullController = createCloudPullRequestController({
  executePull: createCloudPullPreview,
  onStateChange() {
    renderProfileSync();
  },
});

const profileProvisioningController = createProfileProvisioningPreviewController({
  readProfile({ userId }) {
    const readiness = currentProfileReadiness();
    const repository = createSupabaseProfileReadRepository({
      client: supabaseClient.client,
      readiness,
    });
    return repository.readProfile({ userId });
  },
  onStateChange() {
    renderProfileSync();
  },
});

const authSessionRecoveryCoordinator = createAuthSessionRecoveryCoordinator({
  checkSession({ source }) {
    return runLocalSessionCheck({ source });
  },
});

const authSessionExpiryController = createAuthSessionExpiryController({
  checkSession({ source }) {
    return runLocalSessionCheck({ source });
  },
  onStateChange() {
    renderProfileSync();
  },
});

const authProfileCoordinator = createAuthProfileCoordinator({
  initialAuthState: authState,
  onInvalidate(transition) {
    syncPullController.invalidate({
      message: transition.message,
      reason: transition.reason,
    });
    authSessionRecoveryCoordinator.invalidate({ reason: transition.reason });
    authSessionExpiryController.invalidate({ reason: transition.reason });
    profileProvisioningController.invalidate({
      message: transition.message,
      reason: transition.reason,
    });
  },
});

const authSessionHealthController = createAuthSessionHealthController({
  checkSession() {
    return authService.currentAuthState();
  },
  initialAuthState: authState,
  initialScopeKey: authProfileCoordinator.current().identityKey,
  onStateChange() {
    scheduleAuthExpiryCheck();
    renderProfileSync();
  },
});

const oauthLaunchController = createGoogleOAuthLaunchController({
  initialAuthState: authState,
  launch({ redirectTo }) {
    return authService.signInWithGoogle({ redirectTo });
  },
  onStateChange() {
    renderProfileSync();
  },
});

const authLifecycleCoordinator = createAuthLifecycleCoordinator({
  initialAuthState: authState,
  applyAuthState(state) {
    const resolvedState = resolveAuthCallbackState(callbackAuthState, state);
    applyAuthState(resolvedState, {
      persistMessage:
        resolvedState.status === "authenticated" ? "Profile updated locally" : null,
    });
  },
});

const authSubscriptionCoordinator = createAuthSubscriptionCoordinator({
  onAuthState(state) {
    return authLifecycleCoordinator.observeAuthState(state);
  },
});

function attachAuthSubscription() {
  return authSubscriptionCoordinator.attach({
    clientGeneration: supabaseClient.client,
    subscribe(callback) {
      return authService.onAuthStateChange(callback);
    },
  });
}

function persistData(message = "Saved locally") {
  appData.sessions = sessions;
  appData.sync = {
    ...appData.sync,
    status: "local",
    lastSyncedAt: null,
    lastError: null,
    updatedAt: new Date().toISOString(),
  };
  const result = saveData(localStorage, appData);
  appData = result.data;
  elements.saveStatus.textContent = result.saved ? message : "Could not save locally";
  renderProfileSync();
  void saveSharedData(appData);
}

function persistAuthProfileState(message) {
  appData.sessions = sessions;
  const result = saveData(localStorage, appData);
  appData = result.data;
  elements.saveStatus.textContent = result.saved ? message : "Could not save profile locally";
  renderProfileSync();
  void saveSharedData(appData);
}

function completedFastCount() {
  return sessions.filter((session) => !session.deletedAt && session.endedAt).length;
}

async function loadSharedData() {
  const dataUrl = cloudDataUrl(dataSource);
  if (!dataUrl || !cloudSyncKey) {
    if (sessions.length > 0) {
      elements.saveStatus.textContent = dataUrl
        ? `Cloud key needed; showing ${completedFastCount()} completed fasts from this browser`
        : "Saved on this device";
      render();
      return;
    }
    if (isGitHubPagesLocation(globalThis.location)) await loadSampleData();
    else {
      elements.saveStatus.textContent = dataUrl ? "Cloud key needed; saved on this device" : "Saved on this device";
      render();
    }
    return;
  }

  try {
    const response = await fetch(dataUrl, {
      cache: "no-store",
      headers: cloudRequestHeaders(cloudSyncKey),
    });
    if (!response.ok) {
      const error = new Error("Shared data unavailable");
      error.status = response.status;
      throw error;
    }
    const { data } = await response.json();

    if (data) {
      appData = sessions.length > 0 ? mergeData(data, appData) : normalizeData(data);
      sessions.splice(0, sessions.length, ...appData.sessions);
      activeSession = sessions.find((session) => !session.deletedAt && !session.endedAt) ?? null;
      saveData(localStorage, appData);
      await saveSharedData(appData);
    } else {
      await saveSharedData(appData);
    }

    elements.saveStatus.textContent = `Synced with Cloudflare · ${completedFastCount()} completed fasts`;
    render();
  } catch (error) {
    if (isGitHubPagesLocation(globalThis.location)) await loadSampleData();
    else {
      elements.saveStatus.textContent = error?.status === 401
        ? `Cloud key rejected; showing ${completedFastCount()} completed fasts from this browser`
        : `Cloud sync unavailable; showing ${completedFastCount()} completed fasts from this browser`;
      render();
    }
  }
}

async function loadSampleData() {
  if (sessions.length > 0) {
    elements.saveStatus.textContent = "Saved in this browser";
    return;
  }

  try {
    const response = await fetch(SAMPLE_DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Sample data unavailable");

    appData = normalizeData(await response.json());
    sessions.splice(0, sessions.length, ...appData.sessions);
    activeSession = sessions.find((session) => !session.deletedAt && !session.endedAt) ?? null;
    saveData(localStorage, appData);
    elements.saveStatus.textContent = "Viewing sample data";
    render();
  } catch {
    elements.saveStatus.textContent = "Saved in this browser";
  }
}

async function saveSharedData(value) {
  const dataUrl = cloudDataUrl(dataSource);
  if (!dataUrl || !cloudSyncKey) return;

  try {
    const response = await fetch(dataUrl, {
      method: "PUT",
      headers: cloudRequestHeaders(cloudSyncKey, true),
      body: JSON.stringify(value),
    });
    if (response.ok) elements.saveStatus.textContent = "Synced with Cloudflare";
  } catch {}
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function targetLabel(targetHours) {
  return `${targetHours} hour${targetHours === 1 ? "" : "s"}`;
}

function profileLabel() {
  return appData.profile.mode === "authenticated"
    ? appData.profile.displayName
    : "Guest mode";
}

function syncLabel() {
  const labels = {
    error: "Sync issue",
    local: "Local data",
    synced: "Synced",
    syncing: "Syncing",
  };
  return labels[appData.sync.status] ?? labels.local;
}

function syncDescription() {
  if (appData.sync.status === "error") {
    return appData.sync.lastError ?? "Cloud sync needs attention.";
  }

  if (appData.sync.status === "synced" && appData.sync.lastSyncedAt) {
    return `Last synced ${formatDate(appData.sync.lastSyncedAt)} at ${formatTime(appData.sync.lastSyncedAt)}.`;
  }

  if (appData.sync.status === "syncing") {
    return "Preparing to sync your local fasting history.";
  }

  return "Tracking locally now. Cloud sync can plug in later.";
}

function authHelpText(readiness, launchState) {
  if (launchState?.status && launchState.status !== "idle") {
    return launchState.message;
  }
  return authState.message ?? readiness.message;
}

function profileMenuDetail() {
  if (appData.profile.mode === "authenticated") {
    return `${appData.profile.email ?? "Signed in"} · ${appData.profile.provider ?? "google"}`;
  }

  if (authService.isConfigured()) {
    return "Guest mode is active until Google sign-in completes.";
  }

  return "Local data is active.";
}

function currentProfileReadiness() {
  return profileReadReadiness({
    authState,
    clientStatus: supabaseClient.status,
    config: supabaseConfig,
    profileScope: authProfileCoordinator.current(),
    readSupport: true,
  });
}

function sameAuthProfile(left, right) {
  return ["mode", "userId", "email", "displayName", "provider"]
    .every((field) => left?.[field] === right?.[field]);
}

function sessionCheckEnabled() {
  return Boolean(authService.isConfigured() && supabaseClient.status === "ready");
}

function renderSessionHealth() {
  const model = authSessionHealthController.current();
  const freshness = authSessionExpiryController.current().freshness;
  const enabled = sessionCheckEnabled();
  const checking = model.status === "checking";
  elements.sessionHealth.dataset.sessionHealth = model.status;
  elements.sessionHealthStatus.textContent = model.label;
  elements.sessionHealthMessage.textContent = model.message;
  elements.sessionHealthPreview.textContent = model.previewMessage;
  elements.sessionHealthRecovery.textContent =
    `${model.recovery} Visible resume and reconnect signals recheck auth only.`;
  elements.sessionHealthLastCheck.textContent = model.lastCheckedAt
    ? `Last local check ${formatDate(model.lastCheckedAt)} at ${formatTime(model.lastCheckedAt)}.`
    : "No local session check yet.";
  const sourceLabels = {
    expiry: "Session expiry",
    initial: "App start",
    manual: "Manual",
    reconnect: "Connection restored",
    resume: "App resumed",
  };
  elements.sessionHealthSource.textContent = model.lastCheckSource
    ? `Last check source: ${sourceLabels[model.lastCheckSource]}.`
    : "Last check source: Not checked.";
  elements.sessionHealthFreshness.dataset.freshnessStatus = freshness.status;
  elements.sessionHealthFreshness.textContent = freshness.expiresAt
    && ["healthy", "expiring"].includes(freshness.status)
    ? `Session freshness: ${freshness.label} until ${formatDate(freshness.expiresAt)} at ${formatTime(freshness.expiresAt)}.`
    : `Session freshness: ${freshness.label}.`;
  elements.sessionHealthFreshness.title = freshness.message;
  elements.sessionHealthCheck.disabled = !enabled || checking;
  elements.sessionHealthCheck.textContent = checking
    ? "Checking session..."
    : !enabled
      ? "Check unavailable"
      : ["expired", "refresh-failed"].includes(model.status)
        ? "Retry session check"
        : "Check session";
}

function toLocalInputValue(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function renderHero(now = new Date()) {
  if (!activeSession) {
    document.body.classList.remove("is-fasting");
    elements.statusLabel.textContent = "Ready when you are";
    elements.heroTitle.textContent = "Make space between meals.";
    elements.heroCopy.textContent =
      "One tap starts your fast. Come back when you are ready to eat.";
    elements.timer.textContent = "00:00:00";
    elements.timerLabel.textContent = `${appData.settings.targetHours}-hour goal`;
    elements.button.textContent = "Start fast";
    elements.button.setAttribute("aria-pressed", "false");
    elements.button.classList.remove("is-active");
    elements.targetCopy.textContent = `Your target is ${targetLabel(appData.settings.targetHours)}.`;
    elements.progressRing.setAttribute("aria-valuenow", "0");
    elements.progressRing.setAttribute("aria-valuetext", "Not fasting");
    elements.progressRing.style.setProperty("--progress", "0deg");
    return;
  }

  document.body.classList.add("is-fasting");
  const elapsed = durationMs(activeSession, now);
  const complete = isComplete(activeSession, now);
  const percent = progress(activeSession, now);
  const percentComplete = Math.round(percent * 100);
  const targetEnd = new Date(
    new Date(activeSession.startedAt).getTime() + activeSession.targetHours * 60 * 60 * 1000,
  );

  elements.statusLabel.textContent = complete ? "Target reached" : "Fast in progress";
  elements.heroTitle.textContent = complete ? "You reached your goal." : "Stay steady.";
  elements.heroCopy.textContent = complete
    ? "Your daily target is complete. End the fast whenever you are ready."
    : `You started at ${formatTime(activeSession.startedAt)}. Keep going at your own pace.`;
  elements.timer.textContent = formatDuration(elapsed);
  elements.timerLabel.textContent = complete ? "Goal complete" : `${percentComplete}% complete`;
  elements.button.textContent = "End current fast";
  elements.button.setAttribute("aria-pressed", "true");
  elements.button.classList.add("is-active");
  elements.targetCopy.textContent = complete
    ? `Target reached at ${formatTime(targetEnd)}.`
    : `Target time: ${formatTime(targetEnd)}.`;
  elements.progressRing.setAttribute("aria-valuenow", String(percentComplete));
  elements.progressRing.setAttribute(
    "aria-valuetext",
    complete ? "Goal complete" : `${percentComplete}% complete`,
  );
  elements.progressRing.style.setProperty("--progress", `${percent * 360}deg`);
}

function renderStats() {
  const stats = summarize(sessions);
  elements.completedFasts.textContent = stats.completedFasts;
  elements.totalHours.textContent = stats.totalHours.toFixed(1);
  elements.currentStreak.textContent = stats.currentStreak;
}

function renderHistory() {
  const completedSessions = recentSessionsForDays(sessions, new Date(), 7);

  elements.sessionList.setAttribute("aria-live", activeSession ? "off" : "polite");
  elements.emptyState.hidden = Boolean(activeSession) || completedSessions.length > 0;
  elements.sessionList.replaceChildren(
    ...(activeSession
      ? [
          createActiveSessionRow(activeSession),
        ]
      : []),
    ...completedSessions.slice(0, 10).map((session) => {
      const item = document.createElement("li");
      const complete = isComplete(session);
      item.className = "session-row";
      item.innerHTML = `
        <div>
          <span class="session-date">${formatDate(session.endedAt)}</span>
          <span class="session-times">${formatTime(session.startedAt)} to ${formatTime(session.endedAt)}</span>
        </div>
        <div class="session-result-column">
          <span class="session-duration">${formatHoursAndMinutes(durationMs(session))}</span>
          <span class="session-result ${complete ? "complete" : ""}">${complete ? "Goal reached" : "Fast ended early"}</span>
          <button class="text-button edit-session" type="button" data-session-id="${session.id}" aria-label="Edit fast from ${formatTime(session.startedAt)} to ${formatTime(session.endedAt)} on ${formatDate(session.endedAt)}">Edit</button>
        </div>
      `;
      return item;
    }),
  );
}

function openSessionDialog(sessionId) {
  const session = sessions.find((item) => item.id === sessionId && !item.deletedAt);
  if (!session?.endedAt) return;

  editingSessionId = session.id;
  deleteConfirmationPending = false;
  elements.deleteSession.textContent = "Delete session";
  elements.sessionError.textContent = "";
  elements.sessionStartedAt.value = toLocalInputValue(session.startedAt);
  elements.sessionEndedAt.value = toLocalInputValue(session.endedAt);
  elements.sessionSummary.textContent =
    `${formatHoursAndMinutes(durationMs(session))} · ${session.targetHours}-hour goal · ` +
    `${isComplete(session) ? "Goal reached" : "Ended early"}`;
  elements.sessionDialog.showModal();
}

function closeSessionDialog() {
  editingSessionId = null;
  deleteConfirmationPending = false;
  elements.sessionDialog.close();
}

function createActiveSessionRow(session, now = new Date()) {
  const item = document.createElement("li");
  const targetEnd = new Date(
    new Date(session.startedAt).getTime() + session.targetHours * 60 * 60 * 1000,
  );
  item.className = "session-row active-session";
  item.innerHTML = `
    <div>
      <span class="session-date"><span class="live-dot"></span>Currently fasting</span>
      <span class="session-times">Started ${formatTime(session.startedAt)} · Goal time ${formatTime(targetEnd)}</span>
    </div>
    <div>
      <span class="session-duration">${formatDuration(durationMs(session, now))}</span>
      <span class="session-result complete">${session.targetHours}-hour goal</span>
    </div>
  `;
  return item;
}

function render() {
  renderHero();
  renderStats();
  renderHistory();
  renderTheme();
  renderSettings();
  renderProfileSync();
}

function renderTheme() {
  for (const option of elements.themeOptions) {
    option.setAttribute("aria-pressed", String(option.dataset.themeOption === selectedTheme));
  }
}

function renderSettings() {
  if (!elements.targetHours) return;
  elements.targetHours.value = appData.settings.targetHours;
  elements.targetHours.disabled = Boolean(activeSession);
}

function renderMigrationPreview(model) {
  elements.migrationPreview.dataset.previewStatus = model.status;
  elements.migrationPreviewTitle.textContent = model.title;
  elements.migrationPreviewMessage.textContent = model.message;
  elements.migrationPreviewStats.replaceChildren(
    ...model.stats.map((item) => {
      const card = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = item.label;
      description.textContent = item.value;
      description.dataset.tone = item.tone;
      card.append(term, description);
      return card;
    }),
  );
  elements.migrationPreviewDetails.replaceChildren(
    ...model.details.map((detail) => {
      const item = document.createElement("li");
      item.textContent = detail;
      return item;
    }),
  );
  elements.migrationConfirm.disabled = model.confirmation.disabled;
  elements.migrationConfirm.textContent = model.confirmation.label;
  elements.migrationConfirmDetail.textContent = model.confirmation.message;
}

function renderSyncDiagnostics(diagnostics) {
  const model = createSyncDiagnosticsViewModel(diagnostics);
  elements.syncDiagnostics.dataset.diagnosticStatus = model.status;
  elements.syncDiagnosticsStages.replaceChildren(
    ...model.stages.map((stage) => {
      const item = document.createElement("li");
      const heading = document.createElement("div");
      const index = document.createElement("span");
      const label = document.createElement("strong");
      const status = document.createElement("span");
      const message = document.createElement("small");

      item.className = "sync-diagnostic-stage";
      item.dataset.stage = stage.key;
      item.dataset.stageStatus = stage.status;
      heading.className = "sync-diagnostic-heading";
      index.className = "sync-diagnostic-index";
      index.textContent = stage.index;
      label.textContent = stage.label;
      status.className = "sync-diagnostic-status";
      status.dataset.tone = stage.tone;
      status.textContent = stage.statusLabel;
      message.textContent = stage.message;
      heading.append(index, label, status);
      item.append(heading, message);
      return item;
    }),
  );
  elements.syncDiagnosticsSafety.textContent = model.safetyItems.join(" · ");
  elements.syncDiagnosticsNextStep.textContent = model.nextStep;
}

function renderSyncRefreshControl(model) {
  elements.syncPreviewRefresh.dataset.refreshStatus = model.status;
  elements.syncPreviewRefresh.disabled = model.disabled;
  elements.syncPreviewRefresh.textContent = model.label;
  elements.syncPreviewRefreshDetail.textContent = model.message;
}

function renderSyncPreview(model, diagnostics, refreshControl) {
  elements.syncPreview.dataset.previewStatus = model.status;
  elements.syncPreviewTitle.textContent = model.title;
  elements.syncPreviewMessage.textContent = model.message;
  elements.syncPreviewLastSync.textContent = model.lastSync;
  elements.syncPreviewStats.replaceChildren(
    ...model.stats.map((item) => {
      const card = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = item.label;
      description.textContent = item.value;
      description.dataset.tone = item.tone;
      card.append(term, description);
      return card;
    }),
  );
  elements.syncPreviewDetails.replaceChildren(
    ...model.details.map((detail) => {
      const item = document.createElement("li");
      item.textContent = detail;
      return item;
    }),
  );
  elements.syncPreviewAction.disabled = model.action.disabled;
  elements.syncPreviewAction.textContent = model.action.label;
  elements.syncPreviewActionDetail.textContent = model.action.message;
  renderSyncDiagnostics(diagnostics);
  renderSyncRefreshControl(refreshControl);
}

function renderPushPreview(model) {
  elements.pushPreview.dataset.previewStatus = model.status;
  elements.pushPreviewTitle.textContent = model.title;
  elements.pushPreviewMessage.textContent = model.message;
  elements.pushPreviewStats.replaceChildren(
    ...model.stats.map((item) => {
      const card = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = item.label;
      description.textContent = item.value;
      description.dataset.tone = item.tone;
      card.append(term, description);
      return card;
    }),
  );
  elements.pushPreviewDetails.replaceChildren(
    ...model.details.map((detail) => {
      const item = document.createElement("li");
      item.textContent = detail;
      return item;
    }),
  );
  elements.pushPreviewAction.disabled = model.action.disabled;
  elements.pushPreviewAction.textContent = model.action.label;
  elements.pushPreviewActionDetail.textContent = model.action.message;
}

function actionValue(action) {
  return action?.enabled ? "Ready" : "Disabled";
}

function actionTone(action) {
  return action?.enabled ? "good" : "warn";
}

function orchestrationStats(model) {
  return [
    { label: "Status", value: model.status, tone: model.status === "ready" ? "good" : "warn" },
    { label: "Read", value: actionValue(model.actions.read), tone: actionTone(model.actions.read) },
    { label: "Apply", value: actionValue(model.actions.apply), tone: actionTone(model.actions.apply) },
    { label: "Push", value: actionValue(model.actions.push), tone: actionTone(model.actions.push) },
    { label: "Finalize", value: actionValue(model.actions.finalizePush), tone: actionTone(model.actions.finalizePush) },
    {
      label: "Backups",
      value: model.backupExpectations.applyRequiresBackup || model.backupExpectations.pushFinalizationRequiresBackup
        ? "Required"
        : "Standby",
      tone: "neutral",
    },
  ];
}

function orchestrationDetails(model, statusModel) {
  const actionDetails = Object.entries(model.actions).map(([key, item]) =>
    `${key}: ${item.enabled ? "enabled" : "disabled"} - ${item.message}`,
  );
  const backupDetails = [
    `Apply backup: ${model.backupExpectations.applyRequiresBackup ? "required before apply" : "not required yet"}.`,
    `Push finalization backup: ${model.backupExpectations.pushFinalizationRequiresBackup ? "required before finalization" : "not required yet"}.`,
  ];
  const blockerDetails = model.blockers.map((blocker) =>
    `${blocker.stage}: ${blocker.code} - ${blocker.message}`,
  );

  return [
    ...statusModel.details,
    ...actionDetails,
    ...backupDetails,
    ...blockerDetails,
  ];
}

function renderOrchestrationPreview(model, statusModel) {
  elements.orchestrationPreview.dataset.previewStatus = statusModel.status;
  elements.orchestrationPreviewTitle.textContent = statusModel.title;
  elements.orchestrationPreviewMessage.textContent = statusModel.message;
  elements.orchestrationPreviewStats.replaceChildren(
    ...orchestrationStats(model).map((item) => {
      const card = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = item.label;
      description.textContent = item.value;
      description.dataset.tone = item.tone;
      card.append(term, description);
      return card;
    }),
  );
  elements.orchestrationPreviewDetails.replaceChildren(
    ...orchestrationDetails(model, statusModel).map((detail) => {
      const item = document.createElement("li");
      item.textContent = detail;
      return item;
    }),
  );
  elements.orchestrationPreviewAction.disabled = statusModel.action.disabled;
  elements.orchestrationPreviewAction.textContent = statusModel.action.label;
  elements.orchestrationPreviewActionDetail.textContent = statusModel.action.message;
}

function syncPullKey(readiness) {
  const resourceKey = JSON.stringify({
    canRead: readiness.canRead,
    reason: readiness.reason,
    sessionState: sessions
      .map((session) => `${session.id}:${session.updatedAt}:${session.deletedAt ?? ""}`)
      .sort()
      .join("|"),
    syncUpdatedAt: appData.sync.updatedAt,
  });
  return authProfileCoordinator.scopeKey(resourceKey);
}

function fallbackSyncPull(readiness, { error = readiness.message, readOutcome = "not-run" } = {}) {
  const applyReadiness = syncApplyReadiness();
  const plan = createFailedSyncReadPlan({
    error,
    localData: appData,
  });

  return {
    diagnostics: createCloudReadApplyDiagnostics({
      applyReadiness,
      plan,
      readOutcome,
      readiness,
    }),
    model: createSyncPreviewModel(plan, { applyReadiness, readiness }),
    plan,
  };
}

function loadingSyncPull(readiness) {
  const fallback = fallbackSyncPull(readiness, {
    error: "Cloud read is in progress.",
    readOutcome: "loading",
  });

  return {
    ...fallback,
    model: createSyncLoadingPreviewModel(appData),
  };
}

function refreshCloudPullPreview(readiness, key, { force = false } = {}) {
  if (!readiness.canRead) {
    syncPullController.disable(readiness.message);
    return;
  }

  const repository = createSupabaseSyncReadRepository({
    client: supabaseClient.client,
    readiness,
  });

  void syncPullController.refresh({
    applyReadiness: syncApplyReadiness(),
    force,
    identityKey: authProfileCoordinator.current().identityKey,
    key,
    localData: appData,
    readiness,
    repository,
    user: authState.user,
  });
}

function remoteSessionsForPush(readKey) {
  const state = syncPullController.current();
  const profileScope = authProfileCoordinator.current();
  return state.key === readKey
    && state.identityKey === profileScope.identityKey
    && state.result?.plan?.status === "ready"
    ? state.result.plan.data.sessions
    : [];
}

function renderOAuthReadiness(readiness) {
  const statuses = {
    callback: elements.oauthCallbackStatus,
    provider: elements.oauthProviderStatus,
    redirect: elements.oauthRedirectStatus,
    sdk: elements.oauthSdkStatus,
    signIn: elements.oauthSignInStatus,
  };

  for (const [name, element] of Object.entries(statuses)) {
    const stage = readiness.stages[name];
    element.textContent = stage.label;
    element.dataset.oauthStatus = stage.status;
    element.parentElement.title = stage.message;
  }
}

function renderProfileProvisioning(model) {
  elements.profileProvisioning.dataset.profileStatus = model.status;
  elements.profileProvisioningTitle.textContent = model.title;
  elements.profileProvisioningStatus.textContent = model.statusLabel;
  elements.profileProvisioningStatus.dataset.tone = model.status === "blocked" ? "warn" :
    ["current", "preview", "loading"].includes(model.status) ? "good" : "muted";
  elements.profileProvisioningMessage.textContent = model.message;
  elements.profileProvisioningStages.replaceChildren(
    ...model.stages.map((stage) => {
      const item = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      item.title = stage.message;
      term.textContent = stage.name;
      description.textContent = stage.label;
      description.dataset.tone = stage.tone;
      item.append(term, description);
      return item;
    }),
  );
  elements.profileProvisioningSafety.textContent = model.safety;
}

function renderProfileProvisioningRefresh(model) {
  elements.profileProvisioningRefresh.dataset.refreshStatus = model.status;
  elements.profileProvisioningRefresh.disabled = model.disabled;
  elements.profileProvisioningRefresh.textContent = model.label;
  elements.profileProvisioningRefreshDetail.textContent = model.message;
}

function renderProfileValidationReport(model) {
  elements.profileValidation.dataset.validationStatus = model.status;
  elements.profileValidationTitle.textContent = model.title;
  elements.profileValidationStatus.textContent = model.status.replaceAll("-", " ");
  elements.profileValidationStatus.dataset.tone = model.status === "validated"
    ? "good"
    : model.status === "blocked"
      ? "warn"
      : "muted";
  elements.profileValidationMessage.textContent = model.message;
  elements.profileValidationStats.replaceChildren(
    ...[
      ["Decision", model.action, model.action === "Not run" ? "muted" : "good"],
      ["Create", model.counts.create, "good"],
      ["Update", model.counts.update, "good"],
      ["No-op", model.counts.noop, "good"],
      ["Invalid", model.counts.invalid, model.counts.invalid > 0 ? "warn" : "good"],
    ].map(([label, value, tone]) => {
      const card = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      description.dataset.tone = tone;
      card.append(term, description);
      return card;
    }),
  );
  elements.profileValidationStages.replaceChildren(
    ...model.stages.map((stage, index) => {
      const item = document.createElement("li");
      const heading = document.createElement("div");
      const number = document.createElement("span");
      const label = document.createElement("strong");
      const status = document.createElement("span");
      const message = document.createElement("small");
      item.dataset.stage = stage.key;
      item.dataset.stageStatus = stage.status;
      number.textContent = String(index + 1).padStart(2, "0");
      label.textContent = stage.label;
      status.textContent = stage.status.replaceAll("-", " ");
      status.dataset.tone = validationTone(stage.status);
      message.textContent = stage.message;
      heading.append(number, label, status);
      item.append(heading, message);
      return item;
    }),
  );
  elements.profileValidationSafety.textContent = model.safety;
}

function renderProfileExecutionControl(model) {
  elements.profileExecutionConfirm.dataset.executionStatus = model.status;
  elements.profileExecutionConfirm.disabled = model.disabled;
  elements.profileExecutionConfirm.textContent = model.label;
  elements.profileExecutionConfirmDetail.textContent = model.message;
}

function refreshProfileProvisioning(readiness, { force = false } = {}) {
  if (!readiness.canRead) return;
  void profileProvisioningController.refresh({
    authState,
    force,
    profileScope: authProfileCoordinator.current(),
    readiness,
  });
}

function validationTone(status) {
  if (["confirmed", "no-op", "passed"].includes(status)) return "good";
  if (["blocked", "confirmation-blocked", "failed"].includes(status)) return "warn";
  return "muted";
}

function renderOAuthValidationReport(model) {
  elements.oauthValidation.dataset.validationStatus = model.status;
  elements.oauthValidationStatus.textContent = model.status.replaceAll("-", " ");
  elements.oauthValidationStatus.dataset.tone = model.status === "ready"
    ? "good"
    : model.status === "blocked"
      ? "warn"
      : "muted";
  elements.oauthValidationTitle.textContent = model.title;
  elements.oauthValidationMessage.textContent = model.message;
  elements.oauthValidationStats.replaceChildren(
    ...[
      ["Local sessions", model.summary.localSessionCount],
      ["Cloud rows", model.summary.remoteSessionCount],
      ["Duplicates", model.summary.duplicateCount],
      ["Invalid rows", model.summary.invalidRowCount],
    ].map(([label, value]) => {
      const card = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      description.dataset.tone = value > 0 && label === "Invalid rows" ? "warn" : "good";
      card.append(term, description);
      return card;
    }),
  );
  elements.oauthValidationStages.replaceChildren(
    ...model.stages.map((stage, index) => {
      const item = document.createElement("li");
      const heading = document.createElement("div");
      const number = document.createElement("span");
      const label = document.createElement("strong");
      const status = document.createElement("span");
      const message = document.createElement("small");
      item.dataset.stage = stage.key;
      item.dataset.stageStatus = stage.status;
      number.textContent = String(index + 1).padStart(2, "0");
      label.textContent = stage.label;
      status.textContent = stage.status.replaceAll("-", " ");
      status.dataset.tone = validationTone(stage.status);
      message.textContent = stage.message;
      heading.append(number, label, status);
      item.append(heading, message);
      return item;
    }),
  );
  elements.oauthValidationSafety.textContent = [
    "Profile-scoped preview",
    "Local data unchanged",
    "Sync status unchanged",
    "Provider tokens omitted",
    "Apply and writes disabled",
  ].join(" · ");
}

function renderProfileSync() {
  const readiness = authReadiness({
    authState,
    clientStatus: supabaseClient.status,
    config: supabaseConfig,
    location: globalThis.location,
  });
  const migrationPlan = createGuestMigrationPlan({
    authState,
    localData: appData,
    profile: appData.profile,
  });
  const migrationReadiness = supabaseMigrationRepositoryReadiness({
    client: supabaseClient.client,
    config: supabaseConfig,
  });
  const cloudReadReadiness = syncReadReadiness({
    authState,
    clientStatus: supabaseClient.status,
    config: supabaseConfig,
  });
  const applyReadiness = syncApplyReadiness();
  const profileScope = authProfileCoordinator.current();
  const profileProvisioningReadiness = currentProfileReadiness();
  const profileProvisioningState = profileProvisioningController.current();
  const scopedProfileProvisioningState = profileProvisioningState.identityKey === profileScope.identityKey
    ? profileProvisioningState
    : null;
  const profileWriteRepositoryReadiness = supabaseProfileWriteRepositoryReadiness({
    authState,
    client: supabaseClient.client,
    config: supabaseConfig,
    executeConfirmations: false,
    executeWrites: false,
    profileScope,
  });
  const profileExecutionReadiness = createProfileExecutionReadiness({
    authState,
    confirmationSupport: profileWriteRepositoryReadiness.canConfirm,
    plan: scopedProfileProvisioningState?.plan,
    profileScope,
    writeSupport: profileWriteRepositoryReadiness.canWrite,
  });
  const profileExecutionResult = createProfileExecutionResultStatusModel({
    plan: scopedProfileProvisioningState?.plan,
    profileScope,
  });
  const sessionHealth = authSessionHealthController.current();
  const profileMutationPreflight = createProfileMutationPreflightModel({
    authState,
    executionReadiness: profileExecutionReadiness,
    executionResult: profileExecutionResult,
    localData: appData,
    mockScenario: false,
    plan: scopedProfileProvisioningState?.plan,
    profileScope,
    repositoryReadiness: profileWriteRepositoryReadiness,
    sessionHealth,
  });
  const profileWriteActivationPolicy = createProfileWriteActivationPolicy({
    activationEnabled: false,
    allowedOrigins: supabaseConfig.authRedirectOrigins,
    authState,
    backupReadiness: {
      marker: null,
      offlineCopyAvailable: true,
      preserved: false,
    },
    challenge: null,
    executionReadiness: profileExecutionReadiness,
    fastSessionsWritesEnabled: false,
    localData: appData,
    location: globalThis.location,
    operatorTestMode: false,
    plan: scopedProfileProvisioningState?.plan,
    profileScope,
    readEvidence: {
      identityKey: scopedProfileProvisioningState?.identityKey ?? null,
      ownershipVerified: Boolean(
        scopedProfileProvisioningState?.plan
        && scopedProfileProvisioningState.plan.blockers?.length === 0,
      ),
      status: scopedProfileProvisioningState?.plan
        ? "passed"
        : scopedProfileProvisioningState?.status ?? "not-run",
      table: "profiles",
    },
    repositoryReadiness: profileWriteRepositoryReadiness,
    sessionHealth,
    target: "profiles",
  });
  const profileExecutionOrchestration = createProfileExecutionOrchestrationModel({
    activationPolicy: profileWriteActivationPolicy,
    authState,
    executionReadiness: profileExecutionReadiness,
    executionResult: profileExecutionResult,
    localData: appData,
    mutationPreflight: profileMutationPreflight,
    profileScope,
    provisioningState: profileProvisioningState,
    repositoryReadiness: profileWriteRepositoryReadiness,
  });
  const cloudReadKey = syncPullKey(cloudReadReadiness);
  const pushReadiness = syncPushReadiness({
    authState,
    clientStatus: supabaseClient.status,
    config: supabaseConfig,
  });
  const pushPlan = createCloudPushPlan({
    localData: appData,
    readiness: pushReadiness,
    remoteSessions: remoteSessionsForPush(cloudReadKey),
    user: authState.user,
  });
  const pushRepositoryReadiness = supabasePushRepositoryReadiness({
    client: supabaseClient.client,
    config: supabaseConfig,
  });
  const pushFinalizationReadiness = createPushFinalizationReadiness({
    pushReadiness,
    repositoryReadiness: pushRepositoryReadiness,
  });
  const pullState = syncPullController.current();
  const oauthLaunchState = oauthLaunchController.current();
  const pullStateMatches = Boolean(
    profileScope.identityKey
    && pullState.identityKey === profileScope.identityKey
    && pullState.key === cloudReadKey,
  );
  const scopedPullState = pullStateMatches
    ? pullState
    : {
        identityKey: profileScope.identityKey,
        key: cloudReadKey,
        message: profileScope.message,
        reason: null,
        result: null,
        status: cloudReadReadiness.canRead ? "idle" : "disabled",
      };
  const pullResult = pullStateMatches ? pullState.result : null;
  const readPlan = pullResult?.plan ?? null;
  const orchestrationModel = createSyncOrchestrationModel({
    applyReadiness,
    localData: appData,
    pushFinalizationReadiness,
    pushPlan,
    pushReadiness,
    pushRepositoryReadiness,
    readPlan,
    readReadiness: cloudReadReadiness,
  });

  elements.profileBadge.textContent = `${profileLabel()} · ${syncLabel()}`;
  elements.profileMode.textContent = profileLabel();
  elements.profileMenu.dataset.authStatus = authState.status;
  elements.profileMenuTitle.textContent = profileLabel();
  elements.profileMenuDetail.textContent = profileMenuDetail();
  elements.syncStatus.textContent = syncLabel();
  elements.syncStatus.dataset.syncStatus = appData.sync.status;
  elements.syncDescription.textContent = syncDescription();
  elements.authReadinessStatus.textContent = readiness.label;
  elements.authReadinessStatus.dataset.readinessStatus = readiness.status;
  elements.authReadinessDetail.textContent = readiness.message;
  elements.googleSignIn.hidden = !authService.isConfigured() || appData.profile.mode === "authenticated";
  elements.googleSignIn.disabled =
    !readiness.canSignIn
    || ["loading", "redirecting"].includes(oauthLaunchState.status);
  elements.signOut.hidden = appData.profile.mode !== "authenticated";
  elements.authHelp.textContent = authHelpText(readiness, oauthLaunchState);
  renderOAuthReadiness(readiness);
  renderSessionHealth();
  renderProfileProvisioning(createProfileProvisioningPreviewModel({
    readiness: profileProvisioningReadiness,
    requestState: scopedProfileProvisioningState,
  }));
  renderProfileProvisioningRefresh(createProfileProvisioningRefreshControlModel({
    readiness: profileProvisioningReadiness,
    requestState: scopedProfileProvisioningState,
  }));
  renderProfileValidationReport(createProfileValidationReport({
    authState,
    executionOrchestration: profileExecutionOrchestration,
    executionReadiness: profileExecutionReadiness,
    localData: appData,
    profileScope,
    readiness: profileProvisioningReadiness,
    requestState: scopedProfileProvisioningState,
    sessionHealth,
  }));
  renderProfileExecutionControl(profileExecutionOrchestration.action);
  renderMigrationPreview(createMigrationPreviewModel(migrationPlan, { migrationReadiness }));
  const displayResult = pullResult
    ?? (scopedPullState.status === "blocked"
      ? fallbackSyncPull(cloudReadReadiness, {
        error: scopedPullState.message,
        readOutcome: "failed",
      })
      : cloudReadReadiness.canRead
        ? loadingSyncPull(cloudReadReadiness)
        : fallbackSyncPull(cloudReadReadiness));
  renderSyncPreview(
    displayResult.model,
    displayResult.diagnostics,
    createSyncRefreshControlModel({
      readiness: cloudReadReadiness,
      requestState: scopedPullState,
    }),
  );
  renderOAuthValidationReport(createOAuthReadValidationReport({
    authState,
    launchState: oauthLaunchState,
    localData: appData,
    oauthReadiness: readiness,
    profileScope,
    pullResult: displayResult,
    requestState: scopedPullState,
    sessionHealth: authSessionHealthController.current(),
  }));
  renderPushPreview(createCloudPushPreviewModel(pushPlan));
  renderOrchestrationPreview(
    orchestrationModel,
    createSyncOrchestrationStatusModel(orchestrationModel),
  );
  refreshProfileProvisioning(profileProvisioningReadiness);
  refreshCloudPullPreview(cloudReadReadiness, cloudReadKey);
}

function applyAuthState(state, {
  healthCheckSource = null,
  healthCheckedAt = null,
  persistMessage,
} = {}) {
  authState = state;
  authLifecycleCoordinator.synchronizeAuthState(state);
  let shouldPersistProfile = false;
  let resolvedPersistMessage = persistMessage;

  if (state.status === "authenticated") {
    const nextProfile = mapAuthStateToProfile(state);
    if (!sameAuthProfile(appData.profile, nextProfile)) {
      appData.profile = nextProfile;
      shouldPersistProfile = true;
      resolvedPersistMessage ??= "Profile updated locally";
    }
  } else if (
    ["error", "guest", "signed-out"].includes(state.status)
    && appData.profile.mode === "authenticated"
  ) {
    appData.profile = mapAuthStateToProfile(state);
    shouldPersistProfile = true;
    resolvedPersistMessage ??= state.status === "error"
      ? "Auth session unavailable; using local data"
      : state.status === "signed-out"
        ? "Signed out locally"
        : "Using guest profile locally";
  }

  const profileScope = authProfileCoordinator.observeAuthState(state);
  oauthLaunchController.observeAuthState(state);
  authSessionHealthController.observeAuthState(state, {
    checkSource: healthCheckSource,
    checkedAt: healthCheckedAt,
    scopeKey: profileScope.identityKey,
  });

  if (shouldPersistProfile) {
    persistAuthProfileState(resolvedPersistMessage);
    return;
  }

  renderProfileSync();
}

elements.button.addEventListener("click", () => {
  const actionAt = Date.now();
  if (actionAt - lastFastButtonActionAt < FAST_BUTTON_COOLDOWN_MS) return;
  lastFastButtonActionAt = actionAt;

  if (activeSession) {
    const index = sessions.findIndex((session) => session.id === activeSession.id);
    sessions[index] = endFast(activeSession);
    activeSession = null;
    persistData("Fast ended and saved locally");
  } else {
    activeSession = startFast(new Date(), appData.settings.targetHours);
    sessions.push(activeSession);
    persistData("Fast started and saved locally");
  }

  render();
});

elements.sessionList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-session-id]");
  if (button) openSessionDialog(button.dataset.sessionId);
});

elements.sessionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const index = sessions.findIndex((session) => session.id === editingSessionId);
  if (index < 0) return;

  try {
    sessions[index] = correctSession(
      sessions[index],
      elements.sessionStartedAt.value,
      elements.sessionEndedAt.value,
    );
    persistData("Session corrected and saved");
    closeSessionDialog();
    render();
  } catch (error) {
    elements.sessionError.textContent = error.message;
  }
});

elements.deleteSession.addEventListener("click", () => {
  if (!deleteConfirmationPending) {
    deleteConfirmationPending = true;
    elements.deleteSession.textContent = "Confirm delete";
    elements.sessionError.textContent = "Click Confirm delete to permanently remove this session.";
    return;
  }

  const index = sessions.findIndex((session) => session.id === editingSessionId);
  if (index < 0) return;
  sessions[index] = deleteSession(sessions[index]);
  persistData("Session deleted");
  closeSessionDialog();
  render();
});

elements.cancelSessionEdit.addEventListener("click", closeSessionDialog);
elements.closeSessionDialog.addEventListener("click", closeSessionDialog);

elements.targetHours.addEventListener("input", () => {
  appData.settings.targetHours = normalizeTargetHours(elements.targetHours.value);
  persistData("Goal saved locally");
  renderHero();
});

elements.targetHours.addEventListener("change", () => render());

elements.syncPreviewRefresh.addEventListener("click", () => {
  const readiness = syncReadReadiness({
    authState,
    clientStatus: supabaseClient.status,
    config: supabaseConfig,
  });
  refreshCloudPullPreview(readiness, syncPullKey(readiness), { force: true });
});

elements.profileProvisioningRefresh.addEventListener("click", () => {
  refreshProfileProvisioning(currentProfileReadiness(), { force: true });
});

async function runLocalSessionCheck({
  persistMessage = null,
  source = AUTH_SESSION_CHECK_SOURCE.MANUAL,
} = {}) {
  const result = await authSessionHealthController.check({
    enabled: sessionCheckEnabled(),
    source,
    scopeKey: authProfileCoordinator.current().identityKey,
  });
  if (!result.accepted || result.ignored || !result.authState) return result;

  const resolvedState = resolveAuthCallbackState(callbackAuthState, result.authState);
  applyAuthState(resolvedState, {
    healthCheckSource: result.checkSource,
    healthCheckedAt: result.checkedAt,
    persistMessage,
  });
  return result;
}

elements.sessionHealthCheck.addEventListener("click", () => {
  void runLocalSessionCheck({ source: AUTH_SESSION_CHECK_SOURCE.MANUAL });
});

function authRecoveryContext() {
  return {
    enabled: sessionCheckEnabled(),
    online: globalThis.navigator?.onLine !== false,
    scopeKey: authProfileCoordinator.current().identityKey,
    visibilityState: document.visibilityState ?? "visible",
  };
}

function scheduleAuthExpiryCheck() {
  return authSessionExpiryController.observe({
    authState,
    enabled: sessionCheckEnabled(),
    healthState: authSessionHealthController.current(),
    online: globalThis.navigator?.onLine !== false,
    scopeKey: authProfileCoordinator.current().identityKey,
    visibilityState: document.visibilityState ?? "visible",
  });
}

document.addEventListener("visibilitychange", () => {
  scheduleAuthExpiryCheck();
  void authSessionRecoveryCoordinator.resume(authRecoveryContext());
});

globalThis.addEventListener("online", () => {
  scheduleAuthExpiryCheck();
  void authSessionRecoveryCoordinator.reconnect(authRecoveryContext());
});

globalThis.addEventListener("offline", () => {
  scheduleAuthExpiryCheck();
});

elements.exportButton.addEventListener("click", () => {
  const blob = new Blob([serializeBackup(appData)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `fast-thirteen-backup-${date}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  elements.saveStatus.textContent = "Backup exported";
});

elements.importButton.addEventListener("click", () => elements.importFile.click());

elements.googleSignIn.addEventListener("click", async () => {
  const readiness = authReadiness({
    authState,
    clientStatus: supabaseClient.status,
    config: supabaseConfig,
    location: globalThis.location,
  });
  await oauthLaunchController.start({ readiness });
});

elements.signOut.addEventListener("click", async () => {
  elements.authHelp.textContent = "Signing out...";
  const result = await authService.signOut();
  if (!result.ok) {
    elements.authHelp.textContent = result.message;
    return;
  }
  applyAuthState(
    {
      configured: authService.isConfigured(),
      error: result.error ?? null,
      message: result.message,
      status: result.status,
      user: null,
    },
    {
      persistMessage: result.ok ? "Signed out locally" : null,
    },
  );
});

elements.importFile.addEventListener("change", async () => {
  const [file] = elements.importFile.files;
  if (!file) return;

  try {
    appData = mergeData(appData, parseBackup(await file.text()));
    sessions.splice(0, sessions.length, ...appData.sessions);
    activeSession = sessions.find((session) => !session.deletedAt && !session.endedAt) ?? null;
    persistData("Backup imported");
    render();
  } catch {
    elements.saveStatus.textContent = "Backup could not be imported";
  } finally {
    elements.importFile.value = "";
  }
});

for (const option of elements.themeOptions) {
  option.addEventListener("click", () => {
    selectedTheme = applyTheme(
      document.documentElement,
      saveTheme(localStorage, option.dataset.themeOption),
    );
    renderTheme();
  });
}

render();
loadSharedData();

async function initializeSupabaseAuth() {
  const previousClient = supabaseClient.client;
  const bootstrapState = await supabaseSdkBootstrap.load({
    config: supabaseConfig,
    source: globalThis,
  });
  supabaseClient = bootstrapState;
  if (previousClient && previousClient !== bootstrapState.client) {
    profileProvisioningController.invalidate({ reason: "client-replaced" });
  }
  authService = createAuthService({
    config: supabaseConfig,
    clientStatus: supabaseClient.status,
    location: globalThis.location,
    supabaseClient: supabaseClient.client,
  });

  if (bootstrapState.status !== "ready") {
    if (!callbackAuthState) applyAuthState(authService.initialState());
    return;
  }

  await runLocalSessionCheck({
    persistMessage: "Profile updated locally",
    source: AUTH_SESSION_CHECK_SOURCE.INITIAL,
  });

  attachAuthSubscription();
}

globalThis.addEventListener("pagehide", () => {
  authSubscriptionCoordinator.detach({ reason: "pagehide" });
});

globalThis.addEventListener("pageshow", (event) => {
  if (event.persisted && supabaseClient.status === "ready") {
    attachAuthSubscription();
  }
});

void initializeSupabaseAuth();
setInterval(() => {
  renderHero();
  if (activeSession) renderHistory();
}, 1000);
