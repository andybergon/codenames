# Play analytics

Play analytics stores replayable game snapshots instead of per-action rows. The
browser sends the same compact, versioned code used by Play sharing, and the
server replays it before accepting the write.

## Collection boundary

- Only games created locally are eligible. Shared active and completed games
  retain `origin: "shared"` through saved-session restoration and never upload.
- Legacy sessions without provenance normalize to `origin: "unknown"` and do
  not upload.
- A locally created game becomes eligible after its first completed turn, or
  immediately if it ends during that first turn.
- Eligible dirty games flush at turn boundaries, completion, explicit
  undo/forward restoration, a 60-second active interval, and `pagehide`.
- Completion flushes immediately. Failed writes retry with bounded exponential
  backoff and never block gameplay.
- Developer games upload through the same path with `developer_mode = true`.
  Automatic snapshots omit local Developer diagnostics, keeping the request
  within the normal 12,000-character share-code limit.
- Snapshots accepted through the loopback Vite API receive
  `local_mode = true`. This marks development runs without conflating them
  with Developer-mode games. Production clients cannot set this marker.

Each saved session owns an incrementing `analyticsSequence`. It advances on
every local persistence operation, including undo and forward restoration, so
the sequence never depends on action count or phase. The server scopes the
upsert key to `(participant_key, game_id)` and updates only when the incoming
sequence is newer and the canonical snapshot or cohort marker materially
changed.

## Cookies and privacy

The first accepted snapshot creates the random
`codenames_play_analytics` cookie. It is HTTP-only, first-party,
`SameSite=Lax`, limited to `/api/play-analytics`, and retained for one year.
The cookie value identifies one browser for row ownership and idempotent
updates. Raw IP addresses are not stored in analytics tables.

Snapshots contain the hidden key, intended targets, settings, player-written
clues, and full action history. The initial collection boundary has no consent
banner. Informed consent, stop-sharing, deletion, and retention controls remain
a high-priority product requirement in `TODO.md`.

## Database model

All tables use the `analytics_` prefix:

- `analytics_games`: one row per participant and locally created game. It owns
  the compact snapshot plus the small set of indexed review fields, including
  independent Developer and loopback-local cohort markers.
- `analytics_game_reviews`: one optional internal status and label set per
  stored game. The legacy game-note column remains readable for compatibility.
- `analytics_review_annotations`: internal notes scoped to a game, turn, or
  action.
- `analytics_player_feedback`: player-authored category and bounded note,
  scoped to a validated game, turn, or action. Feedback inserts never rewrite
  the game row.

`first_seen_at` and `last_seen_at` are server receipt times. An unfinished row
means the latest eligible snapshot was received without a later completion,
not that the browser emitted a reliable quit event.

## Review UI

Open `?mode=analytics` to review stored games. The default cohort excludes
Developer and loopback-local games. Developer and Local remain independent,
overlapping filters, so a local Developer game appears in either cohort.
Filters also cover phase and review status. The game list uses opaque cursor
pagination ordered by `(last_seen_at, id)` and loads 40 rows at a time. Each
entry shows its last-seen time, game ID, cohort, phase, action count, and
current turn; selecting it opens the board directly.

A game detail shows its board, replayable timeline, player feedback, and one
bottom Review panel in that order. On wide screens, the timeline sits to the
right of the board. The game chooser and timeline can be collapsed
independently. The board and grouped timeline reuse Play's post-game
presentation. Selecting a clue, guess, or pass reconstructs the board
immediately after that action. The panel combines status and labels with an
optional note scoped to the whole game, a turn, or an action. Unreviewed games
remain visually neutral in the initial list because reviewing every game is
not an expected workflow.

Production review authentication uses an HTTP-only
`codenames_play_analytics_admin` cookie. Set `ANALYTICS_REVIEW_SECRET` for a
dedicated key. When it is absent, the API reuses `CALIBRATION_SYNC_SECRET`.
Loopback Vite clients bypass the key for local development and stamp accepted
snapshots as Local.

The list query fetches one extra row to detect the next page. Supporting
indexes end in `(last_seen_at DESC, id DESC)`, so paging does not require a
large offset scan. Collection remains one monotonic upsert per participant and
game, with feedback and review writes isolated in their own tables.

## Verification

`npm run check` covers API validation, participant-scoped upserts, replay
rejection, retry coalescing, `pagehide`, provenance, feedback scope validation,
and saved-session compatibility. `npm run test:ui` covers player feedback and
the review UI at 390x844, 768x1024, and 1440x900.
