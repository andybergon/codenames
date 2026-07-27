import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { GAME_PHASE } from "../src/play/game-state.js";
import { decodePlayGame } from "../src/play/game-share.js";

export const PLAY_ANALYTICS_COOKIE = "codenames_play_analytics";
export const PLAY_ANALYTICS_ADMIN_COOKIE =
  "codenames_play_analytics_admin";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const MAX_SNAPSHOT_LENGTH = 12_000;
const MAX_FEEDBACK_NOTE_LENGTH = 2_000;
const MAX_REVIEW_NOTE_LENGTH = 5_000;
const MAX_LABELS = 20;
const MAX_LABEL_LENGTH = 40;
const FEEDBACK_CATEGORIES = new Set([
  "bug",
  "clue",
  "bot",
  "balance",
  "ux",
  "other",
]);
const REVIEW_STATUSES = new Set([
  "unreviewed",
  "reviewing",
  "actionable",
  "resolved",
  "ignored",
]);
const ACTION_TYPES = new Set([
  "clue-given",
  "card-guessed",
  "turn-passed",
]);
const readyDatabases = new Map();

export async function handlePlayAnalyticsRequest({
  method,
  body = {},
  headers = {},
  url = "/api/play-analytics",
  databaseUrl,
  reviewSecret,
  secureCookie = true,
  trustLocalClient = false,
  storeFactory = createNeonPlayAnalyticsStore,
}) {
  if (!databaseUrl) {
    return jsonResult(503, {
      error: "Play analytics is not configured.",
      code: "not_configured",
    });
  }

  const requestUrl = new URL(url, "http://analytics.local");
  const cookies = parseCookies(headers.cookie);
  const store = storeFactory(databaseUrl);

  try {
    if (method === "POST" && body?.action === "authenticate") {
      if (!reviewSecret || !safeEqual(body?.key, reviewSecret)) {
        return jsonResult(401, {
          error: "The analytics review key is invalid.",
          code: "invalid_key",
        });
      }
      return {
        status: 204,
        headers: {
          "Cache-Control": "private, no-store",
          "Set-Cookie": buildAdminCookie(reviewSecret, secureCookie),
        },
        body: null,
      };
    }

    if (method === "POST" && body?.action === "snapshot") {
      const existingParticipant = validParticipantKey(
        cookies[PLAY_ANALYTICS_COOKIE],
      );
      const participantKey = existingParticipant ?? randomUUID();
      const snapshot = validateSnapshot(body);
      const result = await store.upsertGame(participantKey, snapshot);
      return {
        ...jsonResult(200, {
          applied: result.applied,
          analyticsId: result.analyticsId,
          snapshotSequence: result.snapshotSequence,
        }),
        headers: {
          "Cache-Control": "private, no-store",
          ...(!existingParticipant
            ? {
                "Set-Cookie": buildParticipantCookie(
                  participantKey,
                  secureCookie,
                ),
              }
            : {}),
        },
      };
    }

    if (method === "POST" && body?.action === "feedback") {
      const participantKey = validParticipantKey(
        cookies[PLAY_ANALYTICS_COOKIE],
      );
      if (!participantKey) {
        return jsonResult(401, {
          error: "This game has not been linked to this browser.",
          code: "participant_required",
        });
      }
      const gameId = validateGameId(body.gameId);
      const gameRow = await store.getOwnedGame(participantKey, gameId);
      if (!gameRow) {
        return jsonResult(404, {
          error: "The stored game was not found.",
          code: "game_not_found",
        });
      }
      const game = decodePlayGame(gameRow.snapshotCode);
      const feedback = validateFeedback(body, game, gameRow.snapshotSequence);
      return jsonResult(201, {
        feedback: await store.insertFeedback(
          participantKey,
          gameId,
          feedback,
        ),
      });
    }

    if (
      !trustLocalClient &&
      (!reviewSecret ||
        !hasValidAdminCookie(
          cookies[PLAY_ANALYTICS_ADMIN_COOKIE],
          reviewSecret,
        ))
    ) {
      return jsonResult(401, {
        error: "Analytics review authentication is required.",
        code: "auth_required",
      });
    }

    if (method === "GET") {
      const analyticsId = requestUrl.searchParams.get("game");
      if (analyticsId) {
        const gameRow = await store.getGame(
          validateAnalyticsId(analyticsId),
        );
        if (!gameRow) {
          return jsonResult(404, {
            error: "The analytics game was not found.",
            code: "game_not_found",
          });
        }
        let game = null;
        try {
          game = decodePlayGame(gameRow.snapshotCode);
        } catch {}
        return jsonResult(200, { game: { ...gameRow, game } });
      }
      return jsonResult(200, {
        games: await store.listGames(validateFilters(requestUrl.searchParams)),
      });
    }

    if (method === "PATCH" && body?.action === "review") {
      const review = validateReview(body);
      return jsonResult(200, {
        review: await store.upsertReview(
          validateAnalyticsId(body.analyticsId),
          review,
        ),
      });
    }

    if (method === "POST" && body?.action === "annotation") {
      const analyticsId = validateAnalyticsId(body.analyticsId);
      const gameRow = await store.getGame(analyticsId);
      if (!gameRow) {
        return jsonResult(404, {
          error: "The analytics game was not found.",
          code: "game_not_found",
        });
      }
      const game = decodePlayGame(gameRow.snapshotCode);
      const annotation = {
        ...validateScope(body.scope, game),
        note: validateText(
          body.note,
          MAX_FEEDBACK_NOTE_LENGTH,
          "Annotation note",
          true,
        ),
      };
      return jsonResult(201, {
        annotation: await store.insertAnnotation(
          analyticsId,
          annotation,
        ),
      });
    }

    return {
      status: 405,
      headers: {
        Allow: "GET, POST, PATCH",
        "Cache-Control": "private, no-store",
      },
      body: { error: "Method not allowed." },
    };
  } catch (error) {
    if (error instanceof PlayAnalyticsValidationError) {
      return jsonResult(400, {
        error: error.message,
        code: "invalid_analytics_request",
      });
    }
    return jsonResult(503, {
      error: "Play analytics is temporarily unavailable.",
      code: "database_unavailable",
    });
  }
}

