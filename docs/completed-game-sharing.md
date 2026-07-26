# Completed game sharing

Completed Play games use `?mode=play&g=<code>`. The `g` value is a
versioned, URL-safe export of the whole game, so a player can send one link and
the recipient can replay every clue and guess in Post-game analysis.

The export is local-first. Creating or opening a link does not upload the game
to Codenames or another service.

## Export contract

[`encodeCompletedGame`](../src/play/game-share.js) writes a compact JSON array
as UTF-8, then encodes those bytes with unpadded base64url. Version 2 contains:

1. Separate format, Play-rules, and settings-schema versions.
2. A stable game ID.
3. An explicit board code with all 25 words, roles, and table positions.
4. The original board seed.
5. The human side and role.
6. The seven Play bot settings.
7. The word-reuse policy and developer-mode provenance marker.
8. The final winner and end reason.
9. Ordered clue, guess, and pass actions.

Each action stores its turn, side, and actor. Clue actions also include the
clue, number, and intended layout IDs. Guess actions need only a layout ID
because the board already owns the word and role. The decoder normally rebuilds
turn endings and validates the stored outcome through the matching rules
adapter.

The three logical versions serve different compatibility needs:

- Format version changes when the envelope or action tuple shape changes.
- Rules version changes when identical actions could produce a different game.
- Settings version changes when setting positions or meanings change.

A raw deployment or commit identifier can be stored alongside future feedback
for debugging, but it is not a migration key. Compatibility must depend on the
logical contract versions so routine builds do not create new file formats.

Developer-game links retain the `developerMode` provenance marker but omit raw
diagnostics. Starting state, settings, and ordered actions are sufficient to
reconstruct the completed game. The local archive adds versioned diagnostics
to the action that recorded them so exact score and decision traces remain
available on the originating device. Normal actions omit that slot.

The decoder preserves all existing version 1 shapes. Legacy six-setting
payloads receive the `late` missed-target timing default. The setting is never
inferred from history.

This shape keeps ordinary games well below common link limits. The smoke
fixture requires a completed game code to stay below 2,048 characters, while
the decoder permits up to 16,384 characters and 512 actions for unusual games.

## Validation and compatibility

[`decodeCompletedGame`](../src/play/game-share.js) fails closed on unknown
format versions, malformed base64url or UTF-8, unsupported seats, invalid
boards, excessive actions, inconsistent action context, and outcomes that do
not match replay.

The explicit board code avoids dependence on recent-word history or a future
random-board result. When version 2 recognizes the envelope and actions but no
longer supports the stored rules or settings version, it creates a
`history-only` review from the explicit turn, side, actor, board reveal, and
outcome data. Old analysis may be unavailable, but the action log remains
reviewable and copyable.

The decoded game retains the original raw settings and actions in
`shareMetadata`. The local archive preserves the original code for
history-only records, so reviewing or copying one does not silently rewrite it
with current defaults. Keep the version 1 decoder and version 2 fallback
compatible when Play rules, word assets, or storage schemas change.

The code is compact, not encrypted. It includes the hidden key, intended
targets, player-written clues, settings, and complete history. Anyone who
receives the link can see all of that data. Raw developer scores and decision
traces remain local and are not copied into ordinary share links.

## Local archive

[`session-store.js`](../src/play/session-store.js) automatically stores up to
32 completed games under `codenames-play-completed-v1`. Opening a shared link
also adds it to the archive. Entries upsert by stable game ID, so undoing and
re-completing a game updates one record instead of creating a duplicate.

The newest completed saved session keeps the prominent finished-game review
action. Older records appear in a collapsed Past games section below Settings.
When an active game replaces the completed save, that previous game joins Past
games so it remains accessible. The section can review, copy, or remove an
individual game and can clear the archive after confirmation.

The archive permits up to 262,144 characters for one developer record and
keeps at most 3,000,000 encoded characters across its 32-entry count limit.
Developer records retain their full diagnostic traces locally. Copying an
archived game's link produces the compact replay-only form without those
traces.

The archive remains in that browser profile. Clearing site data or using
another device removes access unless the link was copied elsewhere.

## Future feedback storage

A server-backed feedback feature can keep this export as its immutable game
payload and store feedback separately with a generated record ID. That avoids
creating a second game schema and lets the server validate a submission by
decoding and replaying it.

The server boundary should require an explicit submit action. A useful record
would contain the completed-game code, free-form feedback, creation time, and
optional app build identifier. Player identity should remain absent unless a
separate product decision and consent flow require it.

Do not persist account IDs, IP addresses, semantic-explanation responses, or
live-game activity as part of this feature. The consent copy must disclose that
the completed export includes player-written clues. Treat contributed games as
diagnostic and calibration evidence, not replacement ground truth for the
frozen benchmark datasets.
