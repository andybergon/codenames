# Data licenses and attribution

## Italian Train beta

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
