import { normalizeTargetHours } from "./fasting.js";
import { loadData, mergeData, normalizeData, parseBackup, saveData, serializeBackup } from "./storage.js";
import { applyTheme, loadTheme, saveTheme } from "./theme.js";
import {
  cloudConnectionModel,
  cloudDataUrl,
  cloudRequestHeaders,
  loadCloudSyncKey,
  loadDataSource,
  saveCloudSyncKey,
  saveDataSource,
} from "./dataSource.js";

let appData = loadData(localStorage);
let dataSource = loadDataSource(localStorage, globalThis.location);
let cloudSyncKey = loadCloudSyncKey(localStorage);
let cloudConnectionState = "idle";
let selectedTheme = applyTheme(document.documentElement, loadTheme(localStorage));

const elements = {
  exportButton: document.querySelector("#export-button"),
  importButton: document.querySelector("#import-button"),
  importFile: document.querySelector("#import-file"),
  cloudKey: document.querySelector("#cloud-key"),
  cloudConnection: document.querySelector(".cloud-connection-control"),
  cloudStatusDetail: document.querySelector("#cloud-status-detail"),
  cloudStatusTitle: document.querySelector("#cloud-status-title"),
  cloudSource: document.querySelector("#cloud-source"),
  localSource: document.querySelector("#local-source"),
  refreshCloud: document.querySelector("#refresh-cloud"),
  saveCloudKey: document.querySelector("#save-cloud-key"),
  cloudOrigin: document.querySelector("#cloud-origin"),
  sourceDetail: document.querySelector("#source-detail"),
  status: document.querySelector("#settings-status"),
  targetHours: document.querySelector("#target-hours"),
  themeOptions: [...document.querySelectorAll("[data-theme-option]")],
};

function activeSession() {
  return appData.sessions.find((session) => !session.deletedAt && !session.endedAt) ?? null;
}

function completedFastCount() {
  return appData.sessions.filter((session) => !session.deletedAt && session.endedAt).length;
}

function persistLocal(message) {
  const result = saveData(localStorage, appData);
  appData = result.data;
  elements.status.textContent = result.saved ? message : "Could not save on this device";
  return result.saved;
}

async function saveToCloud() {
  const url = cloudDataUrl(dataSource);
  if (!url || !cloudSyncKey) return false;

  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: cloudRequestHeaders(cloudSyncKey, true),
      body: JSON.stringify(appData),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function loadFromCloud() {
  const url = cloudDataUrl(dataSource);
  if (!url || !cloudSyncKey) {
    cloudConnectionState = "idle";
    elements.status.textContent = "Save your private sync key before connecting to Cloudflare.";
    render();
    return false;
  }

  cloudConnectionState = "connecting";
  render();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: cloudRequestHeaders(cloudSyncKey),
    });
    if (!response.ok) {
      const error = new Error("Server unavailable");
      error.status = response.status;
      throw error;
    }
    const { data } = await response.json();

    if (data) {
      appData = appData.sessions.length > 0 ? mergeData(data, appData) : normalizeData(data);
      persistLocal("Cloud data loaded and kept on this device");
    } else {
      const saved = await saveToCloud();
      elements.status.textContent = saved
        ? "Your local history is now backed up in Cloudflare"
        : "Cloud storage is empty, but could not save the first backup";
    }
    cloudConnectionState = "connected";
    render();
    return true;
  } catch (error) {
    cloudConnectionState = error?.status === 401 ? "invalid-key" : "failed";
    elements.status.textContent = error?.status === 401
      ? "Cloudflare rejected this browser's private sync key. Your local data is unchanged."
      : "Cloudflare could not be reached. Your local data is unchanged.";
    render();
    return false;
  }
}

function render() {
  const hasActiveSession = Boolean(activeSession());
  elements.targetHours.value = appData.settings.targetHours;
  elements.targetHours.disabled = hasActiveSession;
  elements.cloudOrigin.textContent = dataSource.cloudOrigin;
  elements.cloudKey.value = cloudSyncKey;
  elements.localSource.setAttribute("aria-pressed", String(dataSource.mode === "local"));
  elements.cloudSource.setAttribute("aria-pressed", String(dataSource.mode === "cloud"));
  const connection = cloudConnectionModel({
    source: dataSource,
    syncKey: cloudSyncKey,
    state: cloudConnectionState,
    completedCount: completedFastCount(),
  });
  elements.cloudConnection.dataset.cloudStatus = connection.status;
  elements.cloudStatusTitle.textContent = connection.title;
  elements.cloudStatusDetail.textContent = connection.detail;
  elements.refreshCloud.disabled = !connection.canRefresh;
  elements.refreshCloud.textContent = connection.status === "connecting"
    ? "Refreshing..."
    : "Refresh from Cloudflare";
  elements.sourceDetail.textContent =
    dataSource.mode === "cloud"
      ? connection.detail
      : "This device is selected. Fasts stay in this browser until you choose Cloudflare sync again.";

  for (const option of elements.themeOptions) {
    option.setAttribute("aria-pressed", String(option.dataset.themeOption === selectedTheme));
  }
}

elements.targetHours.addEventListener("input", () => {
  appData.settings.targetHours = normalizeTargetHours(elements.targetHours.value);
  persistLocal("Goal saved on this device");
  if (dataSource.mode === "cloud") void saveToCloud();
});

elements.targetHours.addEventListener("change", render);

elements.localSource.addEventListener("click", () => {
  const result = saveDataSource(localStorage, { ...dataSource, mode: "local" }, globalThis.location);
  dataSource = result.source;
  cloudConnectionState = "idle";
  elements.status.textContent = result.saved
    ? "Using data stored on this device"
    : "Could not save the data-source preference";
  render();
});

elements.cloudSource.addEventListener("click", async () => {
  const result = saveDataSource(localStorage, { ...dataSource, mode: "cloud" }, globalThis.location);
  dataSource = result.source;
  cloudConnectionState = "idle";
  if (!result.saved) {
    elements.status.textContent = "Could not save the data-source preference";
    return;
  }
  elements.status.textContent = "Connecting to Cloudflare...";
  render();
  await loadFromCloud();
});

elements.saveCloudKey.addEventListener("click", async () => {
  const result = saveCloudSyncKey(localStorage, elements.cloudKey.value);
  cloudSyncKey = result.key;
  cloudConnectionState = "idle";
  elements.status.textContent = result.saved
    ? cloudSyncKey
      ? "Private sync key saved on this device"
      : "Private sync key removed from this device"
    : "Could not save the private sync key";
  if (result.saved && cloudSyncKey && dataSource.mode === "cloud") await loadFromCloud();
  else render();
});

elements.refreshCloud.addEventListener("click", () => {
  void loadFromCloud();
});

elements.exportButton.addEventListener("click", () => {
  const blob = new Blob([serializeBackup(appData)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `fast-thirteen-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  elements.status.textContent = "Backup exported";
});

elements.importButton.addEventListener("click", () => elements.importFile.click());

elements.importFile.addEventListener("change", async () => {
  const [file] = elements.importFile.files;
  if (!file) return;

  try {
    appData = mergeData(appData, parseBackup(await file.text()));
    persistLocal("Backup imported on this device");
    if (dataSource.mode === "cloud") void saveToCloud();
    render();
  } catch {
    elements.status.textContent = "Backup could not be imported";
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
    render();
  });
}

render();
if (dataSource.mode === "cloud" && cloudSyncKey) void loadFromCloud();
