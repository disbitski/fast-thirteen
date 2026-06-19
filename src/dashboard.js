import { calculateAnalytics } from "./analytics.js";
import { mergeData, loadData, normalizeData, saveData } from "./storage.js";
import { applyTheme, loadTheme, saveTheme } from "./theme.js";

let appData = loadData(localStorage);
let selectedTheme = applyTheme(document.documentElement, loadTheme(localStorage));

const elements = {
  analyticsSource: document.querySelector("#analytics-source"),
  analyticsSummary: document.querySelector("#analytics-summary"),
  averageHours: document.querySelector("#average-hours"),
  bestFast: document.querySelector("#best-fast"),
  bestFastNote: document.querySelector("#best-fast-note"),
  completedFasts: document.querySelector("#completed-fasts"),
  completionRate: document.querySelector("#completion-rate"),
  currentStreak: document.querySelector("#current-streak"),
  endWindow: document.querySelector("#end-window"),
  goalDonut: document.querySelector("#goal-donut"),
  goalDonutLabel: document.querySelector("#goal-donut-label"),
  goalNote: document.querySelector("#goal-note"),
  longestStreak: document.querySelector("#longest-streak"),
  startWindow: document.querySelector("#start-window"),
  targetBadge: document.querySelector("#target-badge"),
  themeOptions: [...document.querySelectorAll("[data-theme-option]")],
  trendChart: document.querySelector("#trend-chart"),
  trendNote: document.querySelector("#trend-note"),
  weeklyBars: document.querySelector("#weekly-bars"),
  weeklyContext: document.querySelector("#weekly-context"),
  weeklyTotal: document.querySelector("#weekly-total"),
};

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatWeekday(value) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(value));
}

function plural(value, noun) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function renderTheme() {
  for (const option of elements.themeOptions) {
    option.setAttribute("aria-pressed", String(option.dataset.themeOption === selectedTheme));
  }
}

function renderBars(days, targetHours) {
  const maxHours = Math.max(targetHours, ...days.map((day) => day.totalHours), 1);

  elements.weeklyBars.replaceChildren(
    ...days.map((day) => {
      const item = document.createElement("div");
      const fill = document.createElement("span");
      const value = document.createElement("strong");
      const label = document.createElement("small");

      item.className = `bar-column ${day.totalHours >= targetHours ? "is-goal" : ""}`;
      fill.className = "bar-fill";
      fill.style.height = `${Math.max(4, (day.totalHours / maxHours) * 100)}%`;
      value.textContent = `${day.totalHours.toFixed(1)}h`;
      label.textContent = formatWeekday(day.date);

      item.title = `${formatDate(day.date)} · ${day.totalHours.toFixed(1)} hours`;
      item.append(fill, value, label);
      return item;
    }),
  );
}

function renderTrend(days, targetHours) {
  const width = 360;
  const height = 160;
  const padding = 18;
  const maxHours = Math.max(targetHours, ...days.map((day) => day.totalHours), 1);
  const points = days.map((day, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(1, days.length - 1);
    const y = height - padding - (day.totalHours / maxHours) * (height - padding * 2);
    return `${x},${y}`;
  });
  const targetY = height - padding - (targetHours / maxHours) * (height - padding * 2);

  elements.trendChart.replaceChildren();
  const ns = "http://www.w3.org/2000/svg";
  const target = document.createElementNS(ns, "line");
  target.setAttribute("x1", String(padding));
  target.setAttribute("x2", String(width - padding));
  target.setAttribute("y1", String(targetY));
  target.setAttribute("y2", String(targetY));
  target.setAttribute("class", "trend-target");

  const line = document.createElementNS(ns, "polyline");
  line.setAttribute("points", points.join(" "));
  line.setAttribute("class", "trend-line");

  elements.trendChart.append(target, line);
  for (const point of points) {
    const [x, y] = point.split(",");
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", x);
    circle.setAttribute("cy", y);
    circle.setAttribute("r", "4");
    circle.setAttribute("class", "trend-point");
    elements.trendChart.append(circle);
  }
}

function renderInsights(analytics) {
  const total7 = analytics.last7Days.reduce((total, day) => total + day.totalHours, 0);
  const completedDays = analytics.last7Days.filter((day) => day.totalHours > 0).length;
  const hitDays = analytics.last7Days.filter((day) => day.totalHours >= analytics.targetHours).length;

  elements.analyticsSummary.textContent =
    analytics.completedFasts === 0
      ? "Complete a fast and this page will start mapping your rhythm."
      : `${plural(analytics.completedFasts, "fast")} tracked · ${analytics.totalHours.toFixed(1)} total hours · ${analytics.completionRate}% goal hit rate.`;
  elements.weeklyTotal.textContent = `${total7.toFixed(1)}h`;
  elements.weeklyContext.textContent =
    completedDays === 0
      ? "No completed fasts in the last week yet."
      : `${plural(completedDays, "active day")} this week · ${plural(hitDays, "goal day")}.`;
  elements.completedFasts.textContent = analytics.completedFasts;
  elements.averageHours.textContent = analytics.averageHours.toFixed(1);
  elements.completionRate.textContent = `${analytics.completionRate}%`;
  elements.currentStreak.textContent = analytics.currentStreak;
  elements.targetBadge.textContent = `${analytics.targetHours}-hour goal`;
  elements.bestFast.textContent = `${analytics.bestHours.toFixed(1)}h`;
  elements.bestFastNote.textContent = analytics.bestSession
    ? `Ended ${formatDate(analytics.bestSession.endedAt)}.`
    : "No completed fast yet.";
  elements.startWindow.textContent = analytics.preferredStartTime;
  elements.endWindow.textContent = analytics.preferredEndTime;
  elements.longestStreak.textContent = plural(analytics.longestStreak, "day");
  elements.goalDonut.style.setProperty("--goal", `${analytics.completionRate * 3.6}deg`);
  elements.goalDonutLabel.textContent = `${analytics.completionRate}%`;
  elements.goalNote.textContent =
    analytics.completionRate >= 80
      ? "Strong consistency. Keep the routine boring in the best way."
      : "This will climb as more fasts reach the daily goal.";
  elements.trendNote.textContent =
    analytics.trendDelta > 0
      ? `Recent 3-day average is up ${analytics.trendDelta.toFixed(1)}h.`
      : analytics.trendDelta < 0
        ? `Recent 3-day average is down ${Math.abs(analytics.trendDelta).toFixed(1)}h.`
        : "Recent 3-day average is holding steady.";
}

function render() {
  const analytics = calculateAnalytics(appData.sessions, new Date(), appData.settings.targetHours);
  renderTheme();
  renderInsights(analytics);
  renderBars(analytics.last7Days, analytics.targetHours);
  renderTrend(analytics.last7Days, analytics.targetHours);
}

async function loadSharedData() {
  try {
    const response = await fetch("/api/data", { cache: "no-store" });
    if (!response.ok) return;
    const { data } = await response.json();

    if (data) {
      appData = appData.sessions.length > 0 ? mergeData(data, appData) : normalizeData(data);
      saveData(localStorage, appData);
      elements.analyticsSource.textContent = "Saved on this Mac";
      render();
    }
  } catch {
    elements.analyticsSource.textContent = "Reading this browser";
  }
}

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
