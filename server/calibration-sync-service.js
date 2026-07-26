import { createHmac, timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";

export const CALIBRATION_AUTH_COOKIE = "codenames_calibration_auth";
const MAX_NOTE_LENGTH = 2_000;
const MAX_GUESSES = 10;
const MAX_FUTURE_TIMESTAMP_MS = 5 * 60 * 1_000;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const readyDatabases = new Set();

export async function handleCalibrationSyncRequest({
  method,
  body,
  headers = {},
  databaseUrl,
  syncSecret,
  secureCookie = true,
  trustLocalClient = false,
  storeFactory = createNeonCalibrationStore,
}) {
  if (!databaseUrl || (!syncSecret && !trustLocalClient)) {
    return jsonResult(503, {
      error: "Calibration database sync is not configured.",
      code: "not_configured",
    });
  }

  if (!trustLocalClient && method === "POST" && body?.action === "authenticate") {
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

  if (!trustLocalClient && !hasValidAuthCookie(headers.cookie, syncSecret)) {
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
      const result = await store.upsertAnswer(record);
      return result.applied
        ? jsonResult(200, { answer: result.record })
        : jsonResult(409, {
            error: "A newer calibration answer is already stored.",
            code: "stale_write",
            answer: result.record,
          });
    }
    if (method === "DELETE") {
      const target = validateDeletion(body);
      const result = await store.deleteAnswer(target);
      return result.applied
        ? jsonResult(200, { answer: result.record })
        : jsonResult(409, {
            error: "A newer calibration answer is already stored.",
            code: "stale_write",
            answer: result.record,
          });
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
      await ensureTable(sql, databaseUrl);
      const rows = await sql`
        SELECT
          round_id,
          task_id,
          guessed_layout_ids,
          judgment,
          note,
          updated_at,
          deleted_at
        FROM codenames_calibration_answers
        ORDER BY round_id, task_id
      `;
      return rows.map(toCalibrationRecord);
    },
    async upsertAnswer(record) {
      await ensureTable(sql, databaseUrl);
      const rows = await sql`
        INSERT INTO codenames_calibration_answers (
          round_id,
          task_id,
          guessed_layout_ids,
          judgment,
          note,
          updated_at,
          deleted_at
        )
        VALUES (
          ${record.roundId},
          ${record.taskId},
          ${JSON.stringify(record.guessedLayoutIds)}::jsonb,
          ${record.judgment},
          ${record.note},
          ${record.updatedAt},
          NULL
        )
        ON CONFLICT (round_id, task_id)
        DO UPDATE SET
          guessed_layout_ids = EXCLUDED.guessed_layout_ids,
          judgment = EXCLUDED.judgment,
          note = EXCLUDED.note,
          updated_at = EXCLUDED.updated_at,
          deleted_at = NULL
        WHERE
          codenames_calibration_answers.updated_at < EXCLUDED.updated_at
          OR (
            codenames_calibration_answers.updated_at = EXCLUDED.updated_at
            AND codenames_calibration_answers.deleted_at IS NULL
          )
        RETURNING
          round_id,
          task_id,
          guessed_layout_ids,
          judgment,
          note,
          updated_at,
          deleted_at
      `;
      return writeResult(sql, rows, record);
    },
    async deleteAnswer({ roundId, taskId, updatedAt }) {
      await ensureTable(sql, databaseUrl);
      const rows = await sql`
        INSERT INTO codenames_calibration_answers (
          round_id,
          task_id,
          guessed_layout_ids,
          judgment,
          note,
          updated_at,
          deleted_at
        )
        VALUES (
          ${roundId},
          ${taskId},
          '[]'::jsonb,
          NULL,
          '',
          ${updatedAt},
          ${updatedAt}
        )
        ON CONFLICT (round_id, task_id)
        DO UPDATE SET
          guessed_layout_ids = '[]'::jsonb,
          judgment = NULL,
          note = '',
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at
        WHERE codenames_calibration_answers.updated_at <= EXCLUDED.updated_at
        RETURNING
          round_id,
          task_id,
          guessed_layout_ids,
          judgment,
          note,
          updated_at,
          deleted_at
      `;
      return writeResult(sql, rows, { roundId, taskId });
    },
  };
}

async function ensureTable(sql, databaseUrl) {
  if (readyDatabases.has(databaseUrl)) return;
  await sql`
    CREATE TABLE IF NOT EXISTS codenames_calibration_answers (
      round_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      guessed_layout_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      judgment TEXT,
      note TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL,
      deleted_at TIMESTAMPTZ,
      PRIMARY KEY (round_id, task_id),
      CHECK (jsonb_typeof(guessed_layout_ids) = 'array'),
      CHECK (judgment IS NULL OR judgment IN ('good', 'unsure', 'bad')),
      CHECK (char_length(note) <= 2000)
    )
  `;
  await sql`
    ALTER TABLE codenames_calibration_answers
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
  `;
  readyDatabases.add(databaseUrl);
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
  const updatedAt = validateTimestamp(value?.updatedAt);
  return {
    roundId,
    taskId,
    guessedLayoutIds,
    judgment,
    note,
    updatedAt,
  };
}

function validateDeletion(value) {
  return {
    ...validateTarget(value),
    updatedAt: validateTimestamp(value?.updatedAt),
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

function validateTimestamp(value) {
  const updatedAt = new Date(value);
  if (
    !Number.isFinite(updatedAt.getTime()) ||
    updatedAt.getTime() > Date.now() + MAX_FUTURE_TIMESTAMP_MS
  ) {
    throw new CalibrationValidationError("Calibration timestamp is invalid.");
  }
  return updatedAt.toISOString();
}

async function writeResult(sql, rows, { roundId, taskId }) {
  if (rows.length > 0) {
    return { applied: true, record: toCalibrationRecord(rows[0]) };
  }
  const current = await sql`
    SELECT
      round_id,
      task_id,
      guessed_layout_ids,
      judgment,
      note,
      updated_at,
      deleted_at
    FROM codenames_calibration_answers
    WHERE round_id = ${roundId} AND task_id = ${taskId}
    LIMIT 1
  `;
  return {
    applied: false,
    record: current[0] ? toCalibrationRecord(current[0]) : null,
  };
}

function toCalibrationRecord(row) {
  return {
    roundId: row.round_id,
    taskId: row.task_id,
    guessedLayoutIds: row.guessed_layout_ids,
    judgment: row.judgment,
    note: row.note,
    updatedAt: new Date(row.updated_at).toISOString(),
    deletedAt: row.deleted_at
      ? new Date(row.deleted_at).toISOString()
      : null,
  };
}

export function isLoopbackAddress(value) {
  const address = String(value ?? "").toLowerCase();
  return (
    address === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(address) ||
    /^::ffff:127(?:\.\d{1,3}){3}$/.test(address)
  );
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
