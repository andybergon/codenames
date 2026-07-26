const STORAGE_KEY = "codenames-developer-settings-v1";

export const DEFAULT_DEVELOPER_SETTINGS = Object.freeze({
  enabled: false,
});

export function normalizeDeveloperSettings(value = {}) {
  return {
    enabled: value?.enabled === true,
  };
}

export function loadDeveloperSettings() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw
      ? normalizeDeveloperSettings(JSON.parse(raw))
      : { ...DEFAULT_DEVELOPER_SETTINGS };
  } catch {
    return { ...DEFAULT_DEVELOPER_SETTINGS };
  }
}

export function saveDeveloperSettings(value) {
  const normalized = normalizeDeveloperSettings(value);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}
