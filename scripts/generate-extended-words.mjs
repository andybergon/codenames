import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env, pipeline } from "@huggingface/transformers";
import { OFFICIAL_WORDS } from "../src/word-data.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_MANIFEST_PATH = resolve(ROOT, "public/data/model-lab/minilm-l6/manifest.json");
const INDEX_SHARD_PATH = resolve(ROOT, "public/data/model-lab/minilm-l6/clues-0-3000.json");
const OUTPUT_PATH = resolve(ROOT, "src/generated/extended-word-data.js");
const REPORT_PATH = resolve(ROOT, "scripts/generated/extended-word-report.json");
const TARGET_ADDITION_COUNT = 400;
const MAX_REDUNDANCY = 0.8;
const MODEL = "Xenova/all-MiniLM-L6-v2";
const BATCH_SIZE = 64;

const REQUIRED_ADDITIONS = [
  "ANCHOR", "ARMY", "BLACKHOLE", "CASTLE", "ROCKET", "SUBMARINE", "WHEEL",
];

// The model ranks this reviewed universe; it does not get to promote every broad
// English noun. That human guardrail is what keeps "ministry" and "affairs" off
// the board while the scoring below still controls familiarity, ambiguity,
// category balance, and semantic redundancy.
const CURATED_CANDIDATES = {
  people: `
    actor actress acrobat astronaut baker barber captain chef clown coach cowboy
    detective director diver doctor emperor explorer farmer firefighter gardener
    hacker hero inventor judge magician mayor mechanic monk musician ninja nurse
    painter pilot pirate plumber poet professor referee robot sailor samurai sheriff
    singer spy superhero surgeon teacher vampire villain warrior wizard wrestler
  `,
  places: `
    aquarium arcade arena bakery bathroom battlefield bunker cabin campsite castle
    cave cemetery cinema circus desert dungeon factory galaxy garden harbor island
    jungle kingdom laboratory labyrinth lighthouse mall mansion monastery museum
    oasis observatory palace park planet prison pyramid reef restaurant ruins stadium
    station subway swamp temple theater tower tunnel volcano waterfall zoo
  `,
  nature: `
    alpaca avalanche badger beaver blizzard butterfly cactus camel chameleon cobra
    coral dolphin earthquake eclipse flamingo glacier gorilla hamster hedgehog
    jellyfish jungle koala lagoon lava lightning llama lobster meteor monsoon
    narwhal octopus oasis ocean otter owl panda peacock penguin rainbow reef river
    sandstorm shark storm thunder tornado tsunami volcano waterfall whale wildfire
  `,
  objects: `
    backpack balloon binoculars blender boomerang bracelet broom camera candle cannon
    chainsaw compass crystal drone flashlight frisbee guitar hammock helmet joystick
    kettle keyboard ladder lantern magnet microscope microwave mirror needle parachute
    piano skateboard suitcase telescope toaster trampoline umbrella vacuum violin
    wallet wheel whistle zipper hourglass jetpack lockpick megaphone snowglobe
  `,
  science: `
    acid alchemy algorithm android asteroid atom bacteria battery blackhole carbon
    circuit comet computer crystal dna electricity fossil galaxy genetics gravity
    hologram internet laser magnet meteor microscope molecule nebula orbit oxygen
    planet quantum radar reactor robot rocket satellite solar spaceship steam
    submarine telescope time_machine vaccine virus wifi wormhole xray zero
  `,
  culture: `
    arcade avatar ballet cartoon cinema circus comic concert costume dance emoji
    festival graffiti guitar hashtag karaoke magic magazine meme movie museum opera
    orchestra painting photograph piano podcast poetry radio riddle sculpture song
    stage streaming studio tattoo theater trophy video_game violin vinyl whistle
    carnival jukebox mascot musical sketch spotlight
  `,
  fantasy: `
    alchemy alien apocalypse castle centaur chaos dragon dungeon elf fairy genie
    ghost giant goblin griffin kingdom magic magician mermaid monster nightmare oracle
    phoenix potion quest rune spell spirit superhero treasure troll unicorn vampire
    villain wand werewolf wizard zombie labyrinth mythology sorcerer enchanted
    shapeshifter underworld moonlight
  `,
  food: `
    avocado bacon bagel barbecue bakery banana biscuit blender bread burger burrito
    cake candy cereal cheese chili cinnamon coconut coffee cookie croissant cupcake
    curry donut dumpling garlic honey hot_dog jelly ketchup lemon mango mustard noodle
    onion pancake peanut pepper pickle pizza popcorn pumpkin ramen sandwich sausage
    strawberry sushi taco toast waffle watermelon yogurt
  `,
  travel: `
    adventure airport backpack bicycle boat bus camper caravan compass cruise desert
    expedition flight gondola harbor highway island jet jungle lighthouse luggage map
    oasis passport railway road scooter spaceship station submarine subway suitcase
    taxi ticket train tram truck tunnel vacation van vehicle voyage yacht zeppelin
    hitchhiker motel runway safari trail
  `,
  conflict: `
    ambush army armor battle battlefield bomb bunker cannon catapult commander danger
    defense duel enemy escape fortress grenade gun invasion knight missile ninja
    pirate prison rescue riot samurai shield soldier spy sword tank target trap
    warrior weapon airstrike blockade crossbow dynamite hostage mine mutiny rebellion
    siege slingshot smoke threat victory
  `,
  society: `
    academy auction bank bitcoin carnival casino city courtroom crime currency
    detective election empire factory festival hospital hotel internet jail judge jury
    kingdom law library market mayor money museum newspaper office passport police
    prison restaurant school secret shopping stadium tax theater university wedding
    border embassy government lottery parliament protest subway village
  `,
  body: `
    beard belly blood bone brain breath elbow eyebrow face finger footprint hair hand
    heart hip knee leg muscle neck nose pocket pulse scar shadow shoulder skeleton
    skin skull smile spirit stomach tattoo teeth thumb toe tongue tooth voice wink
    wrinkle sneeze sweat tear vision
  `,
  emotion: `
    anger bravery chaos comedy confusion courage curiosity danger dream fear hope joy
    jealousy laughter love luck magic memory mystery nightmare panic peace pride rage
    regret secret shock stress surprise trust wonder wish boredom envy excitement
    friendship happiness humor obsession romance sadness suspense triumph
  `,
  discovery: `
    adventure ancient archaeology artifact cave compass detective discovery expedition
    explorer fossil history invention jungle labyrinth map meteor museum mystery oasis
    observatory oracle planet puzzle pyramid quest research riddle ruins secret space
    telescope tomb treasure unknown voyage wormhole archive clue code journal legend
    relic safari trail treasure_map time_machine
  `,
};

