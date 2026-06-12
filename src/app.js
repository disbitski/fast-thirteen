import {
  durationMs,
  endFast,
  formatDuration,
  isComplete,
  progress,
  startFast,
  summarize,
} from "./fasting.js";

const STORAGE_KEY = "fast-thirteen-sessions";
const sessions = loadSessions();
let activeSession = sessions.find((session) => !session.endedAt) ?? null;

const elements = {
  button: document.querySelector("#fast-button"),
  clearButton: document.querySelector("#clear-button"),
  completedFasts: document.querySelector("#completed-fasts"),
  currentStreak: document.querySelector("#current-streak"),
  emptyState: document.querySelector("#empty-state"),
  heroCopy: document.querySelector("#hero-copy"),
  heroTitle: document.querySelector("#hero-title"),
  progressRing: document.querySelector("#progress-ring"),
  sessionList: document.querySelector("#session-list"),
  statusLabel: document.querySelector("#status-label"),
  targetCopy: document.querySelector("#target-copy"),
  timer: document.querySelector("#timer"),
  timerLabel: document.querySelector("#timer-label"),
  totalHours: document.querySelector("#total-hours"),
};

function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveSessions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
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

function renderHero(now = new Date()) {
  if (!activeSession) {
    elements.statusLabel.textContent = "Ready when you are";
    elements.heroTitle.textContent = "Make space between meals.";
    elements.heroCopy.textContent =
      "One tap starts your fast. Come back when you are ready to eat.";
    elements.timer.textContent = "00:00:00";
    elements.timerLabel.textContent = "13 hour goal";
    elements.button.textContent = "Start fast";
    elements.button.classList.remove("is-active");
    elements.targetCopy.textContent = "Your target is 13 hours.";
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
  elements.heroTitle.textContent = complete ? "You made thirteen." : "Stay steady.";
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
}

elements.button.addEventListener("click", () => {
  if (activeSession) {
    const index = sessions.findIndex((session) => session.id === activeSession.id);
    sessions[index] = endFast(activeSession);
    activeSession = null;
  } else {
    activeSession = startFast();
    sessions.push(activeSession);
  }

  saveSessions();
  render();
});

elements.clearButton.addEventListener("click", () => {
  const active = sessions.filter((session) => !session.endedAt);
  sessions.splice(0, sessions.length, ...active);
  saveSessions();
  render();
});

render();
setInterval(() => renderHero(), 1000);
