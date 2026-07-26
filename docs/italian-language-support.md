# Italian language support

## Recommendation

Italian support is technically feasible, but it should launch first with an independently curated Extended vocabulary. The official Italian 400-word set must not be copied into this public repository without a written redistribution grant from Cranio Creations or Czech Games Edition.

| 🧭 Path | 🎯 Rating | ⚖️ Rights | 🧠 Model | 🚦 Readiness |
| --- | --- | --- | --- | --- |
| 🇮🇹 Open Extended beta | 🟢 4.5 | Original + CC BY | Multilingual E5 small | Train + Play beta |
| 🔒 User-supplied local deck | 🟡 3.5 | Private input | Multilingual E5 small | Feasible |
| 🃏 Official Italian preset | 🟠 3 | Permission needed | Multilingual E5 small | Legally blocked |
| 🌐 Translated English set | 🔴 1 | Not official | Any | Reject |

English remains the production default. Italian is an explicit Train and Play beta selected through the top-right EN/IT control. A first visit to the bare app URL still opens English Play.

## Implemented beta

- **Vocabulary:** `it:extended-v1` contains 800 unique single-word entries authored for this project across ten semantic categories. It is not copied from or aligned to an official list.
- **Clue corpus:** Leipzig Italian News 2024 100K supplies the CC BY 4.0 frequency tail. The generated manifest pins archive SHA-256 `669acde110a865bbdcd974ccff6838461ed3aff9106a9a743bde22153e6b7a6c`.
- **Model:** `Xenova/multilingual-e5-small` is pinned at revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78` with q8 model SHA-256 `f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193`. Board and clue terms both use the `query: ` prefix.
- **Assets:** 3,000 and 10,000 candidate tiers use one mean over 30,000 Italian candidates. The 10k index is 5.30 MB.
- **Compatibility:** v1 through v3 remain English. V4 encodes Italian, asset version 1, Extended, layout, roles, and UTF-8 custom words. Unsupported asset versions fail closed.
- **Legality:** normalization preserves Unicode. Accent-folded comparison, Italian inflection stems, checked irregular families, and stem containment block examples such as `citta` against `città`, `attrice` against `attore`, and `abbraccia` against `braccio`.
- **Interface:** the top-right EN/IT control applies to Train and Play. Primary setup, action, status, history, board, recommendation, and model copy use locale dictionaries. Italian Play is visibly marked experimental.
- **Play:** new Italian games use Extended, Multilingual E5 small, and the 3k or 10k Italian clue index. The game language persists with the session and v4 board shares.

The in-app Chromium verification loaded real Italian Train and Play boards with 10,000 candidates. Train retained 9,915 legal candidates and scored its board in 845 to 874 ms after model load. Post-analysis JavaScript heap was 115.4 MB used and 118.8 MB allocated. At viewport overrides 390x844, 768x1024, and 1440x900, both modes had no horizontal overflow, the EN/IT control remained visible, and every five-column card stayed within the board.

The beta label is material. The 800 words and Italian interface copy still require two native reviewers, the human evaluation fixture still needs at least 100 reviewed turns, and the cross-model stress result is not safe enough to treat bot self-play as a human outcome estimate.

## Evidence boundary

This analysis uses three distinct evidence classes:

- **Publisher facts:** Cranio Creations identifies *Nome in Codice, Seconda Edizione* as the current Italian product, says it has an updated word list, and lists 200 cards with 400 codenames. Its product page and the CGE Italian rulebook do not publish or license the complete word list.
- **Published model evidence:** model cards and MMTEB indicate multilingual scope and general semantic quality. These benchmarks are not Codenames gameplay evidence.
- **Repo prototype:** [`italian-embedding-feasibility.json`](../scripts/generated/italian-embedding-feasibility.json) measures three q8 browser models on an original 16-turn Italian fixture. It contains no official Codenames vocabulary.

The legal section is a conservative engineering recommendation, not legal advice.
Checked asset attribution lives in [Data licenses and attribution](data-licenses.md).

## Vocabulary and licensing

### Official Italian vocabulary

The current official source of truth is the physical Italian second edition or a machine-readable list supplied by its publisher. The [Cranio product page](https://www.craniocreations.it/prodotto/nome-in-codice-seconda-edizione) confirms that the revised edition has an updated 400-word list. The [official Italian rulebook](https://czechgames.com/files/rules/codenames-rules-it.pdf) supplies rules and examples, not the complete deck.

| 📚 Source | 🎯 Rating | ✅ Accurate | ✅ Redistributable | 📌 Use |
| --- | --- | --- | --- | --- |
| ✉️ Publisher grant and list | 🟢 5 | ✅ | ✅ If granted | Official preset |
| 🃏 Purchased Italian deck | 🟡 3.5 | ✅ | ❌ | Private local import |
| 📄 Product page and rules | 🟠 3 | Partial | ❌ | Provenance only |
| 🌐 Unlicensed transcription | 🔴 1 | Unverified | ❌ | Exclude |

A list of ordinary words can still be protected through the creative selection or arrangement of the compilation and, in the EU, potentially through database rights. The [European Commission database guidance](https://digital-strategy.ec.europa.eu/en/policies/protection-databases) says original selection or arrangement can receive copyright protection, while substantial investment can support a separate database right. Copyright protection is automatic in the EU according to the [European IP Helpdesk](https://intellectual-property-helpdesk.ec.europa.eu/ip-management-and-resources/copyright_en).

Safe implementation choices:

1. Ask Cranio Creations and CGE for the current second-edition list plus written permission to redistribute it in this open web app and generated indexes.
2. If permission is not granted, support a user-supplied local list. Store it only in the browser, do not upload it, do not include it in seeded share links, and label it as a custom deck rather than an Official preset.
3. Do not translate the English deck and call it Official. Translation changes ambiguity, cultural associations, morphology, and the publisher's curated selection.
4. Do not extract assets from the official digital app. App availability in Italian is evidence of publisher support, not a redistribution license.

### Independent Extended vocabulary

The production implementation separates the authored board pool from the licensed frequency corpus:

| 📚 Source | 🎯 Rating | ⚖️ License | 💼 Commercial-safe | 📌 Use |
| --- | --- | --- | --- | --- |
| 📰 Leipzig downloads | 🟢 5 | CC BY | ✅ | Frequency base |
| 📖 Italian Wiktionary | 🟡 4 | CC BY-SA and GFDL | ✅ With duties | Lemma review |
| 🌍 PAISÀ | 🟠 2.5 | Mixed CC BY-SA and BY-NC-SA | ❌ Mixed | Exclude |

The [Leipzig Corpora Collection terms](https://www.wortschatz.uni-leipzig.de/en/usage) license downloadable text corpora under CC BY. This is the recommended frequency source because commercial reuse is permitted with attribution. Pin one named Italian corpus archive, its checksum, download date, and the transformation script.

[Italian Wiktionary](https://it.wiktionary.org/wiki/Aiuto:Copyright) permits copying and adaptation under CC BY-SA 4.0 and GFDL conditions. It is legally usable only if the project preserves attribution and share-alike obligations for derived data. Keep any Wiktionary-derived asset separately identified and licensed rather than implying the whole application inherits the same terms.

[PAISÀ](https://www.corpusitaliano.it/en/index.html) combines CC BY-SA and CC BY-NC-SA texts. That mixed noncommercial restriction makes it a poor production source for an unrestricted public app.

The checked implementation creates the Italian Extended set as an original 800-word pool, not as a translation:

1. Author common, concrete, and evocative single-word entries across ten semantic categories without consulting an official list.
2. Validate exactly 800 unique Unicode-letter entries and publish the source hash.
3. Use the pinned Leipzig corpus only for clue-candidate frequency, not as ownership evidence for the board pool.
4. Prioritize the authored 800 words as game-friendly clue candidates before the licensed frequency tail.
5. Preserve accents in display and identity, then use accent folding only inside the legality comparison.
6. Have at least two native Italian speakers independently review every entry for familiarity, regional bias, clue potential, and accidental offensiveness.
7. Publish the reviewer rubric and reviewer version alongside a future reviewed asset revision.

The English Extended pool's 14-domain balance is a useful shape, but the Italian categories and final words must be reviewed independently. A translated selection would preserve English assumptions instead of Italian playfulness.

## Embedding candidates

### Compact comparison

The prototype uses centered semantic metrics because centering improved target recall for both multilingual candidates. Morphology is reported on raw vectors because the tiny fixture mean is not a representative production centering corpus.

| 🧠 Model | 🎯 Rating | 📦 q8 | 📐 Dim | 📚 Published Italian evidence | 🎯 Target recall | 🛡️ Risk hit | 🔤 Morphology | ⏱️ 25 words | ⚖️ License |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 🌍 Multilingual E5 small | 🟢 4.5 | 118.3 MB | 384 | STS17 77.3 · Tatoeba 87.6 | 81.3% | 12.5% | 0.936 | 12.6 ms | MIT |
| 🌐 Multilingual MiniLM L12 | 🟡 3.5 | 118.3 MB | 384 | 50 languages | 78.1% | 31.3% | 0.821 | 8.8 ms | Apache 2.0 |
| 🧬 GTE multilingual base | 🟠 3 | ~305 MB | 768 | Tatoeba 91.4 | Not run | Not run | Not run | Not run | Apache 2.0 |
| 🧠 BGE-M3 | 🟠 2.5 | ~568 MB | 1,024 | 100+ languages | Not run | Not run | Not run | Not run | MIT |
| 🇬🇧 BGE-small English | 🔴 1.5 | 34.0 MB | 384 | English only | 56.3% | 37.5% | 0.765 | 9.7 ms | MIT |

Published figures come from the model cards for [Multilingual E5 small](https://huggingface.co/intfloat/multilingual-e5-small), [Multilingual MiniLM L12](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2), [GTE multilingual base](https://huggingface.co/Alibaba-NLP/gte-multilingual-base), and [BGE-M3](https://huggingface.co/BAAI/bge-m3). GTE reports 305 million parameters, while BGE-M3 is based on a much larger multilingual encoder. Their q8 sizes are planning estimates, not repo measurements.

The [MMTEB paper](https://arxiv.org/abs/2502.13595) evaluates more than 500 tasks across more than 250 languages and reports a 55.5 multilingual aggregate for Multilingual E5 small. Its language inventory includes 27 Italian tasks, but the aggregate is not an Italian-only score.

### Repo prototype

Run the free local probe with:

```sh
npm run evaluate:italian
```

The checked report records:

- 16 original Italian clue turns, each with two intended targets, three neutral words, and one related risk word.
- 15 number, gender, irregular, verb, and accent pairs.
- q8 model bytes from the exact Transformers.js cache.
- warm Node inference for 25 terms over five runs.
- raw and fixture-centered target recall, exact target-set accuracy, risk-word intrusion, and morphology similarity.

Multilingual E5 small is the clear browser candidate. Against the English BGE control, centered target recall rises from 56.3% to 81.3%, risk intrusion falls from 37.5% to 12.5%, and raw morphology similarity rises from 0.765 to 0.936. Multilingual MiniLM improves semantic recall but has a 31.3% centered risk rate, so equal bundle size does not justify choosing it.

The 12.4 ms versus 10.1 ms warm Node result is close enough for active-board inference. Network transfer is the dominant regression: Multilingual E5 adds 84.3 MB over BGE-small and 95.3 MB over the current Train MiniLM-L6 model.

These results are directional. They do not establish native-speaker quality, legality, cultural fit, or complete-game fun.

### Full-game behavior

Both checked runs use 100 paired deterministic boards per clue policy and the production Play state machine. Every simulated game completed within the 100-action bound.

| 🧪 Hybrid run | 🤖 Operative | 🎉 Fun | 🔢 Multi | ✅ Correct/turn | 🔴 Wrong/game | ☠️ Assassin | ⏱️ Turns |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 🇮🇹 Same E5 | E5 | 56.80 | 30.2% | 1.24 | 0.02 | 0% | 12.37 |
| 🔀 Transfer | MiniLM-L6 | 32.54 | 35.3% | 0.58 | 2.55 | 63% | 13.61 |

The [same-model report](../scripts/generated/italian-play-policy-benchmark.md) confirms bounded runtime behavior and no analyzer fallbacks, but it shares one geometry between clue giver and guesser. The compact [transfer report](../scripts/generated/italian-play-minilm-transfer-benchmark.md) deliberately uses English MiniLM-L6 as an independent operative. Its poor result is a warning about geometry agreement, not a prediction that Italian players hit the assassin 63% of the time. The transfer simulation forces the highest-similarity available guess after a complete round of passes so every stress-test game terminates, and reports those interventions separately.

Promotion beyond beta still requires at least 100 native-reviewed turns and human operative guesses. A higher self-play Fun score alone is insufficient.

### Observed orthographic false friends

Completed-game review exposed two spelling-driven clue failures that the aggregate fixture did not catch:

- `MONOLOGO 1` targeted `MONGOLFIERA`.
- `PARTONO 2` targeted `PANTERA` and `BURATTINO`.

The exact pinned E5 model, `query: ` prefix, 30,000-term production mean, and quantized clue vectors reproduce the spymaster scores:

- `MONOLOGO → MONGOLFIERA` scores `0.4211`, above `DISCORSO` at `0.1933`, `SOLILOQUIO` at `0.1380`, and `TEATRO` at `0.0809`.
- `PARTONO → PANTERA` scores `0.3568` and `PARTONO → BURATTINO` scores `0.3161`, both above `PARTONO → PARTIRE` at `0.2561` and `PARTONO → VIAGGIO` at `0.0295`.

The tokenizer splits `monologo` into `mono + logo` and `mongolfiera` into `mon + golf + iera`. It also gives `partono` and `burattino` the shared `no` subword. These examples show that centered E5 geometry can amplify orthographic and subword overlap beyond human semantic association. They also show why same-model self-play is insufficient: the spymaster selects the false friend and the operative ranks it highly using the same geometry.

Italian generated clue scoring now applies a `0.23` pairwise similarity penalty when a clue and board word are both at least seven letters, have a length ratio of at least `0.72`, share a prefix or suffix of at least two letters, and cross both whole-word and consonant-skeleton Jaro-Winkler thresholds. The production reproductions fall to `0.1911`, `0.1268`, and `0.0861` respectively. The feasibility gate blocks all three observed failures while preserving six source-created semantic controls.

This is a targeted spelling-artifact guard, not a general semantic reranker. It affects only generated Italian clue scoring. English scoring, human clue legality, and operative guessing remain unchanged. Across the paired 100-board simulations, same-model Fun moved from `59.56` to `58.22`, while the transfer assassin rate improved from `65%` to `61%`; transfer Fun moved from `42.45` to `40.53` and wrong-team hits rose from `2.64` to `2.83` per game. Native review remains the promotion gate because these aggregate tradeoffs do not prove that every allowed clue is meaningful.

## Italian morphology and clue legality

Runtime normalization preserves Unicode letters, numbers, and Italian accents through NFKC. Legality comparisons additionally fold accents and apply conservative Italian stem families, while display and embedding terms keep their original letters.

The implementation uses two explicit forms:

- **Display form:** Unicode NFKC, original accents, approved capitalization.
- **Comparison form:** Unicode NFKC, Italian locale lowercase, letters and combining marks preserved, whitespace collapsed.

An accent-folded form may be used only as an additional safety key. It must not replace the display or embedding text. For example, an invalid unaccented spelling should not become the canonical clue, but it should not bypass a board-word restriction either.

The official Italian rules require one-word clues and forbid a visible codename. They also describe group discretion around compounds and inflected forms. Bot clues need a deterministic conservative policy:

1. Reject exact board words after Unicode comparison.
2. Reject all forms sharing a reviewed lemma with a board word, including number, gender, and irregular forms.
3. Reject transparent derivations and compounds containing a board lemma when that relationship would reveal the word.
4. Reject punctuation-based attempts to turn a multi-word expression into one token.
5. Reject rhyme-only and spelling-only associations unless the clue also has a semantic relationship.
6. Keep a versioned exceptions file for accepted lexicalized compounds and distinct homographs.

Do not rely on embedding similarity to enforce legality. High morphological similarity is useful for finding possible family members, but a generated lemma-family map plus reviewed exceptions must own the rule.

## Product and data architecture

### Language selection

Language is independent from mode, word set, model, and UI appearance. Add it as a first-class value to:

- Train state and Play setup.
- Saved Play sessions.
- Generated-board seeds and explicit shares.
- Word-set and model compatibility metadata.
- Every generated manifest, cache key, and evaluation report.

Use namespaced asset IDs such as `en:official-v1`, `en:extended-v3`, `it:extended-v1`, and eventually `it:official-v1`. Do not reuse `official` or `extended` without language and version context.

The bare app URL continues to open English Play for first-time visitors. The EN/IT choice is saved locally. Switching language during a Play game returns to setup without deleting the saved game, while resuming restores the session's encoded language.

### UI copy

Move user-facing strings into locale dictionaries before adding Italian. Include:

- Mode, setup, board, role, team, action, status, and settings labels.
- Tooltips, accessible names, validation errors, empty states, and loading progress.
- Play event history, bot narration, win states, resume prompts, and share errors.
- Model and word-set explanations.

Keep generated clues and board words separate from UI localization. Do not translate game data at render time. Italian copy needs native review, especially for `spymaster`, `operative`, `bystander`, `assassin`, and the distinction between a clue number and a word-set size.

### Generated assets and centering

Create a language namespace rather than mixing English and Italian shards:

```text
public/data/model-lab/
  en/<model-id>/
  it/<model-id>/
