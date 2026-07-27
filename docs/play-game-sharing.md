# Play game sharing

Play games use `?mode=play&g=<code>` from the first turn through post-game
review. The `g` value is a versioned, URL-safe export of the game state,
including every clue and guess already played. Opening an active link resumes
the shared phase in Play. Opening a completed link provides the full post-game
replay.

Board-only `?mode=train&b=<code>` links remain a separate Train format. They do
not include Play progress or history.

The export is local-first. Creating or opening a link does not upload the game
to Codenames or another service.

## Export contract

[`encodePlayGame`](../src/play/game-share.js) writes a compact JSON array as
UTF-8, then encodes those bytes with unpadded base64url. Version 3 contains:

1. Separate format, Play-rules, and settings-schema versions.
2. A stable game ID.
3. An explicit board code with all 25 words, roles, and table positions.
4. The original board seed.
5. The human side and role.
6. The ten Play bot settings.
7. The word-reuse policy and developer-mode provenance marker.
8. The winner and end reason for a completed game, or `null` while active.
9. Ordered clue, guess, and pass actions.

Each action stores its turn, side, and actor. Clue actions also include the
clue, number, and intended layout IDs. Guess actions need only a layout ID
because the board already owns the word and role. The decoder replays those
actions through the matching rules adapter to reconstruct revealed cards,
turn number, active side, current clue, and completion state.

[`encodeCompletedGame`](../src/play/game-share.js) remains the completion-only
wrapper used by the local archive. [`decodeCompletedGame`](../src/play/game-share.js)
rejects active links, while [`decodePlayGame`](../src/play/game-share.js)
accepts both active and completed links.

The three logical versions serve different compatibility needs:

- Format version changes when the envelope or action tuple shape changes.
- Rules version changes when identical actions could produce a different game.
- Settings version changes when setting positions or meanings change.

A raw deployment or commit identifier can be stored alongside future feedback
for debugging, but it is not a migration key. Compatibility depends on the
logical contract versions so routine builds do not create new file formats.

Developer-game links retain the `developerMode` provenance marker but omit raw
diagnostics. Starting state, settings, and ordered actions are sufficient to
reconstruct the game. The local completed-game archive adds versioned
diagnostics to the action that recorded them so exact score and decision traces
remain available on the originating device. Normal actions omit that slot.

The decoder preserves completed-game versions 1 and 2. Legacy six-setting
payloads receive the `late` missed-target timing default. Settings-schema
versions 0 and 1 default clue reuse to Never and retain the historical
Standard operative variation. Version 2 stores clue reuse and retains Standard
variation. Version 3 stores both clue reuse and the explicit `none` or
`standard` variation. Version 4 adds the explicit `guarded` or `direct`
operative concept ranking. Older settings versions retain historical direct
ranking. Format version 2 keeps its required final outcome.
Format version 3 permits a `null` outcome only when replay ends in an active
phase.

Shared exports are capped at 12,000 characters and 512 actions, leaving
headroom below Vercel's [14 KB URL limit](https://vercel.com/docs/errors/url_too_long)
for the origin, route, and query syntax. The smoke fixture also keeps an
ordinary completed-game code below 2,048 characters.

## Opening a shared game

An active link becomes the current resumable Play session in that browser
profile. Continuing the game updates local session storage normally. A
completed link is added to the completed-game archive instead.

The shared human seat is preserved. The recipient therefore sees and controls
the same role as the sender. The normal operative view still hides unrevealed
roles and intended targets, but the link itself contains the full private game
payload.

## Validation and compatibility

[`decodePlayGame`](../src/play/game-share.js) fails closed on unknown format
versions, malformed base64url or UTF-8, unsupported seats, invalid boards,
excessive actions, inconsistent action context, and a phase or outcome that
does not match replay.

The explicit board code avoids dependence on recent-word history or a future
random-board result. When a completed version 2 or 3 export recognizes the
envelope and actions but no longer supports the stored rules or settings
version, it creates a `history-only` review from the explicit action context,
board reveals, and outcome. Active links require the matching rules and
settings versions because an unsupported game cannot safely continue.

The decoded game retains the original raw settings and actions in
`shareMetadata`. The local archive preserves the original code for
history-only records, so reviewing or copying one does not silently rewrite it
with current defaults.

The code is compact, not encrypted. It includes the hidden key, intended
targets, player-written clues, settings, and complete history so far. Anyone
who receives the link can decode that private data. Raw developer scores and
decision traces remain local and are not copied into ordinary share links.

## Local archive

[`session-store.js`](../src/play/session-store.js) automatically stores up to
32 completed games under `codenames-play-completed-v1`. Opening a completed
shared link also adds it to the archive. Active shared links use the ordinary
`codenames-play-session-v1` resumable session instead.

Completed entries upsert by stable game ID, so undoing and re-completing a game
updates one record instead of creating a duplicate. The newest completed saved
session keeps the prominent finished-game review action. Older records appear
in a collapsed Past games section below Settings. The section can review,
copy, or remove an individual game and can clear the archive after
confirmation.

The archive permits up to 262,144 characters for one developer record and
keeps at most 3,000,000 encoded characters across its 32-entry count limit.
Developer records retain their full diagnostic traces locally. Copying an
archived game's link produces the compact replay-only form without those
traces.

The archive and active session remain in that browser profile. Clearing site
data or using another device removes access unless the link was copied
elsewhere.

## Future feedback storage

A server-backed feedback feature can keep a completed export as its immutable
game payload and store feedback separately with a generated record ID. That
avoids creating a second game schema and lets the server validate a submission
by decoding and replaying it.

The server boundary should require an explicit submit action. A useful record
would contain the completed-game code, free-form feedback, creation time, and
optional app build identifier. Player identity should remain absent unless a
separate product decision and consent flow require it.

Do not persist account IDs, IP addresses, semantic-explanation responses, or
live-game activity as part of this feature. The consent copy must disclose that
the completed export includes player-written clues. Treat contributed games as
diagnostic and calibration evidence, not replacement ground truth for the
frozen benchmark datasets.
