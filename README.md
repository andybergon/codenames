# Codenames

A local-first Codenames clue trainer and one-human game. Train mode ranks clue options for every possible target count. Play mode fills the other three seats with bots and runs a standard two-team game entirely in the browser.

[Open Codenames](https://codenames.andybergon.me)

## Current product

- 🎮 **Modes** · Play is the default · Train keeps the complete analysis workflow at `?mode=train`
- 🌍 **Languages** · English remains the default · Italian Extended is available as a Train and Play beta
- 🤖 **Play bots** · configurable model, vocabulary, clue policy, missed-target timing, operative aggression, and bonus guesses
- 🧠 **Train model** · MiniLM-L6 for English · Multilingual E5 small for Italian · browser-local inference
- 📚 **Clue index** · balanced 10,000-word default · selectable 3k, 30k, and experimental 100k tiers
- 🛡️ **Recommendations** · safe clues for one to three targets · stretch clues for four to nine
- 💬 **Explanations** · shared concept and target relationships · score-based danger stays separate
- 🎴 **Board words** · Official 400-word set · Extended 800-word strict superset
- 🔁 **New boards** · fully random or avoid words from recent local games
- 🔗 **Sharing** · board-only `?b=` links · resumable Play `?g=` links
- 🎨 **Appearance** · system, light, and dark modes
- 🔒 **Privacy** · local by default · Play links contain the full key and history · explanations send only the selected clue and targets

The first model load is cached by the browser. Italian Train and Play load about 123.6 MB on a cold browser, primarily the 118.3 MB E5 model. Training progress is session-local. Play progress, including language, is saved after every event and can be resumed or discarded from setup. During an active game, history can move backward and forward. Board-only links open Train without Play history. Play links reopen the current phase, revealed cards, and complete history so far. Completed games are also kept in a bounded local archive.

## Docs

- [Clue engine](docs/clue-engine.md) explains the embedding pipeline, legality filter, scoring contract, model assets, and evaluation commands.
- [Play game sharing](docs/play-game-sharing.md) defines the portable active and completed game export, local archive, validation, and future feedback-storage boundary.
- [Data licenses and attribution](docs/data-licenses.md) records Italian board, corpus, and model provenance.
- [Play clue number analysis](docs/play-clue-number-analysis.md) records the controlled Play-policy evidence.
- [Play fun optimization](docs/play-fun-optimization.md) defines the Fun Index and hosted-model promotion gates.
- [Italian language support](docs/italian-language-support.md) evaluates vocabulary rights, multilingual models, compatibility, cost, and staged implementation.
- [TODO.md](TODO.md) tracks unfinished gameplay, calibration, vocabulary, and model work.

## Run

```sh
npm install
npm run dev
```

The app makes no semantic explanation request until **Explain** is selected for one recommendation or a completed-game clue. `npm run dev` works without a key; to exercise the paid explanation action, provide `OPENAI_API_KEY` or use the app-scoped key in Doppler:

```sh
npm run dev:semantic
```

The Vite server accepts explicit host and port arguments:

```sh
npm run dev -- --host 127.0.0.1 --port 3535
```

Production uses the `OPENAI_API_KEY` Vercel environment variable. The browser never receives the key.

The hidden human-calibration page remains fully usable with browser storage alone. To sync answers between browsers, connect a Neon database to the Vercel project and provide server-side `DATABASE_URL` and `CALIBRATION_SYNC_SECRET` variables. Production asks for the sync key once, exchanges it for an HTTP-only cookie, and then records each correction automatically in both browser storage and Postgres. Sync retries transient failures, resolves concurrent edits by timestamp, and stores clears as deletion records so older answers cannot reappear. Only requests arriving from a loopback socket bypass the pairing key in Vite. Copy `.env.example` to `.env.local` to exercise the local flow.

## Verification

```sh
npm run check
npm test
```

`npm run check` syntax-checks the generators and application modules, runs the checked-in sample-board smoke fixture, and builds the production bundle. `npm test` adds the responsive Playwright suite.

Refresh controlled model-picker performance after changing scoring or selectable assets:

```sh
npm run benchmark:picker
```

## Play mode

Play defaults to the preserved table order. The top-right EN/IT control selects English or Italian Extended for a new game, while first-time visitors remain on English. Operatives see only unrevealed words and public card reveals. Spymasters see the full key, can switch between table and team-grouped order, type any one-word clue, and open clue suggestions only when wanted.

Play settings are grouped by ownership: Game controls the board word set and reuse policy, All bots controls the shared embedding model, Spymaster controls clue generation, and Operative controls guessing behavior. Bot settings remain independent from Train's Model picker and persist with each saved game. English defaults to BGE-small with 10,000 candidates. Italian uses Multilingual E5 small with 3,000 or 10,000 candidates. Both default to hybrid scoring, a five-point multi-clue tolerance, fresh targets before missed targets, Dynamic operative aggression, and no automatic extra guess.

Retry missed targets controls when the bot spymaster returns to intended friendly words that remain unrevealed after an earlier clue. Late strongly prefers never-targeted words until few remain, Mid-game applies a lighter early bias, and Immediately leaves clue ranking unchanged. Operative aggression controls whether the guessing bot continues through weaker associations. Conservative passes on doubt, Aggressive pursues the declared clue number, and Dynamic adapts using only public remaining-agent counts.

The final Developer settings section enables marked diagnostic games. Unlike other Play settings, enabling Developer mode also applies immediately to a saved game in progress. Once a game is marked, disabling the preference does not remove its developer provenance. Developer games store `developerMode: true` at the game root and on the canonical `game-started` event. They also retain versioned raw clue scores and bot decision traces on the related clue, guess, and pass events. Show live turn analysis reuses the post-game clue review while the game is active, including the reconstructed board, intended targets, guesses, roles, all operative scores, and the explicit paid explanation action. Turning it off restores the playable current turn. The display resets off for each tab, but the developer provenance and collected data remain in the saved game so archives, review links, and later calibration can include or filter them.

New boards remain fully random by default. The optional Avoid recent words policy records the last 32 local Play boards, uses every unseen word in the selected pool before the least-recently-used repeats, and warns when fewer than 25 unseen words remain. Clear history resets board reuse without changing the selected policy. History and policy stay local under `codenames-play-word-reuse-v1`.

After a game ends, select any clue in the Game log to replay that turn from the event history. The review restores which cards were already revealed when the clue was given, marks intended targets and guess outcomes, and shows the configured operative model's cosine-similarity score for every board word. It is completion-gated, so none of these annotations or hidden roles appear during live operative play. The header Share action always copies a `?mode=play&g=` link. Active links preserve the current phase, revealed cards, and turn history; completed links open the full review.

Completed games are deduplicated into a 32-game local archive. The newest completed save keeps its prominent review action, while older records stay in a collapsed Past games section below Play Settings. Each archived game can be reviewed, copied as a link, or removed. Developer records retain raw diagnostics locally, while copied links contain only provenance plus the starting state, settings, and actions needed for replay. The export versions its format, rules, and settings separately; unsupported historical completed-game rules fall back to an action-log review without rewriting the original link. See [Play game sharing](docs/play-game-sharing.md) for the versioned export contract and privacy boundary.

The Play implementation keeps rules, bot choices, persistence, and rendering separate:

- `src/play/game-state.js` owns the rules, seat authorization, event history, public projection, win conditions, and completed-turn replay.
- `src/play/game-share.js` owns the versioned active and completed Play export and validated replay.
- `src/play/bots.js` chooses bot clues and guesses. The operative API accepts only clue-to-word similarities and never receives card roles or intended targets.
- `src/play/session-store.js` persists the resumable game under `codenames-play-session-v1` and the bounded completed archive under `codenames-play-completed-v1`.
- `src/developer-settings.js` persists the separate Developer mode preference under `codenames-developer-settings-v1`.
- `src/play/word-reuse.js` owns new-board reuse policy, bounded local history, exhaustion fallback, and reset behavior.
- `src/play/mode.js` owns Play setup, rendering, model orchestration, bot pacing, resume/backward/forward controls, and post-game score overlays.
- `scripts/play-smoke.mjs` covers seat ownership, information boundaries, reveal outcomes, deterministic bots, and bounded self-play.

Run `npm run benchmark:play` for English comparisons, `npm run benchmark:play:italian` for Italian E5 self-play, `npm run benchmark:play:italian-transfer` for the independent MiniLM operative stress test, and `npm run analyze:play-clues` for controlled opening-board analysis. The full-game benchmark accepts `--missed-target-timing late|balanced|immediate` for controlled spymaster comparisons. The checked summaries preserve the [English same-model benchmark](scripts/generated/play-policy-benchmark.md), [English cross-model stress test](scripts/generated/play-operative-aggression-cross-model.md), [Italian same-model result](scripts/generated/italian-play-policy-benchmark.md), and [Italian transfer result](scripts/generated/italian-play-minilm-transfer-benchmark.md).

The benchmark also reports a 0-100 Fun Index that balances ambitious multi-card clues, productive guesses, close finishes, and games in the 8 to 12 turn range. Wrong-team hits, assassin losses, neutral hits, and fallbacks remain promotion guardrails rather than sources of points. Use `--operative-model <model-id>` to stress-test whether clues transfer to a different embedding geometry instead of relying only on optimistic same-model self-play.

Embedding selection uses frozen board splits, model-specific similarity calibration, paired bootstrap intervals, cross-model transfer gates, and a one-time blinded human round. Open `?mode=calibrate` directly to complete or correct the calibration, export answers, or import another versioned round. Choices, ratings, and notes save automatically in browser storage and sync to Postgres when configured; recording a pass remains an explicit action. The tool is intentionally absent from normal Play and Train navigation, and its public round data excludes the separate model answer key.

## Board word sets

**Official** contains 400 unique words from the original English base game, including the printed multi-word entries `ICE CREAM`, `LOCH NESS`, `NEW YORK`, and `SCUBA DIVER`. It is based on a [public transcription](https://gist.github.com/siemanko/6cc17ee2a253089969b1b904660b4097) with obvious spelling errors normalized.

**Extended** is a strict 800-word superset. Its 400 additions are selected from a reviewed candidate universe using frequency, association breadth, semantic-domain entropy, and category fit across 14 domains.

**Italian Extended beta** is an independently authored 800-word pool. It is not a translation or transcription of an official Codenames list. The Italian clue corpus is derived from the CC BY 4.0 Leipzig Italian News 2024 100K corpus, with the source archive, checksum, filters, model revision, task prefix, and 30,000-word centering mean recorded in the generated manifest. The official Italian preset remains unavailable until public redistribution permission is documented.

Regenerate the checked-in Extended set and audit report with:

```sh
npm run generate:extended
npm run generate:italian
```

Version 4 share links encode Italian, the `it:extended-v1` asset version, and UTF-8 custom words. English remains on version 3. Version 1 retains the historical 366-word pool, and version 2 retains the former Official 400 and Extended 407 pools so existing shared boards remain reproducible.

## Generated assets

Clue words and model indexes are generated together:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements-clues.txt
npm run generate:data
```

Do not update one model shard independently. See [Clue engine](docs/clue-engine.md) for the asset contract and evaluation reports.
