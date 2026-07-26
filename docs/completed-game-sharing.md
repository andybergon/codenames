# Completed game sharing

Completed Play games use `?mode=play&g=<code>`. The `g` value is a
versioned, URL-safe export of the whole game, so a player can send one link and
the recipient can replay every clue and guess in Post-game analysis.

The export is local-first. Creating or opening a link does not upload the game
to Codenames or another service.

## Export contract

[`encodeCompletedGame`](../src/play/game-share.js) writes a compact JSON array
as UTF-8, then encodes those bytes with unpadded base64url. Version 1 contains:

1. Format version and stable game ID.
2. An explicit board code with all 25 words, roles, and table positions.
3. The original board seed.
4. The human side and role.
5. The seven Play bot settings.
6. The word-reuse policy and developer-mode provenance marker.
7. Ordered clue, guess, and pass actions.

Clue actions include the clue, number, and intended layout IDs. Guess actions
need only a layout ID because the board already owns the word and role. Actors,
turn endings, winner, and end reason are deterministic consequences of the
seat and ordered actions, so the decoder rebuilds and validates them instead of
duplicating them.

Developer-game links retain the `developerMode` provenance marker but omit raw
diagnostics. Starting state, settings, and ordered actions are sufficient to
reconstruct the completed game. The local archive adds versioned diagnostics
to the action that recorded them so exact score and decision traces remain
available on the originating device. Normal actions omit that slot.

The decoder accepts legacy six-setting version 1 payloads and supplies the
`late` missed-target timing default. It never infers the setting from history.

This shape keeps ordinary games well below common link limits. The smoke
fixture requires a completed game code to stay below 2,048 characters, while
the decoder permits up to 16,384 characters and 512 actions for unusual games.

## Validation and compatibility

[`decodeCompletedGame`](../src/play/game-share.js) fails closed on unknown
versions, malformed base64url or UTF-8, unsupported seats or settings, invalid
boards, excessive actions, actions that cannot be replayed, and exports that do
not finish a game.

The explicit board code avoids dependence on recent-word history or a future
random-board result. Keep the version 1 decoder compatible when Play rules,
word assets, or storage schemas change. Introduce a new completed-game version
when an old action cannot be replayed under a new contract.

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