```

Each manifest must pin:

- Language and word-set version.
- Model repository, revision, dtype, dimensions, and task prefix.
- Vocabulary source, source checksum, license, filters, and reviewer version.
- Centering corpus hash and count.
- Shard boundaries, byte sizes, and vector quantization.

Rebuild the Italian 3k, 10k, 30k, and 100k tiers from one stable prefix. All tiers for a model must use the same mean over the first 30,000 reviewed Italian clue candidates, matching the English asset contract. The small fixture mean improved semantic recall, but it is not suitable for production.

### Share-link compatibility

Versions 1 through 3 remain English and decode exactly as they do now. Add v4 only when language assets exist:

- Seed links encode language, word-set ID, and word-set version before interpreting indexes.
- Explicit links preserve UTF-8 literals. The new smoke coverage confirms that v3 literal encoding already round-trips `CITTÀ`.
- Unknown language or word-set versions fail clearly instead of falling back to English.
- Custom local decks use explicit literals only. Do not make a seed depend on a private list that another browser cannot reconstruct.

### Caching and deployment cost

The 384-dimensional 10,000-clue index remains approximately 5.27 MB, regardless of language. The measured Multilingual E5 q8 model is 118.3 MB, so a default Italian first load is approximately 123.6 MB before normal application assets. The current BGE-small Play model plus 10k index is approximately 39.3 MB.

| 📦 Asset | 🎯 Rating | 📏 Transfer | 🗄️ Cache | 💰 Cost owner |
| --- | --- | --- | --- | --- |
| 📚 10k Italian index | 🟢 4.5 | 5.27 MB | Browser and Vercel CDN | Vercel transfer |
| 📚 30k Italian index | 🟡 3.5 | 15.82 MB | Browser and Vercel CDN | Vercel transfer |
| 🧠 E5 q8 model | 🟠 3 | 118.3 MB | Browser Cache API | Model host |
| 📚 100k Italian index | 🔴 2 | 52.79 MB | Browser and Vercel CDN | Vercel transfer |

Transformers.js exposes browser model caching through its Cache API according to the [official environment documentation](https://huggingface.co/docs/transformers.js/en/api/env). Pin the model revision and checksum so a mutable upstream model cannot silently invalidate generated vectors.

[Vercel automatically caches static files](https://vercel.com/docs/caching/cdn-cache), but static transfer still counts as Fast Data Transfer according to [Vercel CDN usage documentation](https://vercel.com/docs/manage-cdn-usage). Content-hash immutable Italian shards to improve repeat visits. Do not preload Italian assets for English users.

Two hosting choices remain:

- Keep model weights on Hugging Face, as today. This avoids adding 118.3 MB per cold Italian visitor to Vercel transfer, but adds a third-party availability and privacy dependency.
- Self-host a pinned model artifact. This improves supply-chain control and same-origin caching, but transfers about 118.3 MB per cold visitor from the chosen host.

No server compute, database, paid API, or secret is required. The main costs are build time, repository or release storage, CDN transfer, and browser download time.

## Evaluation plan

Published STS and bitext scores are useful only for shortlisting. Italian promotion needs game-shaped evidence:

| 🧪 Gate | 🎯 Rating | 📊 Minimum evidence | ✅ Pass condition |
| --- | --- | --- | --- |
| 🔤 Unicode and morphology | 🟢 5 | Reviewed lemma suite | No bypasses |
| 👥 Native review | 🟢 5 | 2+ reviewers | Familiar and fun |
| 🔗 Compatibility | 🟢 5 | v1-v4 fixtures | Exact decoding |
| 🧠 Semantic fixture | 🟢 4.5 | 100+ native turns | Beats English control |
| 🛡️ Safety | 🟢 4.5 | Target, neutral, enemy, assassin | Within production guardrails |
| 🎮 Full-game policy | 🟢 4.5 | 100 paired boards | Fun plus safety |
| 📱 Browser performance | 🟢 4.5 | Phone, tablet, desktop | Responsive |

Build the evaluation data in this order:

1. Expand the source-created fixture to at least 100 clue turns reviewed by native Italian speakers.
2. Record intended targets, plausible first guesses, neutral words, enemy words, assassin words, clue number, and legality judgment.
3. Add morphology families covering regular plurals, gender, irregular plurals, derivation, elision, accents, apostrophes, and lexicalized compounds.
4. Collect opt-in exported Play sessions. Keep raw game history local unless a contributor explicitly submits it under a stated data license.
5. Run same-model and cross-model complete games on identical boards.
6. Ask reviewers to rate generated clues for legality, familiarity, target fit, danger, cleverness, and whether they would actually say the clue.

Do not translate or redistribute the current unlicensed Cultural Codes and Connector datasets. A translated benchmark would also change the human association task, so it would not be equivalent evidence.

## Staged implementation plan

### Stage 0: rights and source pinning, partially complete

- Request the official second-edition Italian list and redistribution terms from Cranio Creations and CGE.
- Pin the Leipzig Italian corpus archive, checksum, attribution, and transformation rules.
- Decide whether Wiktionary-derived morphology data is worth the share-alike obligations.

Exit: every proposed checked-in word asset has documented provenance and redistribution terms.

### Stage 1: language-safe substrate, complete

- Add Unicode-preserving normalization and lemma-family legality tests.
- Introduce locale dictionaries without exposing an Italian production choice.
- Namespace word sets, manifests, caches, and settings by language.
- Add v4 share encoding while preserving v1 through v3.

Exit: all English tests and share fixtures pass unchanged, plus Italian Unicode fixtures pass.

### Stage 2: Extended Train beta, technical release complete

- Generate and review `it:extended-v1`.
- Build the Multilingual E5 3k and 10k indexes with a 30k Italian mean.
- Add Italian as an explicit Train beta choice.
- Measure actual first-load time, memory, scoring latency, and responsive UI at 390x844, 768x1024, and 1440x900.

Technical exit: generated assets, browser performance, responsive UI, and compatibility checks pass. Promotion exit remains pending native review of the pool, copy, and generated clues.

### Stage 3: Play beta, technical release complete

- Add Italian language, assets, legality, persistence, and v4 sharing to Play.
- Run the complete 100-board paired same-model benchmark.
- Run a 100-board cross-model operative stress test.
- Collect native-player games and compare bot outcomes with human guesses.
- Tune clue policy only if the language-specific evidence requires it.

Technical exit: Play behavior, completion, compatibility, and responsive UI checks pass. Promotion exit remains pending native-player evidence, copy review, and an operative model that supplies a meaningful Italian transfer comparison.

### Stage 4: official preset, legally blocked

- Add `it:official-v1` only after written redistribution permission.
- Pin the exact edition and list version.
- Regenerate all board, share, evaluation, and model assets for that official pool.

Exit: official provenance is auditable and the public repository contains only authorized data.

## Primary sources

- [Cranio Creations, Nome in Codice Seconda Edizione](https://www.craniocreations.it/prodotto/nome-in-codice-seconda-edizione)
- [Czech Games Edition, Italian Codenames rules](https://czechgames.com/files/rules/codenames-rules-it.pdf)
- [European Commission, database protection](https://digital-strategy.ec.europa.eu/en/policies/protection-databases)
- [European IP Helpdesk, copyright](https://intellectual-property-helpdesk.ec.europa.eu/ip-management-and-resources/copyright_en)
- [Leipzig Corpora Collection, terms of usage](https://www.wortschatz.uni-leipzig.de/en/usage)
- [Italian Wiktionary, copyright and reuse](https://it.wiktionary.org/wiki/Aiuto:Copyright)
- [PAISÀ Italian corpus](https://www.corpusitaliano.it/en/index.html)
- [MMTEB paper](https://arxiv.org/abs/2502.13595)
- [Multilingual E5 small model card](https://huggingface.co/intfloat/multilingual-e5-small)
- [Multilingual MiniLM L12 model card](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2)
- [GTE multilingual base model card](https://huggingface.co/Alibaba-NLP/gte-multilingual-base)
- [BGE-M3 model card](https://huggingface.co/BAAI/bge-m3)
- [Transformers.js cache environment](https://huggingface.co/docs/transformers.js/en/api/env)
- [Vercel CDN cache](https://vercel.com/docs/caching/cdn-cache)
- [Vercel CDN usage](https://vercel.com/docs/manage-cdn-usage)
