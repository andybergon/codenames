#!/usr/bin/env python3

import argparse
import json
from pathlib import Path
import time

import mlx.core as mx
import numpy as np
from mlx_embeddings import generate, load


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--experiment-dir", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--dimensions", type=int, required=True)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--chunk-size", type=int, default=512)
    parser.add_argument("--max-length", type=int, default=64)
    parser.add_argument("--prefix", default="")
    return parser.parse_args()


def chunk_path(directory, start, end):
    return directory / f"{start:06d}-{end:06d}.f32"


def normalize(rows):
    norms = np.linalg.norm(rows, axis=1, keepdims=True)
    norms[norms == 0] = 1
    return rows / norms


args = parse_args()
prefix = args.prefix.replace("\\n", "\n")
experiment_dir = Path(args.experiment_dir)
terms_data = json.loads((experiment_dir / "terms.json").read_text())
terms = terms_data["terms"]
vector_dir = experiment_dir / "vectors"
vector_dir.mkdir(parents=True, exist_ok=True)

model, tokenizer = load(args.model)
started_at = time.monotonic()

for chunk_start in range(0, len(terms), args.chunk_size):
    chunk_end = min(chunk_start + args.chunk_size, len(terms))
    path = chunk_path(vector_dir, chunk_start, chunk_end)
    expected_bytes = (chunk_end - chunk_start) * args.dimensions * 4
    if path.exists() and path.stat().st_size == expected_bytes:
        continue

    chunk_rows = []
    for batch_start in range(chunk_start, chunk_end, args.batch_size):
        batch_end = min(batch_start + args.batch_size, chunk_end)
        batch_terms = [
            f"{prefix}{term}" for term in terms[batch_start:batch_end]
        ]
        output = generate(
            model,
            tokenizer,
            batch_terms,
            max_length=args.max_length,
        )
        embeddings = output.text_embeds
        mx.eval(embeddings)
        rows = np.asarray(embeddings, dtype=np.float32)
        if rows.shape[1] < args.dimensions:
            raise ValueError(
                f"Model returned {rows.shape[1]} dimensions, expected at least "
                f"{args.dimensions}."
            )
        chunk_rows.append(normalize(rows[:, : args.dimensions]))

    np.concatenate(chunk_rows, axis=0).astype("<f4").tofile(path)
    elapsed = time.monotonic() - started_at
    print(
        f"Embedded {chunk_end:,}/{len(terms):,} terms in {elapsed:.1f}s.",
        flush=True,
    )

metadata = {
    "version": 1,
    "provider": args.provider,
    "model": args.model,
    "dimensions": args.dimensions,
    "inputHash": terms_data["inputHash"],
    "termCount": len(terms),
    "availableTermCount": len(terms),
    "missingTerms": [],
    "runtime": "mlx-embeddings",
    "prefix": prefix or None,
    "elapsedSeconds": round(time.monotonic() - started_at, 3),
}
(experiment_dir / "vector-metadata.json").write_text(
    json.dumps(metadata, indent=2) + "\n"
)
print(f"Wrote local embeddings to {experiment_dir}.")
