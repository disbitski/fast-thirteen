export const DEFAULT_THEME = "light";
export const THEMES = Object.freeze(["light", "cyan", "purple", "spacex"]);
export const THEME_STORAGE_KEY = "fast-thirteen-theme";

export function normalizeTheme(value) {
  return THEMES.includes(value) ? value : DEFAULT_THEME;
}

export function loadTheme(storage) {
  try {
    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(storage, theme) {
  const normalized = normalizeTheme(theme);

  try {
    storage.setItem(THEME_STORAGE_KEY, normalized);
  } catch {}

  return normalized;
}

export function applyTheme(root, theme) {
  const normalized = normalizeTheme(theme);
  root.dataset.theme = normalized;
  return normalized;
}
