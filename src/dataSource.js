export const DATA_SOURCE_STORAGE_KEY = "fast-thirteen-data-source";
export const CLOUD_SYNC_KEY_STORAGE_KEY = "fast-thirteen-cloud-sync-key";
export const CLOUDFLARE_API_ORIGIN = "https://fast-api.thedavedev.com";
export const DATA_SOURCE_MODES = ["local", "cloud"];

function normalizedOrigin(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isGitHubPagesLocation(location) {
  return location?.hostname?.endsWith(".github.io") ?? false;
}

export function defaultDataSource(location = globalThis.location) {
  const isGitHubPages = isGitHubPagesLocation(location);

  return {
    mode: isGitHubPages ? "local" : "cloud",
    cloudOrigin: CLOUDFLARE_API_ORIGIN,
  };
}

export function normalizeDataSource(value, location = globalThis.location) {
  const fallback = defaultDataSource(location);
  const storedMode = value?.mode === "server" ? "cloud" : value?.mode;
  const mode = DATA_SOURCE_MODES.includes(storedMode) ? storedMode : fallback.mode;

  return {
    mode,
    cloudOrigin: normalizedOrigin(value?.cloudOrigin) ?? fallback.cloudOrigin,
  };
}

export function loadDataSource(storage, location = globalThis.location) {
  try {
    const stored = storage.getItem(DATA_SOURCE_STORAGE_KEY);
    if (stored) return normalizeDataSource(JSON.parse(stored), location);
  } catch {}

  return defaultDataSource(location);
}

export function saveDataSource(storage, value, location = globalThis.location) {
  const source = normalizeDataSource(value, location);

  try {
    storage.setItem(DATA_SOURCE_STORAGE_KEY, JSON.stringify(source));
    return { source, saved: true };
  } catch {
    return { source, saved: false };
  }
}

export function cloudDataUrl(source) {
  if (source?.mode !== "cloud") return null;

  try {
    return new URL("/v1/data", source.cloudOrigin).toString();
  } catch {
    return null;
  }
}

export function loadCloudSyncKey(storage) {
  try {
    return storage.getItem(CLOUD_SYNC_KEY_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveCloudSyncKey(storage, value) {
  const key = typeof value === "string" ? value.trim() : "";
  try {
    if (key) storage.setItem(CLOUD_SYNC_KEY_STORAGE_KEY, key);
    else storage.removeItem(CLOUD_SYNC_KEY_STORAGE_KEY);
    return { key, saved: true };
  } catch {
    return { key, saved: false };
  }
}

export function cloudRequestHeaders(syncKey, includeContentType = false) {
  const headers = { Authorization: `Bearer ${syncKey}` };
  if (includeContentType) headers["Content-Type"] = "application/json";
  return headers;
}

export function cloudConnectionModel({
  source,
  syncKey,
  state = "idle",
  completedCount = 0,
} = {}) {
  if (source?.mode !== "cloud") {
    return {
      canRefresh: false,
      detail: "Fasting history stays in this browser until Cloudflare sync is selected.",
      status: "local",
      title: "This device only",
    };
  }

  if (!syncKey) {
    return {
      canRefresh: false,
      detail: "Cloudflare is selected, but this browser still needs the private sync key.",
      status: "key-needed",
      title: "Cloudflare not connected",
    };
  }

  if (state === "connecting") {
    return {
      canRefresh: false,
      detail: "Reading the latest fasting history without replacing this browser's offline copy.",
      status: "connecting",
      title: "Connecting to Cloudflare",
    };
  }

  if (state === "connected") {
    return {
      canRefresh: true,
      detail: `${completedCount} completed ${completedCount === 1 ? "fast" : "fasts"} available on this device.`,
      status: "connected",
      title: "Connected to Cloudflare",
    };
  }

  if (state === "invalid-key") {
    return {
      canRefresh: true,
      detail: "Replace the saved private sync key before refreshing again.",
      status: "invalid-key",
      title: "Cloudflare key rejected",
    };
  }

  if (state === "failed") {
    return {
      canRefresh: true,
      detail: "Your offline history is safe. Retry when this device is online.",
      status: "failed",
      title: "Cloudflare unavailable",
    };
  }

  return {
    canRefresh: true,
    detail: "A private sync key is saved. Refresh to verify the shared history on this browser.",
    status: "ready",
    title: "Cloudflare ready to connect",
  };
}
