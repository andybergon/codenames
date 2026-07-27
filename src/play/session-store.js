import { validateStoredGame } from "./game-state.js";
import {
  completedGameIdentity,
  decodeCompletedGame,
  encodeCompletedGame,
} from "./game-share.js";

const STORAGE_KEY = "codenames-play-session-v1";
const COMPLETED_STORAGE_KEY = "codenames-play-completed-v1";
const MAX_COMPLETED_GAMES = 32;
const MAX_COMPLETED_ARCHIVE_CHARACTERS = 3_000_000;
const MAX_COMPLETED_GAME_CHARACTERS = 262_144;

export function savePlaySession(game) {
  try {
    game.analyticsSequence =
      (Number.isSafeInteger(game.analyticsSequence)
        ? game.analyticsSequence
        : 0) + 1;
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

export function loadCompletedPlayGames() {
  try {
    const raw = window.localStorage.getItem(COMPLETED_STORAGE_KEY);
    const entries = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(entries)) {
      return [];
    }
    return entries
      .slice(0, MAX_COMPLETED_GAMES)
      .filter(
        (entry) =>
          entry &&
          typeof entry.id === "string" &&
          typeof entry.savedAt === "string" &&
          Number.isFinite(Date.parse(entry.savedAt)) &&
          typeof entry.code === "string",
      )
      .filter((entry) => {
        try {
          return (
            decodeArchivedCompletedGame(entry.code).gameId === entry.id
          );
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

export function archiveCompletedPlayGame(game, { sourceCode = null } = {}) {
  try {
    const code =
      sourceCode ??
      encodeCompletedGame(game, {
        includeDeveloperDiagnostics: true,
        maxLength: MAX_COMPLETED_GAME_CHARACTERS,
      });
    const id = completedGameIdentity(game);
    if (
      sourceCode &&
      decodeArchivedCompletedGame(sourceCode).gameId !== id
    ) {
      throw new Error("Completed-game source code has a different identity.");
    }
    const loaded = loadCompletedPlayGames();
    const existing = loaded.find((entry) => entry.id === id);
    const entries = loaded.filter((entry) => entry.id !== id);
    const now = new Date().toISOString();
    const candidates = [
      {
        id,
        savedAt: existing?.savedAt ?? now,
        updatedAt: now,
        code,
      },
      ...entries,
    ].slice(0, MAX_COMPLETED_GAMES);
    let characters = 0;
    const next = candidates.filter((entry) => {
      if (
        characters + entry.code.length >
        MAX_COMPLETED_ARCHIVE_CHARACTERS
      ) {
        return false;
      }
      characters += entry.code.length;
      return true;
    });
    window.localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return loadCompletedPlayGames();
  }
}

export function decodeArchivedCompletedGame(code) {
  return decodeCompletedGame(code, {
    maxLength: MAX_COMPLETED_GAME_CHARACTERS,
  });
}

export function removeCompletedPlayGame(id) {
  try {
    const next = loadCompletedPlayGames().filter((entry) => entry.id !== id);
    window.localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return loadCompletedPlayGames();
  }
}

export function clearCompletedPlayGames() {
  try {
    window.localStorage.removeItem(COMPLETED_STORAGE_KEY);
    return [];
  } catch {
    return loadCompletedPlayGames();
  }
}