const CATEGORIES = {
  people: ["actor", "doctor", "teacher", "king", "friend", "child"],
  places: ["city", "country", "forest", "beach", "school", "hospital"],
  nature: ["animal", "bird", "fish", "tree", "flower", "weather"],
  objects: ["machine", "tool", "table", "chair", "bottle", "key"],
  science: ["science", "biology", "chemistry", "space", "computer", "technology"],
  culture: ["music", "book", "theater", "film", "artist", "game"],
  fantasy: ["magic", "dragon", "wizard", "monster", "ghost", "legend"],
  food: ["food", "kitchen", "bakery", "fruit", "chocolate", "restaurant"],
  travel: ["travel", "flight", "train", "ship", "car", "ocean"],
  conflict: ["battle", "weapon", "military", "attack", "spy", "danger"],
  society: ["government", "business", "money", "law", "court", "justice"],
  body: ["body", "heart", "hand", "eye", "mouth", "health"],
  emotion: ["love", "happy", "fear", "luck", "dream", "comedy"],
  discovery: ["adventure", "explorer", "mystery", "treasure", "history", "research"],
};

const BLOCKED = new Set(`
able actually ago almost already always american another around asked asking away based
became become becomes becoming believe believed best better called calling came cause causes
certain change changed changes close comes coming community could country course days different
does done early else end enough even ever every everyone everything fact far feel feeling feels
few find first following found four free full general get gets getting give given gives giving
going gone good got great group groups guys hard having help here high hours however important
including information instead john just keep kind known large last later least left less let level
like likely little live local long look looking looks lot made make makes making man many may maybe
mean means members men might million months more most move much must name national need needed needs
never new news next nice night nothing number often old one open order other others part people
person place please point possible pretty probably problem public put question read real really
remember right run said same saw say saying says second see seen series service set several should
show side since single small someone something start started state still stop support sure system
take taking talk tell than thank thanks thing things think thinking thought three time times today
together told took top true try trying two understand united university use used using very video
wait want wanted wants way week well went white whole within women work working world would wrong
year years yes york young
ass asshole bastard bitch bullshit christ christian clue clinton damn elizabeth enemy ford google harry
hell jesus johnson jones lee mary peter rape sex sexual sexy simon suicide thomas tom vagina
target
`.trim().split(/\s+/));

