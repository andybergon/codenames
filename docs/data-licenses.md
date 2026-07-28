# Data licenses and attribution

## Princeton WordNet concept data

The English operative concept bridge uses Princeton WordNet 3.0 sense definitions generated into `public/data/concepts/`. The checked data covers 56,118 of 100,000 selectable English clues and 792 of 800 English board terms, removes usage examples, and keeps at most six ordered definitions per lemma. Terms without an entry retain direct embedding ranking.

- **Source:** Princeton WordNet 3.0
- **Archive SHA-256:** `cbda5ea6eef7f36a97a43d4a75f85e07fccbb4f23657d27b4ccbc93e2646ab59`
- **License:** [WordNet 3.0](../public/data/concepts/LICENSE.md)
- **Refresh:** `WORDNET_ARCHIVE=<path>/wordnet.zip npm run generate:concepts`

The runtime lazily loads the board dictionary and one of 256 deterministic FNV-1a hash shards for the clue. It does not call a hosted knowledge graph or send clue and board data to a paid model.

## Operative reranker benchmark

The non-production local sweep uses pinned quantized artifacts that stay in local caches and are never loaded by Play:

- `Xenova/ms-marco-MiniLM-L-6-v2` at `a09144355adeed5f58c8ed011d209bf8ee5a1fec`, Apache-2.0 upstream.
- `mixedbread-ai/mxbai-rerank-xsmall-v1` at `b5c6e9da73abc3711f593f705371cdbe9e0fe422`, Apache-2.0.
- `Xenova/bge-reranker-base` at `280bcc27a84e0b898c251e06fddb25171bd9b101`, MIT upstream.
- `onnx-community/bge-reranker-v2-m3-ONNX` at `6f5ff65298512715a1e669753bc754d2bc8f367b`, Apache-2.0 upstream.
- `onnx-community/gte-multilingual-reranker-base` at `ee64367e35a2db0da46bb6497e13a18f8bd585cb`, Apache-2.0 upstream.

The fixed comparison also runs `jinaai/jina-reranker-v3-mlx` at `1d19fe38ae4e6658221479747c1152d6136dd6ab`. Its CC BY-NC 4.0 license blocks production use. The checked reports retain only aggregate human metrics, original project fixtures, model metadata, size, latency, memory, and capped hosted usage. Human dataset rows and model weights remain local.

## Italian Train and Play beta

### Board words

`it:extended-v1` is original project data authored in [`scripts/italian/extended-words.txt`](../scripts/italian/extended-words.txt). Its word selection is dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) and is not copied from, translated from, or aligned to an official Codenames list.

The generator validates 800 unique Unicode-letter words and records the source SHA-256 in [`src/generated/italian-word-data.js`](../src/generated/italian-word-data.js).

### Clue corpus

- **Source:** Leipzig Corpora Collection, Italian News 2024 100K
- **Provider:** Leipzig University, Department of Computer Science
- **Download:** `https://downloads.wortschatz-leipzig.de/corpora/ita_news_2024_100K.tar.gz`
- **Archive SHA-256:** `669acde110a865bbdcd974ccff6838461ed3aff9106a9a743bde22153e6b7a6c`
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Terms:** [Leipzig Corpora Collection usage terms](https://www.wortschatz.uni-leipzig.de/en/usage)

The project extracts lowercase single-word frequency rows, removes function words and invalid forms, prioritizes the original board pool as game-friendly clue seeds, and builds a 30,000-candidate centering corpus. The checked 3,000 and 10,000 clue shards contain transformed words, frequencies, and quantized embeddings. The source archive is cached locally and is not checked into the repository.

### Embedding model

- **Model artifact:** `Xenova/multilingual-e5-small`
- **Revision:** `761b726dd34fb83930e26aab4e9ac3899aa1fa78`
- **q8 model SHA-256:** `f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193`
- **License:** MIT
- **Upstream model:** [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small)

Both clue candidates and board terms use the model's symmetric `query: ` task prefix. Model weights load from Hugging Face into the browser cache and are not checked into this repository.

## Official Italian vocabulary

No official Italian Codenames word list is included. The preset remains unavailable until Cranio Creations or Czech Games Edition supplies the current list with written permission for public redistribution and generated embedding indexes.
