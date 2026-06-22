import {
  correctSession,
  deleteSession,
  durationMs,
  endFast,
  formatDuration,
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
  cleanAuthCallbackUrl,
  createAuthService,
  mapAuthStateToProfile,
  readAuthCallbackState,
} from "./auth.js";
import { authReadiness } from "./authReadiness.js";
import { createGuestMigrationPlan } from "./migrationPlan.js";
import { createMigrationPreviewModel } from "./migrationPreview.js";
import { createBrowserSupabaseClient } from "./supabaseClient.js";
import { loadSupabaseConfig } from "./supabaseConfig.js";

let appData = loadData(localStorage);
const sessions = appData.sessions;
let activeSession = sessions.find((session) => !session.deletedAt && !session.endedAt) ?? null;
let editingSessionId = null;
let deleteConfirmationPending = false;
let selectedTheme = applyTheme(document.documentElement, loadTheme(localStorage));
const supabaseConfig = loadSupabaseConfig(globalThis);
const supabaseClient = createBrowserSupabaseClient({
  config: supabaseConfig,
  source: globalThis,
});
const authService = createAuthService({
  config: supabaseConfig,
  clientStatus: supabaseClient.status,
  supabaseClient: supabaseClient.client,
});
const callbackAuthState = readAuthCallbackState(
  new URLSearchParams(globalThis.location?.search ?? ""),
);
let authState = authService.initialState(callbackAuthState);
if (callbackAuthState) cleanAuthCallbackUrl(globalThis.location, globalThis.history);

const DAY_MS = 24 * 60 * 60 * 1000;

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
  progressRing: document.querySelector("#progress-ring"),
  saveStatus: document.querySelector("#save-status"),
  sessionDialog: document.querySelector("#session-dialog"),
  sessionEndedAt: document.querySelector("#session-ended-at"),
  sessionError: document.querySelector("#session-error"),
  sessionForm: document.querySelector("#session-form"),
  sessionList: document.querySelector("#session-list"),
  sessionStartedAt: document.querySelector("#session-started-at"),
  sessionSummary: document.querySelector("#session-summary"),
  syncDescription: document.querySelector("#sync-description"),
  syncStatus: document.querySelector("#sync-status"),
  authHelp: document.querySelector("#auth-help"),
  authReadinessDetail: document.querySelector("#auth-readiness-detail"),
  authReadinessStatus: document.querySelector("#auth-readiness-status"),
  signOut: document.querySelector("#sign-out"),
  statusLabel: document.querySelector("#status-label"),
  targetCopy: document.querySelector("#target-copy"),
  timer: document.querySelector("#timer"),
  timerLabel: document.querySelector("#timer-label"),
  themeOptions: [...document.querySelectorAll("[data-theme-option]")],
  targetHours: document.querySelector("#target-hours"),
  totalHours: document.querySelector("#total-hours"),
};

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
  saveSharedData(appData);
}

async function loadSharedData() {
  try {
    const response = await fetch("/api/data", { cache: "no-store" });
    if (!response.ok) return;
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

    elements.saveStatus.textContent = "Saved on this Mac";
    render();
  } catch {
    elements.saveStatus.textContent = "Saved in this browser";
  }
}