const manifest = JSON.parse(await readFile(INDEX_MANIFEST_PATH, "utf8"));
const shard = JSON.parse(await readFile(INDEX_SHARD_PATH, "utf8"));
const rawIndex = { ...manifest, ...shard };
const encoded = Buffer.from(rawIndex.vectors, "base64");
const vectors = new Int8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);
const dimensions = rawIndex.dimensions;
const clueIndex = new Map(rawIndex.clues.map((word, index) => [word, index]));
const clueSet = new Set(rawIndex.clues);
const official = new Set(OFFICIAL_WORDS.map((word) => word.toLowerCase()));
const categoryEntries = Object.entries(CATEGORIES).map(([name, anchors]) => ({
  name,
  anchors: anchors
    .map((anchor) => clueIndex.get(anchor))
    .filter(Number.isInteger)
    .map(embeddingForIndex),
}));
const curatedEntries = Object.entries(CURATED_CANDIDATES).flatMap(([category, source]) =>
  source.trim().split(/\s+/u).map((word) => ({ category, word: word.replaceAll("_", " ") })),
);
const seenCandidateWords = new Set();
const candidateSpecs = curatedEntries
  .filter(({ word }) => {
    if (seenCandidateWords.has(word) || official.has(word) || BLOCKED.has(word)) return false;
    seenCandidateWords.add(word);
    return true;
  })
  .filter(({ word }) => !isDerivedForm(word));

env.cacheDir = resolve(ROOT, ".cache/huggingface");
env.allowLocalModels = false;
const extractor = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
const rawCandidateEmbeddings = await embedInBatches(
  extractor,
  candidateSpecs.map(({ word }) => word),
);
const candidates = candidateSpecs.map(({ category, word }, index) => {
  const cluePosition = clueIndex.get(word);
  return scoreCandidate({
    category,
    word,
    embedding: centerAndNormalize(rawCandidateEmbeddings[index], rawIndex.centering.mean),
    zipf: Number.isInteger(cluePosition) ? rawIndex.frequencies[cluePosition] : 4,
  });
});

const candidateByWord = new Map(candidates.map((candidate) => [candidate.word, candidate]));
const selected = [];
const selectedWords = new Set();

for (const word of REQUIRED_ADDITIONS.map((word) => word.toLowerCase())) {
  const candidate = candidateByWord.get(word);
  if (candidate) {
    select(candidate, true);
  } else {
    select({
      word,
      category: "curated",
      quality: 1,
      familiarity: 1,
      ambiguity: 1,
      connectivity: 1,
    }, true);
  }
}

