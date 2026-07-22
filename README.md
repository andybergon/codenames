# Codenames Trainer

A local-first Codenames clue trainer that embeds the board in the browser, searches a precomputed clue index, and ranks options across every supported target count.

[Open the live trainer](https://codenames.andybergon.me)

## Current product

- 🧠 **Embedding** · `Xenova/all-MiniLM-L6-v2` by default · local browser execution
- 📚 **Clue index** · balanced 10,000-word default · selectable 3k, 30k, and experimental 100k tiers
- 🛡️ **Recommendations** · safe clues for one to three targets · stretch clues for four to nine
- 📊 **Ranking** · weakest target, role-weighted danger, expected net, Worth, and risk
- 🎴 **Board words** · Official 400-word set · Extended 800-word strict superset
- 🎮 **Gameplay** · Blue/Red turns · click targets guessed · restore individual cards
- 🔗 **Sharing** · versioned `?b=` links preserve words, roles, word set, and layout
- 🎨 **Appearance** · system, light, and dark modes
- 🔒 **Privacy** · board words stay in the browser and are not sent to an application server

The first model load is cached by the browser. Turn progress is session-local; a shared link restores the board but not guessed-card or active-turn state.

## Docs

- [Clue engine](docs/clue-engine.md) explains the embedding pipeline, legality filter, scoring contract, model assets, and evaluation commands.
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
