import { createHmac, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";

export const CALIBRATION_AUTH_COOKIE = "codenames_calibration_auth";
const MAX_NOTE_LENGTH = 2_000;
const MAX_GUESSES = 10;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
let tableReady = false;

export async function handleCalibrationSyncRequest({
  method,
  body,
  headers = {},
  databaseUrl,
  syncSecret,
  secureCookie = true,
  storeFactory = createNeonCalibrationStore,
}) {
  if (!databaseUrl || !syncSecret) {
    return jsonResult(503, {
      error: "Calibration database sync is not configured.",
      code: "not_configured",
    });
  }

  if (method === "POST" && body?.action === "authenticate") {
    if (!safeEqual(body?.key, syncSecret)) {
      return jsonResult(401, {
        error: "The calibration sync key is invalid.",
        code: "invalid_key",
      });
    }
    return {
      status: 204,
      headers: {
        "Cache-Control": "private, no-store",
        "Set-Cookie": buildAuthCookie(syncSecret, secureCookie),
      },
      body: null,
    };
  }

  if (!hasValidAuthCookie(headers.cookie, syncSecret)) {
    return jsonResult(401, {
      error: "Calibration database authentication is required.",
      code: "auth_required",
    });
  }

  const store = storeFactory(databaseUrl);
  try {
    if (method === "GET") {
      return jsonResult(200, { answers: await store.listAnswers() });
    }
    if (method === "PUT") {
      const record = validateRecord(body);
      await store.upsertAnswer(record);
      return jsonResult(200, { answer: record });
    }
    if (method === "DELETE") {
      const target = validateTarget(body);
      await store.deleteAnswer(target);
      return jsonResult(200, { deleted: target });
    }
    return {
      status: 405,
      headers: {
        Allow: "GET, POST, PUT, DELETE",
        "Cache-Control": "private, no-store",
      },
      body: { error: "Method not allowed." },
    };
  } catch (error) {
    if (error instanceof CalibrationValidationError) {
      return jsonResult(400, { error: error.message, code: "invalid_answer" });
    }
    return jsonResult(503, {
      error: "Calibration database sync is temporarily unavailable.",
      code: "database_unavailable",
    });
  }
}

export function createNeonCalibrationStore(databaseUrl) {
  const sql = neon(databaseUrl);
  return {
    async listAnswers() {
      await ensureTable(sql);
      const rows = await sql`
        SELECT round_id, task_id, guessed_layout_ids, judgment, note, updated_at
        FROM codenames_calibration_answers
        ORDER BY round_id, task_id
      `;
      return rows.map((row) => ({
        roundId: row.round_id,
        taskId: row.task_id,
        guessedLayoutIds: row.guessed_layout_ids,
        judgment: row.judgment,
        note: row.note,
        updatedAt: new Date(row.updated_at).toISOString(),
      }));
    },
    async upsertAnswer(record) {
      await ensureTable(sql);
      await sql`
        INSERT INTO codenames_calibration_answers (
          round_id,
          task_id,
          guessed_layout_ids,
          judgment,
          note,
          updated_at
        )
        VALUES (
          ${record.roundId},
          ${record.taskId},
          ${JSON.stringify(record.guessedLayoutIds)}::jsonb,
          ${record.judgment},
          ${record.note},
          ${record.updatedAt}
        )
        ON CONFLICT (round_id, task_id)
        DO UPDATE SET
          guessed_layout_ids = EXCLUDED.guessed_layout_ids,
          judgment = EXCLUDED.judgment,
          note = EXCLUDED.note,
          updated_at = EXCLUDED.updated_at
        WHERE codenames_calibration_answers.updated_at <= EXCLUDED.updated_at
      `;
    },
    async deleteAnswer({ roundId, taskId }) {
      await ensureTable(sql);
      await sql`
        DELETE FROM codenames_calibration_answers
        WHERE round_id = ${roundId} AND task_id = ${taskId}
      `;
    },
  };
}

async function ensureTable(sql) {
  if (tableReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS codenames_calibration_answers (
      round_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      guessed_layout_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      judgment TEXT,
      note TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (round_id, task_id),
      CHECK (jsonb_typeof(guessed_layout_ids) = 'array'),
      CHECK (judgment IS NULL OR judgment IN ('good', 'unsure', 'bad')),
      CHECK (char_length(note) <= 2000)
    )
  `;
  tableReady = true;
}

function validateRecord(value) {
  const { roundId, taskId } = validateTarget(value);
  const guessedLayoutIds = Array.isArray(value?.guessedLayoutIds)
    ? [...new Set(value.guessedLayoutIds)]
    : null;
  if (
    !guessedLayoutIds ||
    guessedLayoutIds.length > MAX_GUESSES ||
    guessedLayoutIds.some(
      (layoutId) =>
        !Number.isInteger(layoutId) || layoutId < 0 || layoutId > 24,
    )
  ) {
    throw new CalibrationValidationError("Calibration guesses are invalid.");
  }
  const judgment = value?.judgment ?? null;
  if (
    judgment !== null &&
    !["good", "unsure", "bad"].includes(judgment)
  ) {
    throw new CalibrationValidationError("Calibration judgment is invalid.");
  }
  const note = String(value?.note ?? "").trim();
  if (note.length > MAX_NOTE_LENGTH) {
    throw new CalibrationValidationError("Calibration note is too long.");
  }
  const updatedAt = new Date(value?.updatedAt);
  if (!Number.isFinite(updatedAt.getTime())) {
    throw new CalibrationValidationError("Calibration timestamp is invalid.");
  }
  return {
    roundId,
    taskId,
    guessedLayoutIds,
    judgment,
    note,
    updatedAt: updatedAt.toISOString(),
  };
}

function validateTarget(value) {
  return {
    roundId: validateIdentifier(value?.roundId, "round"),
    taskId: validateIdentifier(value?.taskId, "task"),
  };
}

function validateIdentifier(value, label) {
  const identifier = String(value ?? "");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(identifier)) {
    throw new CalibrationValidationError(
      `Calibration ${label} identifier is invalid.`,
    );
  }
  return identifier;
}

function buildAuthCookie(secret, secure) {
  return [
    `${CALIBRATION_AUTH_COOKIE}=${authCookieValue(secret)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/api/calibration",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

function hasValidAuthCookie(cookieHeader, secret) {
  const cookies = Object.fromEntries(
    String(cookieHeader ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => name && value),
  );
  return safeEqual(cookies[CALIBRATION_AUTH_COOKIE], authCookieValue(secret));
}

function authCookieValue(secret) {
  return createHmac("sha256", secret)
    .update("codenames-calibration-access-v1")
    .digest("base64url");
}

function safeEqual(received, expected) {
  const left = Buffer.from(String(received ?? ""));
  const right = Buffer.from(String(expected ?? ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function jsonResult(status, body) {
  return {
    status,
    headers: { "Cache-Control": "private, no-store" },
    body,
  };
}

class CalibrationValidationError extends Error {}