const quota = Math.ceil((TARGET_ADDITION_COUNT - REQUIRED_ADDITIONS.length) / categoryEntries.length);
const categoryQueues = new Map(
  categoryEntries.map(({ name }) => [
    name,
    candidates
      .filter((candidate) => candidate.category === name && !selectedWords.has(candidate.word))
      .sort((left, right) => right.quality - left.quality || left.word.localeCompare(right.word)),
  ]),
);

let madeProgress = true;
while (selected.length < TARGET_ADDITION_COUNT && madeProgress) {
  madeProgress = false;
  for (const { name } of categoryEntries) {
    if (selected.length >= TARGET_ADDITION_COUNT) break;
    const categorySelected = selected.filter((candidate) => candidate.category === name);
    if (categorySelected.length >= quota) continue;
    const queue = categoryQueues.get(name);
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (selectedWords.has(candidate.word)) continue;
      const redundancy = maxSimilarity(candidate, categorySelected);
      if (redundancy > MAX_REDUNDANCY) continue;
      select(candidate, false, redundancy);
      madeProgress = true;
      break;
    }
  }
}

if (selected.length < TARGET_ADDITION_COUNT) {
  for (const candidate of [...candidates].sort(
    (left, right) => right.quality - left.quality || left.word.localeCompare(right.word),
  )) {
    if (selected.length >= TARGET_ADDITION_COUNT) break;
    if (!selectedWords.has(candidate.word)) select(candidate);
  }
}

if (selected.length !== TARGET_ADDITION_COUNT) {
  throw new Error(`Expected ${TARGET_ADDITION_COUNT} additions, selected ${selected.length}.`);
}

