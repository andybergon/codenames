import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  boardVectorCacheIdentity,
  loadOrCreateBoardVectors,
} from "./benchmark-board-vector-cache.mjs";

const cacheDirectory = await mkdtemp(
  resolve(tmpdir(), "codenames-board-vectors-"),
);
const manifestBytes = Buffer.from("manifest-v1");
const manifest = {
  model: "model",
  modelRevision: "revision",
  taskPrefix: "Document: ",
  dimensions: 2,
  centering: {
    method: "mean-v1",
    mean: [0.1, 0.2],
  },
};
const identity = boardVectorCacheIdentity({
  language: "en",
  wordSet: "official",
  words: ["ALPHA", "BETA"],
  manifestBytes,
  manifest,
});
let creates = 0;
const create = async () => {
  creates += 1;
  return [
    Float32Array.from([0.25, -0.5]),
    Float32Array.from([0.75, 1]),
  ];
};

try {
  const cold = await loadOrCreateBoardVectors({
    cacheDirectory,
    identity,
    create,
  });
  assert.equal(cold.cache, "miss");
  assert.equal(creates, 1);

  const warm = await loadOrCreateBoardVectors({
    cacheDirectory,
    identity,
    create,
  });
  assert.equal(warm.cache, "hit");
  assert.equal(creates, 1);
  assert.deepEqual(
    warm.vectors.map((vector) => [...vector]),
    cold.vectors.map((vector) => [...vector]),
  );

  const changedCenter = boardVectorCacheIdentity({
    language: "en",
    wordSet: "official",
    words: ["ALPHA", "BETA"],
    manifestBytes,
    manifest: {
      ...manifest,
      centering: {
        ...manifest.centering,
        mean: [0.1, 0.3],
      },
    },
  });
  assert.notEqual(changedCenter.key, identity.key);
} finally {
  await rm(cacheDirectory, { recursive: true, force: true });
}

console.log("Benchmark board-vector cache smoke checks passed.");
