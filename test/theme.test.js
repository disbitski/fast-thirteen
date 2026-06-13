import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTheme,
  DEFAULT_THEME,
  loadTheme,
  normalizeTheme,
  saveTheme,
  THEME_STORAGE_KEY,
} from "../src/theme.js";

function memoryStorage(initialValue = null) {
  let value = initialValue;

  return {
    getItem(key) {
      assert.equal(key, THEME_STORAGE_KEY);
      return value;
    },
    setItem(key, nextValue) {
      assert.equal(key, THEME_STORAGE_KEY);
      value = nextValue;
    },
  };
}

test("normalizes unknown themes to light", () => {
  assert.equal(normalizeTheme("cyan"), "cyan");
  assert.equal(normalizeTheme("purple"), "purple");
  assert.equal(normalizeTheme("neon-green"), DEFAULT_THEME);
  assert.equal(normalizeTheme(null), DEFAULT_THEME);
});

test("loads and saves a valid theme", () => {
  const storage = memoryStorage();

  assert.equal(loadTheme(storage), DEFAULT_THEME);
  assert.equal(saveTheme(storage, "purple"), "purple");
  assert.equal(loadTheme(storage), "purple");
});

test("falls back safely when browser storage is unavailable", () => {
  const brokenStorage = {
    getItem() {
      throw new Error("Storage unavailable");
    },
    setItem() {
      throw new Error("Storage unavailable");
    },
  };

  assert.equal(loadTheme(brokenStorage), DEFAULT_THEME);
  assert.equal(saveTheme(brokenStorage, "cyan"), "cyan");
});

test("applies a normalized theme to the page root", () => {
  const root = { dataset: {} };

  assert.equal(applyTheme(root, "purple"), "purple");
  assert.equal(root.dataset.theme, "purple");
  assert.equal(applyTheme(root, "unknown"), DEFAULT_THEME);
  assert.equal(root.dataset.theme, DEFAULT_THEME);
});