const additions = selected.map((candidate) => candidate.word.toUpperCase()).sort();
const report = buildReport(selected, candidates.length);
const source = `// Generated by npm run generate:extended. Do not edit manually.\n` +
  `export const CURATED_EXTENDED_ADDITIONS = Object.freeze(${JSON.stringify(additions, null, 2)});\n\n` +
  `export const EXTENDED_WORD_REPORT = Object.freeze(${JSON.stringify(report, null, 2)});\n`;

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await mkdir(dirname(REPORT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, source, "utf8");
await writeFile(
  REPORT_PATH,
  `${JSON.stringify({
    ...report,
    words: selected.map(({ embedding, ...word }) => word),
  }, null, 2)}\n`,
  "utf8",
);

console.log(
  `Selected ${additions.length} additions from ${candidates.length} candidates across ${categoryEntries.length} domains.`,
);
console.log(`Wrote ${OUTPUT_PATH}`);

function isDerivedForm(word) {
  if (word.endsWith("ies") && clueSet.has(`${word.slice(0, -3)}y`)) return true;
  if (word.endsWith("s") && !/(ss|us|is)$/u.test(word) && clueSet.has(word.slice(0, -1))) {
    return true;
  }
  if (word.endsWith("ing") && word.length > 6) {
    const stem = word.slice(0, -3);
    if (clueSet.has(stem) || clueSet.has(`${stem}e`)) return true;
  }
  if (word.endsWith("ed") && word.length > 5) {
    const stem = word.slice(0, -2);
    if (clueSet.has(stem) || clueSet.has(`${stem}e`)) return true;
  }
  if (word.endsWith("ly") && clueSet.has(word.slice(0, -2))) return true;
  return false;
}

function scoreCandidate(candidate) {
  const categoryScores = categoryEntries.map(({ name, anchors }) => ({
    name,
    score: anchors.length > 0
      ? Math.max(...anchors.map((anchor) => cosine(candidate.embedding, anchor)))
      : 0,
  }));
  const sortedScores = [...categoryScores].sort((left, right) => right.score - left.score);
  const categoryFit = categoryScores.find(({ name }) => name === candidate.category)?.score ?? 0;
  const familiarity = Math.exp(-(((candidate.zipf - 4.55) / 0.9) ** 2));
  const associatedDomains = categoryScores.filter(({ score }) => score >= 0.12).length;
  const topAssociation = clamp((average(sortedScores.slice(0, 3).map(({ score }) => score)) - 0.05) / 0.3);
  const connectivity = 0.55 * topAssociation + 0.45 * clamp(associatedDomains / 6);
  const ambiguity = normalizedEntropy(categoryScores.map(({ score }) => score), 0.12) * topAssociation;
  const concreteness = clamp((sortedScores[0].score - 0.05) / 0.35);
  const spread = clamp(associatedDomains / 8);
  const highFrequencyPenalty = clamp((candidate.zipf - 5.25) / 0.3) * 0.18;
  const quality =
    0.24 * familiarity +
    0.18 * connectivity +
    0.23 * ambiguity +
    0.19 * categoryFit +
    0.08 * concreteness +
    0.08 * spread +
    highFrequencyPenalty;
  return {
    ...candidate,
    quality,
    familiarity,
    ambiguity,
    connectivity,
    categoryFit,
    associatedDomains,
  };
}

function select(candidate, required = false, redundancy = 0) {
  if (selectedWords.has(candidate.word) || selected.length >= TARGET_ADDITION_COUNT) return;
  selectedWords.add(candidate.word);
  selected.push({ ...candidate, required, redundancy });
}

function maxSimilarity(candidate, others) {
  let maximum = -1;
  for (const other of others) {
    if (!other.embedding) continue;
    maximum = Math.max(maximum, cosine(candidate.embedding, other.embedding));
  }
  return maximum;
}

function cosine(left, right) {
  let total = 0;
  for (let dimension = 0; dimension < dimensions; dimension += 1) {
    total += left[dimension] * right[dimension];
  }
  return total;
}

function embeddingForIndex(index) {
  const offset = index * dimensions;
  return Array.from(
    { length: dimensions },
    (_, dimension) => vectors[offset + dimension] / rawIndex.quantization.scale,
  );
}

async function embedInBatches(model, terms) {
  const output = [];
  for (let start = 0; start < terms.length; start += BATCH_SIZE) {
    const batch = terms.slice(start, start + BATCH_SIZE);
    const embeddings = await model(batch, { pooling: "mean", normalize: true });
    output.push(...embeddings.tolist());
  }
  return output;
}

function centerAndNormalize(vector, mean) {
  const centered = vector.map((value, index) => value - mean[index]);
  const magnitude = Math.sqrt(centered.reduce((sum, value) => sum + value * value, 0));
  return centered.map((value) => value / magnitude);
}

function normalizedEntropy(values, temperature) {
  const maximum = Math.max(...values);
  const weights = values.map((value) => Math.exp((value - maximum) / temperature));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const entropy = weights.reduce((sum, value) => {
    const probability = value / total;
    return sum - probability * Math.log(probability);
  }, 0);
  return entropy / Math.log(values.length);
}

function buildReport(words, candidateCount) {
  const byCategory = Object.fromEntries(
    [...new Set(words.map((word) => word.category))]
      .sort()
      .map((category) => [category, words.filter((word) => word.category === category).length]),
  );
  return {
    version: 1,
    method: "reviewed playful candidate universe + frequency + embedding association breadth + semantic-domain entropy + balanced domain selection + within-domain redundancy cap",
    candidateCount,
    officialCount: OFFICIAL_WORDS.length,
    additionCount: words.length,
    totalCount: OFFICIAL_WORDS.length + words.length,
    categoryCount: categoryEntries.length,
    byCategory,
    averages: {
      zipf: round(average(words.map((word) => word.zipf).filter(Number.isFinite))),
      quality: round(average(words.map((word) => word.quality))),
      familiarity: round(average(words.map((word) => word.familiarity))),
      ambiguity: round(average(words.map((word) => word.ambiguity))),
      connectivity: round(average(words.map((word) => word.connectivity))),
      categoryFit: round(average(words.map((word) => word.categoryFit).filter(Number.isFinite))),
    },
  };
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value) {
  return Number(value.toFixed(3));
}
