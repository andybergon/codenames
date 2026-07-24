import { validateStoredGame } from "./game-state.js";

const STORAGE_KEY = "codenames-play-session-v1";

export function savePlaySession(game) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
    return true;
  } catch {
    return false;
  }
}

export function loadPlaySession() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? validateStoredGame(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function clearPlaySession() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
