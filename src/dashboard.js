import { ANALYTICS_RANGES, calculateAnalytics } from "./analytics.js";
import { mergeData, loadData, normalizeData, saveData } from "./storage.js";
import { applyTheme, loadTheme, saveTheme } from "./theme.js";

let appData = loadData(localStorage);
let selectedTheme = applyTheme(document.documentElement, loadTheme(localStorage));
let selectedRangeDays = ANALYTICS_RANGES[0].days;
const SHARED_DATA_URL = "api/data";
const SAMPLE_DATA_URL = "sample-data.json";

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
  rangeChartKicker: document.querySelector("#range-chart-kicker"),
  rangeOptions: [...document.querySelectorAll("[data-range-days]")],
  rangeTotalLabel: document.querySelector("#range-total-label"),
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

function plural(value, noun) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function bucketNoun(range) {
  return range.bucket === "day" ? "day" : range.bucket;
}

function renderTheme() {
  for (const option of elements.themeOptions) {
    option.setAttribute("aria-pressed", String(option.dataset.themeOption === selectedTheme));
  }
}

function renderRangePicker(range) {
  for (const option of elements.rangeOptions) {
    option.setAttribute("aria-pressed", String(Number(option.dataset.rangeDays) === range.days));
  }
}

function renderBars(buckets, targetHours) {
  const maxHours = Math.max(targetHours, ...buckets.map((bucket) => bucket.totalHours), 1);
  elements.weeklyBars.style.setProperty("--bar-count", String(buckets.length));

  elements.weeklyBars.replaceChildren(
    ...buckets.map((bucket) => {
      const item = document.createElement("div");
      const fill = document.createElement("span");
      const value = document.createElement("strong");
      const label = document.createElement("small");

      item.className = `bar-column ${bucket.totalHours >= targetHours ? "is-goal" : ""}`;
      fill.className = "bar-fill";
      fill.style.height = `${Math.max(4, (bucket.totalHours / maxHours) * 100)}%`;
      value.textContent = `${bucket.totalHours.toFixed(1)}h`;
      label.textContent = bucket.label;

      item.title = `${formatDate(bucket.date)} · ${bucket.totalHours.toFixed(1)} hours`;
      item.append(fill, value, label);
      return item;
    }),
  );
}

function renderTrend(buckets, targetHours) {
  const width = 360;
  const height = 160;
  const padding = 18;
  const maxHours = Math.max(targetHours, ...buckets.map((bucket) => bucket.totalHours), 1);
  const points = buckets.map((bucket, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(1, buckets.length - 1);
    const y = height - padding - (bucket.totalHours / maxHours) * (height - padding * 2);
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
  const completedBuckets = analytics.rangeBuckets.filter((bucket) => bucket.totalHours > 0).length;
  const hitBuckets = analytics.rangeBuckets.filter((bucket) => bucket.totalHours >= analytics.targetHours).length;

  elements.analyticsSummary.textContent =
    analytics.completedFasts === 0
      ? "Complete a fast in this range and this page will start mapping your rhythm."
      : `${plural(analytics.completedFasts, "fast")} in ${analytics.range.label.toLowerCase()} · ${analytics.totalHours.toFixed(1)} total hours · ${analytics.completionRate}% goal hit rate.`;
  elements.rangeTotalLabel.textContent = `${analytics.range.label} total`;
  elements.weeklyTotal.textContent = `${analytics.totalHours.toFixed(1)}h`;
  elements.weeklyContext.textContent =
    completedBuckets === 0
      ? `No completed fasts in ${analytics.range.label.toLowerCase()} yet.`
      : `${plural(completedBuckets, `active ${bucketNoun(analytics.range)}`)} · ${plural(hitBuckets, `goal ${bucketNoun(analytics.range)}`)}.`;
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
  elements.rangeChartKicker.textContent = analytics.range.label;
  elements.trendNote.textContent =
    analytics.trendDelta > 0
      ? `Recent ${analytics.range.bucket} average is up ${analytics.trendDelta.toFixed(1)}h.`
      : analytics.trendDelta < 0
        ? `Recent ${analytics.range.bucket} average is down ${Math.abs(analytics.trendDelta).toFixed(1)}h.`
        : `Recent ${analytics.range.bucket} average is holding steady.`;
}

function render() {
  const analytics = calculateAnalytics(appData.sessions, new Date(), appData.settings.targetHours, selectedRangeDays);
  renderTheme();
  renderRangePicker(analytics.range);
  renderInsights(analytics);
  renderBars(analytics.rangeBuckets, analytics.targetHours);
  renderTrend(analytics.rangeBuckets, analytics.targetHours);
}

async function loadSharedData() {
  try {
    const response = await fetch(SHARED_DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Shared data unavailable");
    const { data } = await response.json();

    if (data) {
      appData = appData.sessions.length > 0 ? mergeData(data, appData) : normalizeData(data);
      saveData(localStorage, appData);
      elements.analyticsSource.textContent = "Saved on this Mac";
      render();
    }
  } catch {
    await loadSampleData();
  }
}

async function loadSampleData() {
  if (appData.sessions.length > 0) {
    elements.analyticsSource.textContent = "Reading this browser";
    return;
  }

  try {
    const response = await fetch(SAMPLE_DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Sample data unavailable");

    appData = normalizeData(await response.json());
    saveData(localStorage, appData);
    elements.analyticsSource.textContent = "Viewing sample data";
    render();
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

for (const option of elements.rangeOptions) {
  option.addEventListener("click", () => {
    selectedRangeDays = Number(option.dataset.rangeDays);
    render();
  });
}

render();
loadSharedData();