async function saveSharedData(value) {
  try {
    const response = await fetch("/api/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    if (response.ok) elements.saveStatus.textContent = "Saved on this Mac";
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

function isWithinPastDays(value, days, now = new Date()) {
  return new Date(value).getTime() >= now.getTime() - days * DAY_MS;
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

function authHelpText() {
  if (!authService.isConfigured()) {
    return "Google sign-in is disabled until Supabase publishable config is added. Local tracking still works.";
  }

  if (authState.message) {
    return authState.message;
  }

  if (authState.status === "loading") {
    return "Checking Google sign-in status...";
  }

  if (authState.status === "authenticated") {
    return "Signed in with Google. Cloud sync will use this profile in the next milestone.";
  }

  if (authState.status === "cancelled") {
    return "Google sign-in was cancelled. Local tracking still works.";
  }

  if (authState.status === "not-ready") {
    return "Supabase config is present, but the browser client is not loaded yet.";
  }

  if (authState.error || authState.status === "error") {
    return "Could not read the current auth session. Local tracking still works.";
  }

  return "Google sign-in wiring is ready for OAuth credentials.";
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
    elements.button.classList.remove("is-active");
    elements.targetCopy.textContent = `Your target is ${targetLabel(appData.settings.targetHours)}.`;
    elements.progressRing.style.setProperty("--progress", "0deg");
    return;
  }

  document.body.classList.add("is-fasting");
  const elapsed = durationMs(activeSession, now);
  const complete = isComplete(activeSession, now);
  const percent = progress(activeSession, now);
  const targetEnd = new Date(
    new Date(activeSession.startedAt).getTime() + activeSession.targetHours * 60 * 60 * 1000,
  );

  elements.statusLabel.textContent = complete ? "Target reached" : "Fast in progress";
  elements.heroTitle.textContent = complete ? "You reached your goal." : "Stay steady.";
  elements.heroCopy.textContent = complete
    ? "Your daily target is complete. End the fast whenever you are ready."
    : `You started at ${formatTime(activeSession.startedAt)}. Keep going at your own pace.`;
  elements.timer.textContent = formatDuration(elapsed);
  elements.timerLabel.textContent = complete ? "Goal complete" : `${Math.round(percent * 100)}% complete`;
  elements.button.textContent = "End current fast";
  elements.button.classList.add("is-active");
  elements.targetCopy.textContent = complete
    ? `Target reached at ${formatTime(targetEnd)}.`
    : `Target time: ${formatTime(targetEnd)}.`;
  elements.progressRing.style.setProperty("--progress", `${percent * 360}deg`);
}

function renderStats() {
  const stats = summarize(sessions);
  elements.completedFasts.textContent = stats.completedFasts;
  elements.totalHours.textContent = stats.totalHours.toFixed(1);
  elements.currentStreak.textContent = stats.currentStreak;
}

function renderHistory() {
  const completedSessions = sessions
    .filter((session) => !session.deletedAt && session.endedAt && isWithinPastDays(session.endedAt, 7))
    .sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt));

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
          <span class="session-duration">${formatDuration(durationMs(session)).slice(0, 5)}</span>
          <span class="session-result ${complete ? "complete" : ""}">${complete ? "Goal reached" : "Fast ended early"}</span>
          <button class="text-button edit-session" type="button" data-session-id="${session.id}">Edit</button>
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
    `${formatDuration(durationMs(session)).slice(0, 5)} · ${session.targetHours}-hour goal · ` +
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
      <span class="session-times">Started ${formatTime(session.startedAt)} · Target ${formatTime(targetEnd)}</span>
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

function renderProfileSync() {
  const readiness = authReadiness({
    authStatus: authState.status,
    clientStatus: supabaseClient.status,
    config: supabaseConfig,
  });
  const migrationPlan = createGuestMigrationPlan({
    authState,
    localData: appData,
    profile: appData.profile,
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
  elements.googleSignIn.disabled = ["loading", "redirecting"].includes(authState.status);
  elements.signOut.hidden = appData.profile.mode !== "authenticated";
  elements.authHelp.textContent = authHelpText();
  renderMigrationPreview(createMigrationPreviewModel(migrationPlan));
}

function applyAuthState(state, { persistMessage } = {}) {
  authState = state;

  if (state.status === "authenticated") {
    appData.profile = mapAuthStateToProfile(state);
    persistData(persistMessage ?? "Profile updated locally");
    return;
  }

  if (state.status === "signed-out") {
    appData.profile = mapAuthStateToProfile(state);
    persistData(persistMessage ?? "Signed out locally");
    return;
  }

  if (state.status === "guest" && appData.profile.mode === "authenticated") {
    appData.profile = mapAuthStateToProfile(state);
    persistData(persistMessage ?? "Using guest profile locally");
    return;
  }

  renderProfileSync();
}

elements.button.addEventListener("click", () => {
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

elements.exportButton.addEventListener("click", () => {
  const blob = new Blob([serializeBackup(appData)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `fast-thirteen-backup-${date}.json`;
  link.click();
  URL.revokeObjectURL(url);
  elements.saveStatus.textContent = "Backup exported";
});

elements.importButton.addEventListener("click", () => elements.importFile.click());

elements.googleSignIn.addEventListener("click", async () => {
  applyAuthState({
    ...authState,
    message: "Opening Google sign-in...",
    status: "redirecting",
  });
  const result = await authService.signInWithGoogle();
  if (!result.ok) {
    applyAuthState({
      ...authState,
      error: result.error ?? null,
      message: result.message,
      status: result.status,
    });
  }
});

elements.signOut.addEventListener("click", async () => {
  elements.authHelp.textContent = "Signing out...";
  const result = await authService.signOut();
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
authService
  .currentAuthState()
  .then((state) => applyAuthState(state, { persistMessage: "Profile updated locally" }))
  .catch(() => {
    applyAuthState({
      configured: authService.isConfigured(),
      error: true,
      message: "Could not read the current auth session. Local tracking still works.",
      status: "guest",
      user: null,
    });
  });
authService.onAuthStateChange((state) => {
  applyAuthState(state, {
    persistMessage: state.status === "authenticated" ? "Profile updated locally" : null,
  });
});
setInterval(() => {
  renderHero();
  if (activeSession) renderHistory();
}, 1000);