export function createNeonPlayAnalyticsStore(databaseUrl) {
  const sql = neon(databaseUrl);
  return {
    async upsertGame(participantKey, snapshot) {
      await ensureTables(sql, databaseUrl);
      const rows = await sql`
        WITH attempted AS (
          INSERT INTO analytics_games (
            participant_key,
            game_id,
            snapshot_sequence,
            snapshot_hash,
            snapshot_code,
            replay_status,
            developer_mode,
            phase,
            turn_number,
            action_count,
            language,
            word_set,
            winner,
            end_reason,
            format_version,
            rules_version,
            settings_version,
            last_seen_at,
            completed_at
          )
          VALUES (
            ${participantKey}::uuid,
            ${snapshot.gameId},
            ${snapshot.snapshotSequence},
            ${snapshot.snapshotHash},
            ${snapshot.snapshotCode},
            'valid',
            ${snapshot.developerMode},
            ${snapshot.phase},
            ${snapshot.turnNumber},
            ${snapshot.actionCount},
            ${snapshot.language},
            ${snapshot.wordSet},
            ${snapshot.winner},
            ${snapshot.endReason},
            ${snapshot.formatVersion},
            ${snapshot.rulesVersion},
            ${snapshot.settingsVersion},
            NOW(),
            ${snapshot.completed ? new Date().toISOString() : null}
          )
          ON CONFLICT (participant_key, game_id)
          DO UPDATE SET
            snapshot_sequence = EXCLUDED.snapshot_sequence,
            snapshot_hash = EXCLUDED.snapshot_hash,
            snapshot_code = EXCLUDED.snapshot_code,
            replay_status = EXCLUDED.replay_status,
            developer_mode = EXCLUDED.developer_mode,
            phase = EXCLUDED.phase,
            turn_number = EXCLUDED.turn_number,
            action_count = EXCLUDED.action_count,
            language = EXCLUDED.language,
            word_set = EXCLUDED.word_set,
            winner = EXCLUDED.winner,
            end_reason = EXCLUDED.end_reason,
            format_version = EXCLUDED.format_version,
            rules_version = EXCLUDED.rules_version,
            settings_version = EXCLUDED.settings_version,
            last_seen_at = NOW(),
            completed_at = EXCLUDED.completed_at
          WHERE
            analytics_games.snapshot_sequence < EXCLUDED.snapshot_sequence
            AND (
              analytics_games.snapshot_hash <> EXCLUDED.snapshot_hash
              OR analytics_games.developer_mode <> EXCLUDED.developer_mode
            )
          RETURNING id, snapshot_sequence
        )
        SELECT id, snapshot_sequence, TRUE AS applied
        FROM attempted
        UNION ALL
        SELECT id, snapshot_sequence, FALSE AS applied
        FROM analytics_games
        WHERE
          participant_key = ${participantKey}::uuid
          AND game_id = ${snapshot.gameId}
          AND NOT EXISTS (SELECT 1 FROM attempted)
        LIMIT 1
      `;
      return {
        applied: rows[0].applied,
        analyticsId: String(rows[0].id),
        snapshotSequence: Number(rows[0].snapshot_sequence),
      };
    },
    async getOwnedGame(participantKey, gameId) {
      await ensureTables(sql, databaseUrl);
      const rows = await sql`
        SELECT snapshot_code, snapshot_sequence
        FROM analytics_games
        WHERE participant_key = ${participantKey}::uuid AND game_id = ${gameId}
        LIMIT 1
      `;
      return rows[0] ? toOwnedGame(rows[0]) : null;
    },
    async insertFeedback(participantKey, gameId, feedback) {
      await ensureTables(sql, databaseUrl);
      const feedbackId = randomUUID();
      const rows = await sql`
        INSERT INTO analytics_player_feedback (
          id,
          participant_key,
          game_id,
          snapshot_sequence,
          scope_type,
          scope_key,
          turn_number,
          action_index,
          action_type,
          category,
          note
        )
        VALUES (
          ${feedbackId}::uuid,
          ${participantKey}::uuid,
          ${gameId},
          ${feedback.snapshotSequence},
          ${feedback.scopeType},
          ${feedback.scopeKey},
          ${feedback.turnNumber},
          ${feedback.actionIndex},
          ${feedback.actionType},
          ${feedback.category},
          ${feedback.note}
        )
        RETURNING *
      `;
      return toFeedback(rows[0]);
    },
    async listGames(filters) {
      await ensureTables(sql, databaseUrl);
      const rows = await sql`
        SELECT
          g.id,
          g.game_id,
          g.developer_mode,
          g.phase,
          g.turn_number,
          g.action_count,
          g.language,
          g.winner,
          g.end_reason,
          g.first_seen_at,
          g.last_seen_at,
          g.completed_at,
          COALESCE(r.review_status, 'unreviewed') AS review_status,
          COALESCE(r.labels, '[]'::jsonb) AS labels,
          (
            SELECT COUNT(*)::integer
            FROM analytics_player_feedback f
            WHERE
              f.participant_key = g.participant_key
              AND f.game_id = g.game_id
          ) AS feedback_count
        FROM analytics_games g
        LEFT JOIN analytics_game_reviews r ON r.analytics_game_id = g.id
        WHERE
          (${filters.developerMode}::boolean IS NULL
            OR g.developer_mode = ${filters.developerMode})
          AND (${filters.phase}::text IS NULL OR g.phase = ${filters.phase})
          AND (
            ${filters.reviewStatus}::text IS NULL
            OR COALESCE(r.review_status, 'unreviewed') =
              ${filters.reviewStatus}
          )
        ORDER BY g.last_seen_at DESC
        LIMIT ${filters.limit}
      `;
      return rows.map(toGameSummary);
    },
    async getGame(analyticsId) {
      await ensureTables(sql, databaseUrl);
      const rows = await sql`
        SELECT
          g.*,
          COALESCE(r.review_status, 'unreviewed') AS review_status,
          COALESCE(r.labels, '[]'::jsonb) AS labels,
          COALESCE(r.note, '') AS review_note,
          r.updated_at AS review_updated_at
        FROM analytics_games g
        LEFT JOIN analytics_game_reviews r ON r.analytics_game_id = g.id
        WHERE g.id = ${analyticsId}
        LIMIT 1
      `;
      if (!rows[0]) return null;
      const feedback = await sql`
        SELECT *
        FROM analytics_player_feedback
        WHERE
          participant_key = ${rows[0].participant_key}
          AND game_id = ${rows[0].game_id}
        ORDER BY created_at
      `;
      const annotations = await sql`
        SELECT *
        FROM analytics_review_annotations
        WHERE analytics_game_id = ${analyticsId}
        ORDER BY created_at
      `;
      return {
        ...toGameDetail(rows[0]),
        feedbackCount: feedback.length,
        feedback: feedback.map(toFeedback),
        annotations: annotations.map(toAnnotation),
      };
    },
    async upsertReview(analyticsId, review) {
      await ensureTables(sql, databaseUrl);
      const rows = await sql`
        INSERT INTO analytics_game_reviews (
          analytics_game_id,
          review_status,
          labels,
          note,
          updated_at
        )
        VALUES (
          ${analyticsId},
          ${review.reviewStatus},
          ${JSON.stringify(review.labels)}::jsonb,
          ${review.note},
          NOW()
        )
        ON CONFLICT (analytics_game_id)
        DO UPDATE SET
          review_status = EXCLUDED.review_status,
          labels = EXCLUDED.labels,
          note = EXCLUDED.note,
          updated_at = NOW()
        RETURNING *
      `;
      return toReview(rows[0]);
    },
    async insertAnnotation(analyticsId, annotation) {
      await ensureTables(sql, databaseUrl);
      const rows = await sql`
        INSERT INTO analytics_review_annotations (
          analytics_game_id,
          scope_type,
          scope_key,
          turn_number,
          action_index,
          action_type,
          note
        )
        VALUES (
          ${analyticsId},
          ${annotation.scopeType},
          ${annotation.scopeKey},
          ${annotation.turnNumber},
          ${annotation.actionIndex},
          ${annotation.actionType},
          ${annotation.note}
        )
        RETURNING *
      `;
      return toAnnotation(rows[0]);
    },
  };
}

