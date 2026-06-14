import {
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
  parseBackup,
  saveData,
  serializeBackup,
} from "./storage.js";
import { applyTheme, loadTheme, saveTheme } from "./theme.js";

let appData = loadData(localStorage);
const sessions = appData.sessions;
let activeSession = sessions.find((session) => !session.endedAt) ?? null;
let selectedTheme = applyTheme(document.documentElement, loadTheme(localStorage));

const elements = {
  button: document.querySelector("#fast-button"),
  clearButton: document.querySelector("#clear-button"),
  completedFasts: document.querySelector("#completed-fasts"),
  currentStreak: document.querySelector("#current-streak"),
  emptyState: document.querySelector("#empty-state"),
  exportButton: document.querySelector("#export-button"),
  heroCopy: document.querySelector("#hero-copy"),
  heroTitle: document.querySelector("#hero-title"),
  importButton: document.querySelector("#import-button"),
  importFile: document.querySelector("#import-file"),
  progressRing: document.querySelector("#progress-ring"),
  saveStatus: document.querySelector("#save-status"),
  sessionList: document.querySelector("#session-list"),
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
  const result = saveData(localStorage, appData);
  appData = result.data;
  elements.saveStatus.textContent = result.saved ? message : "Could not save locally";
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

function renderHero(now = new Date()) {
  if (!activeSession) {
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
  elements.button.textContent = "End fast";
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
    .filter((session) => session.endedAt)
    .sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt));

  elements.emptyState.hidden = completedSessions.length > 0;
  elements.sessionList.replaceChildren(
    ...completedSessions.slice(0, 10).map((session) => {
      const item = document.createElement("li");
      const complete = isComplete(session);
      item.className = "session-row";
      item.innerHTML = `
        <div>
          <span class="session-date">${formatDate(session.endedAt)}</span>
          <span class="session-times">${formatTime(session.startedAt)} to ${formatTime(session.endedAt)}</span>
        </div>
        <div>
          <span class="session-duration">${formatDuration(durationMs(session)).slice(0, 5)}</span>
          <span class="session-result ${complete ? "complete" : ""}">${complete ? "Goal reached" : "Fast ended early"}</span>
        </div>
      `;
      return item;
    }),
  );
}

function render() {
  renderHero();
  renderStats();
  renderHistory();
  renderTheme();
  renderSettings();
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

elements.button.addEventListener("click", () => {
  if (activeSession) {
    const index = sessions.findIndex((session) => session.id === activeSession.id);
    sessions[index] = endFast(activeSession);
    activeSession = null;
  } else {
    activeSession = startFast(new Date(), appData.settings.targetHours);
    sessions.push(activeSession);
  }

  persistData();
  render();
});

elements.clearButton.addEventListener("click", () => {
  const active = sessions.filter((session) => !session.endedAt);
  sessions.splice(0, sessions.length, ...active);
  persistData();
  render();
});

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

elements.importFile.addEventListener("change", async () => {
  const [file] = elements.importFile.files;
  if (!file) return;

  try {
    appData = mergeData(appData, parseBackup(await file.text()));
    sessions.splice(0, sessions.length, ...appData.sessions);
    activeSession = sessions.find((session) => !session.endedAt) ?? null;
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
setInterval(() => renderHero(), 1000);
