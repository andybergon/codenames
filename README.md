# Codenames

A local-first Codenames clue trainer and one-human game. Train mode ranks clue options for every possible target count. Play mode fills the other three seats with bots and runs a standard two-team game entirely in the browser.

[Open Codenames](https://codenames.andybergon.me)

## Current product

- 🎮 **Modes** · Play is the default · Train keeps the complete analysis workflow at `?mode=train`
- 🤖 **Play bots** · configurable model, vocabulary, clue policy, operative aggression, and bonus guesses
- 🧠 **Train model** · MiniLM-L6 by default · browser-local inference
- 📚 **Clue index** · balanced 10,000-word default · selectable 3k, 30k, and experimental 100k tiers
- 🛡️ **Recommendations** · safe clues for one to three targets · stretch clues for four to nine
- 🎴 **Board words** · Official 400-word set · Extended 800-word strict superset
- 🔁 **New boards** · fully random or avoid words from recent local games
- 🔗 **Sharing** · versioned `?b=` links preserve the board, roles, word set, and layout
- 🎨 **Appearance** · system, light, and dark modes
- 🔒 **Privacy** · board words stay in the browser and are not sent to an application server

The first model load is cached by the browser. Training progress is session-local. Play progress is saved after every event and can be resumed or discarded from setup. During an active game, history can move backward and forward. Shared board links open Train without Play history.

## Docs

- [Clue engine](docs/clue-engine.md) explains the embedding pipeline, legality filter, scoring contract, model assets, and evaluation commands.
- [Play clue number analysis](docs/play-clue-number-analysis.md) records the controlled Play-policy evidence.
- [Play fun optimization](docs/play-fun-optimization.md) defines the Fun Index and hosted-model promotion gates.
- [TODO.md](TODO.md) tracks unfinished gameplay, calibration, vocabulary, and model work.

## Run

```sh
npm install
npm run dev
```

The Vite server accepts explicit host and port arguments:

```sh
npm run dev -- --host 127.0.0.1 --port 3535
```

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

Play defaults to the preserved table order. Operatives see only unrevealed words and public card reveals. Spymasters see the full key, can switch between table and team-grouped order, type any one-word clue, and open clue suggestions only when wanted.

Play settings are grouped by ownership: Game controls the board word set, All bots controls the shared embedding model, Spymaster controls clue generation, and Operative controls guessing behavior. Bot settings remain independent from Train's Model picker and persist with each saved game. The default is BGE-small with 10,000 candidates, hybrid scoring, a five-point multi-clue tolerance, Dynamic operative aggression, and no automatic extra guess. Conservative passes on doubtful follow-up guesses, Aggressive pursues the declared clue number with the former thresholds, and Dynamic adapts using only the public remaining-agent counts. Each bot setting's info control compares the checked quality, speed, and risk tradeoffs in a compact table.

New boards remain fully random by default. The optional Avoid recent words policy records the last 32 local Play boards, uses every unseen word in the selected pool before the least-recently-used repeats, and warns when fewer than 25 unseen words remain. Clear history resets board reuse without changing the selected policy. History and policy stay local under `codenames-play-word-reuse-v1`.

The Play implementation keeps rules, bot choices, persistence, and rendering separate:

- `src/play/game-state.js` owns the rules, seat authorization, event history, public projection, and win conditions.
- `src/play/bots.js` chooses bot clues and guesses. The operative API accepts only clue-to-word similarities and never receives card roles or intended targets.
- `src/play/session-store.js` persists the versioned game state under `codenames-play-session-v1`.
- `src/play/word-reuse.js` owns new-board reuse policy, bounded local history, exhaustion fallback, and reset behavior.
- `src/play/mode.js` owns Play setup, rendering, model orchestration, bot pacing, and resume/backward/forward controls.
- `scripts/play-smoke.mjs` covers seat ownership, information boundaries, reveal outcomes, deterministic bots, and bounded self-play.

Run `npm run benchmark:play` for paired full-game comparisons and `npm run analyze:play-clues` for controlled opening-board analysis. The latest [same-model benchmark](scripts/generated/play-policy-benchmark.md), [cross-model operative stress test](scripts/generated/play-operative-aggression-cross-model.md), and [clue-number analysis](docs/play-clue-number-analysis.md) preserve the checked evidence.

The benchmark also reports a 0-100 Fun Index that balances ambitious multi-card clues, productive guesses, close finishes, and games in the 8 to 12 turn range. Wrong-team hits, assassin losses, neutral hits, and fallbacks remain promotion guardrails rather than sources of points. Use `--operative-model <model-id>` to stress-test whether clues transfer to a different embedding geometry instead of relying only on optimistic same-model self-play.

## Board word sets

**Official** contains 400 unique words from the original English base game, including the printed multi-word entries `ICE CREAM`, `LOCH NESS`, `NEW YORK`, and `SCUBA DIVER`. It is based on a [public transcription](https://gist.github.com/siemanko/6cc17ee2a253089969b1b904660b4097) with obvious spelling errors normalized.

**Extended** is a strict 800-word superset. Its 400 additions are selected from a reviewed candidate universe using frequency, association breadth, semantic-domain entropy, and category fit across 14 domains.

Regenerate the checked-in Extended set and audit report with:

```sh
npm run generate:extended
```

Version 3 share links encode the selected word set. Version 1 retains the historical 366-word pool, and version 2 retains the former Official 400 and Extended 407 pools so existing shared boards remain reproducible.

## Generated assets

Clue words and model indexes are generated together:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements-clues.txt
npm run generate:data
```

Do not update one model shard independently. See [Clue engine](docs/clue-engine.md) for the asset contract and evaluation reports.