async function ensureTables(sql, databaseUrl) {
  if (readyDatabases.has(databaseUrl)) {
    return readyDatabases.get(databaseUrl);
  }
  const ready = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS analytics_games (
        id BIGSERIAL PRIMARY KEY,
        participant_key UUID NOT NULL,
        game_id TEXT NOT NULL,
        snapshot_sequence BIGINT NOT NULL,
        snapshot_hash TEXT NOT NULL,
        snapshot_code TEXT NOT NULL,
        replay_status TEXT NOT NULL DEFAULT 'valid',
        developer_mode BOOLEAN NOT NULL DEFAULT FALSE,
        phase TEXT NOT NULL,
        turn_number INTEGER NOT NULL,
        action_count INTEGER NOT NULL,
        language TEXT NOT NULL,
        word_set TEXT,
        winner TEXT,
        end_reason TEXT,
        format_version INTEGER NOT NULL,
        rules_version INTEGER NOT NULL,
        settings_version INTEGER NOT NULL,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        UNIQUE (participant_key, game_id),
        CHECK (snapshot_sequence > 0),
        CHECK (char_length(game_id) <= 100),
        CHECK (char_length(snapshot_code) <= 12000),
        CHECK (phase IN ('awaiting-clue', 'awaiting-guess', 'complete'))
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS analytics_games_last_seen_idx
      ON analytics_games (last_seen_at DESC)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS analytics_games_cohort_phase_idx
      ON analytics_games (developer_mode, phase, last_seen_at DESC)
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS analytics_game_reviews (
        analytics_game_id BIGINT PRIMARY KEY
          REFERENCES analytics_games(id) ON DELETE CASCADE,
        review_status TEXT NOT NULL DEFAULT 'unreviewed',
        labels JSONB NOT NULL DEFAULT '[]'::jsonb,
        note TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (
          review_status IN (
            'unreviewed',
            'reviewing',
            'actionable',
            'resolved',
            'ignored'
          )
        ),
        CHECK (jsonb_typeof(labels) = 'array'),
        CHECK (char_length(note) <= 5000)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS analytics_review_annotations (
        id BIGSERIAL PRIMARY KEY,
        analytics_game_id BIGINT NOT NULL
          REFERENCES analytics_games(id) ON DELETE CASCADE,
        scope_type TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        turn_number INTEGER,
        action_index INTEGER,
        action_type TEXT,
        note TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (scope_type IN ('game', 'turn', 'action')),
        CHECK (char_length(note) <= 2000)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS analytics_player_feedback (
        id UUID PRIMARY KEY,
        participant_key UUID NOT NULL,
        game_id TEXT NOT NULL,
        snapshot_sequence BIGINT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        turn_number INTEGER,
        action_index INTEGER,
        action_type TEXT,
        category TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        FOREIGN KEY (participant_key, game_id)
          REFERENCES analytics_games(participant_key, game_id)
          ON DELETE CASCADE,
        CHECK (scope_type IN ('game', 'turn', 'action')),
        CHECK (category IN ('bug', 'clue', 'bot', 'balance', 'ux', 'other')),
        CHECK (char_length(note) <= 2000)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS analytics_player_feedback_game_idx
      ON analytics_player_feedback (participant_key, game_id, created_at)
    `;
  })();
  readyDatabases.set(databaseUrl, ready);
  try {
    await ready;
  } catch (error) {
    readyDatabases.delete(databaseUrl);
    throw error;
  }
}

function validateSnapshot(value) {
  const gameId = validateGameId(value.gameId);
  const snapshotSequence = Number(value.snapshotSequence);
  if (
    !Number.isSafeInteger(snapshotSequence) ||
    snapshotSequence < 1
  ) {
    throw new PlayAnalyticsValidationError(
      "Snapshot sequence is invalid.",
    );
  }
  const snapshotCode = String(value.snapshotCode ?? "");
  if (
    snapshotCode.length === 0 ||
    snapshotCode.length > MAX_SNAPSHOT_LENGTH
  ) {
    throw new PlayAnalyticsValidationError("Snapshot code is invalid.");
  }
  let game;
  try {
    game = decodePlayGame(snapshotCode);
  } catch {
    throw new PlayAnalyticsValidationError(
      "Snapshot actions cannot be replayed.",
    );
  }
  if (game.gameId !== gameId) {
    throw new PlayAnalyticsValidationError(
      "Snapshot identity does not match its game.",
    );
  }
  const completed = game.phase === GAME_PHASE.COMPLETE;
  if (
    !completed &&
    !game.history.some((event) => event.type === "turn-ended")
  ) {
    throw new PlayAnalyticsValidationError(
      "A game must complete one turn before analytics begins.",
    );
  }
  return {
    gameId,
    snapshotSequence,
    snapshotCode,
    snapshotHash: createHash("sha256").update(snapshotCode).digest("hex"),
    developerMode: game.developerMode === true,
    phase: game.phase,
    turnNumber: game.turnNumber,
    actionCount: game.history.filter((event) =>
      ACTION_TYPES.has(event.type),
    ).length,
    language: game.language,
    wordSet: game.wordSet ?? null,
    winner: game.winner ?? null,
    endReason: game.endReason ?? null,
    formatVersion: game.shareMetadata.formatVersion,
    rulesVersion: game.shareMetadata.rulesVersion,
    settingsVersion: game.shareMetadata.settingsVersion,
    completed,
  };
}

function validateFeedback(value, game, storedSequence) {
  const category = String(value.category ?? "");
  if (!FEEDBACK_CATEGORIES.has(category)) {
    throw new PlayAnalyticsValidationError(
      "Feedback category is invalid.",
    );
  }
  return {
    ...validateScope(value.scope, game),
    category,
    note: validateText(
      value.note,
      MAX_FEEDBACK_NOTE_LENGTH,
      "Feedback note",
    ),
    snapshotSequence: Math.min(
      Number.isSafeInteger(value.snapshotSequence)
        ? value.snapshotSequence
        : storedSequence,
      storedSequence,
    ),
  };
}

function validateScope(value, game) {
  const scopeType = String(value?.type ?? "game");
  const actions = game.history.filter((event) =>
    ACTION_TYPES.has(event.type),
  );
  if (scopeType === "game") {
    return {
      scopeType,
      scopeKey: "game",
      turnNumber: null,
      actionIndex: null,
      actionType: null,
    };
  }
  const turnNumber = Number(value?.turn);
  if (
    !Number.isInteger(turnNumber) ||
    !actions.some((event) => event.turn === turnNumber)
  ) {
    throw new PlayAnalyticsValidationError(
      "Feedback turn is invalid.",
    );
  }
  if (scopeType === "turn") {
    const turn = actions.find((event) => event.turn === turnNumber);
    return {
      scopeType,
      scopeKey: `turn:${turnNumber}:${turn.side}`,
      turnNumber,
      actionIndex: null,
      actionType: null,
    };
  }
  if (scopeType !== "action") {
    throw new PlayAnalyticsValidationError(
      "Feedback scope is invalid.",
    );
  }
  const actionIndex = Number(value?.actionIndex);
  const action = actions[actionIndex];
  if (
    !Number.isInteger(actionIndex) ||
    actionIndex < 0 ||
    !action ||
    action.turn !== turnNumber
  ) {
    throw new PlayAnalyticsValidationError(
      "Feedback action is invalid.",
    );
  }
  return {
    scopeType,
    scopeKey: actionScopeKey(action),
    turnNumber,
    actionIndex,
    actionType: action.type,
  };
}

function actionScopeKey(action) {
  const base = `${action.turn}:${action.side}:${action.type}`;
  if (action.type === "clue-given") return `${base}:${action.clue}`;
  if (action.type === "card-guessed") return `${base}:${action.layoutId}`;
  return `${base}:${action.actor}`;
}

function validateReview(value) {
  const reviewStatus = String(value.reviewStatus ?? "");
  if (!REVIEW_STATUSES.has(reviewStatus)) {
    throw new PlayAnalyticsValidationError(
      "Review status is invalid.",
    );
  }
  const labels = Array.isArray(value.labels)
    ? [...new Set(value.labels.map((label) => String(label).trim()))]
    : [];
  if (
    labels.length > MAX_LABELS ||
    labels.some(
      (label) => !label || label.length > MAX_LABEL_LENGTH,
    )
  ) {
    throw new PlayAnalyticsValidationError("Review labels are invalid.");
  }
  return {
    reviewStatus,
    labels,
    note: validateText(
      value.note,
      MAX_REVIEW_NOTE_LENGTH,
      "Review note",
    ),
  };
}

function validateFilters(params) {
  const cohort = params.get("cohort") ?? "player";
  const phase = params.get("phase");
  const reviewStatus = params.get("status");
  const limit = Math.min(Math.max(Number(params.get("limit")) || 100, 1), 200);
  if (!["player", "developer", "all"].includes(cohort)) {
    throw new PlayAnalyticsValidationError("Cohort filter is invalid.");
  }
  if (
    phase &&
    !["awaiting-clue", "awaiting-guess", "complete"].includes(phase)
  ) {
    throw new PlayAnalyticsValidationError("Phase filter is invalid.");
  }
  if (reviewStatus && !REVIEW_STATUSES.has(reviewStatus)) {
    throw new PlayAnalyticsValidationError(
      "Review-status filter is invalid.",
    );
  }
  return {
    developerMode:
      cohort === "all" ? null : cohort === "developer",
    phase: phase || null,
    reviewStatus: reviewStatus || null,
    limit,
  };
}

function validateAnalyticsId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new PlayAnalyticsValidationError(
      "Analytics game identifier is invalid.",
    );
  }
  return id;
}

function validateGameId(value) {
  const gameId = String(value ?? "");
  if (!/^g_[a-z0-9]{8,100}$/u.test(gameId)) {
    throw new PlayAnalyticsValidationError("Game identifier is invalid.");
  }
  return gameId;
}

function validateText(value, maxLength, label, required = false) {
  const text = String(value ?? "").trim();
  if ((required && !text) || text.length > maxLength) {
    throw new PlayAnalyticsValidationError(`${label} is invalid.`);
  }
  return text;
}

function validParticipantKey(value) {
  const participantKey = String(value ?? "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    participantKey,
  )
    ? participantKey
    : null;
}

function buildParticipantCookie(participantKey, secure) {
  return buildCookie(
    PLAY_ANALYTICS_COOKIE,
    participantKey,
    secure,
    "Lax",
  );
}

function buildAdminCookie(secret, secure) {
  return buildCookie(
    PLAY_ANALYTICS_ADMIN_COOKIE,
    adminCookieValue(secret),
    secure,
    "Strict",
  );
}

function buildCookie(name, value, secure, sameSite) {
  return [
    `${name}=${value}`,
    "HttpOnly",
    `SameSite=${sameSite}`,
    "Path=/api/play-analytics",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(
    String(cookieHeader ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => name && value),
  );
}

function hasValidAdminCookie(value, secret) {
  return safeEqual(value, adminCookieValue(secret));
}

function adminCookieValue(secret) {
  return createHmac("sha256", secret)
    .update("codenames-play-analytics-review-v1")
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

function toOwnedGame(row) {
  return {
    snapshotCode: row.snapshot_code,
    snapshotSequence: Number(row.snapshot_sequence),
  };
}

function toGameSummary(row) {
  return {
    analyticsId: String(row.id),
    gameId: row.game_id,
    developerMode: row.developer_mode,
    phase: row.phase,
    turnNumber: row.turn_number,
    actionCount: row.action_count,
    language: row.language,
    winner: row.winner,
    endReason: row.end_reason,
    firstSeenAt: new Date(row.first_seen_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    completedAt: row.completed_at
      ? new Date(row.completed_at).toISOString()
      : null,
    reviewStatus: row.review_status,
    labels: row.labels,
    feedbackCount: Number(row.feedback_count),
  };
}

function toGameDetail(row) {
  return {
    ...toGameSummary({ ...row, feedback_count: 0 }),
    snapshotSequence: Number(row.snapshot_sequence),
    snapshotCode: row.snapshot_code,
    replayStatus: row.replay_status,
    wordSet: row.word_set,
    formatVersion: row.format_version,
    rulesVersion: row.rules_version,
    settingsVersion: row.settings_version,
    reviewNote: row.review_note,
    reviewUpdatedAt: row.review_updated_at
      ? new Date(row.review_updated_at).toISOString()
      : null,
  };
}

function toFeedback(row) {
  return {
    id: String(row.id),
    gameId: row.game_id,
    snapshotSequence: Number(row.snapshot_sequence),
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    turnNumber: row.turn_number,
    actionIndex: row.action_index,
    actionType: row.action_type,
    category: row.category,
    note: row.note,
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : null,
  };
}

function toReview(row) {
  return {
    analyticsId: String(row.analytics_game_id),
    reviewStatus: row.review_status,
    labels: row.labels,
    note: row.note,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toAnnotation(row) {
  return {
    id: String(row.id),
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    turnNumber: row.turn_number,
    actionIndex: row.action_index,
    actionType: row.action_type,
    note: row.note,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

class PlayAnalyticsValidationError extends Error {}
