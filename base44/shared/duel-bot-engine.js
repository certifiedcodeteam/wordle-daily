const PERSONAS = [
  { key: "mira", handle: "Mira Vale", avatarSeed: "mira-vale", division: "silver" },
  { key: "sol", handle: "Sol Mercer", avatarSeed: "sol-mercer", division: "gold" },
  { key: "niko", handle: "Niko Reed", avatarSeed: "niko-reed", division: "bronze" },
  { key: "imani", handle: "Imani Cross", avatarSeed: "imani-cross", division: "gold" },
  { key: "bea", handle: "Bea North", avatarSeed: "bea-north", division: "silver" },
  { key: "cass", handle: "Cass Rowan", avatarSeed: "cass-rowan", division: "platinum" },
  { key: "ren", handle: "Ren Atlas", avatarSeed: "ren-atlas", division: "silver" },
  { key: "tala", handle: "Tala Quinn", avatarSeed: "tala-quinn", division: "gold" },
  { key: "omar", handle: "Omar Finch", avatarSeed: "omar-finch", division: "bronze" },
  { key: "juno", handle: "Juno Park", avatarSeed: "juno-park", division: "platinum" },
  { key: "lane", handle: "Lane Ellis", avatarSeed: "lane-ellis", division: "silver" },
  { key: "sana", handle: "Sana Bloom", avatarSeed: "sana-bloom", division: "gold" },
];

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedChoice(random, values) {
  const roll = random();
  let total = 0;
  for (const [value, weight] of values) {
    total += weight;
    if (roll < total) return value;
  }
  return values.at(-1)[0];
}

function difficultyFor(rating) {
  if (rating < 900) return { failChance: 0.2, guesses: [[5, 0.5], [6, 0.5]], finish: [85000, 110000] };
  if (rating < 1100) return { failChance: 0.12, guesses: [[4, 0.25], [5, 0.5], [6, 0.25]], finish: [70000, 100000] };
  if (rating < 1300) return { failChance: 0.08, guesses: [[3, 0.2], [4, 0.55], [5, 0.25]], finish: [55000, 85000] };
  return { failChance: 0.04, guesses: [[3, 0.45], [4, 0.45], [5, 0.1]], finish: [40000, 70000] };
}

export function createBotPlan(playerRating, seed) {
  const random = mulberry32(seed);
  const persona = PERSONAS[Math.floor(random() * PERSONAS.length)];
  const rating = Math.max(600, playerRating + Math.floor(random() * 121) - 60);
  const difficulty = difficultyFor(rating);
  const willSolve = random() >= difficulty.failChance;
  const targetGuesses = willSolve ? weightedChoice(random, difficulty.guesses) : 6;
  const finishMs = Math.round(difficulty.finish[0] + random() * (difficulty.finish[1] - difficulty.finish[0]));
  const scheduleMs = [];
  for (let index = 1; index <= targetGuesses; index += 1) {
    const ideal = 9000 + ((finishMs - 9000) * index) / targetGuesses;
    const jitter = index === targetGuesses ? 0 : Math.round((random() - 0.5) * 6000);
    scheduleMs.push(Math.max((scheduleMs.at(-1) || 0) + 7000, Math.round(ideal + jitter)));
  }
  scheduleMs[scheduleMs.length - 1] = finishMs;
  return {
    personaKey: persona.key,
    handle: persona.handle,
    avatarSeed: persona.avatarSeed,
    division: persona.division,
    rating,
    willSolve,
    targetGuesses,
    scheduleMs,
  };
}

export function botPublicState(plan, startedAt, now = new Date()) {
  const startedMs = new Date(startedAt).getTime();
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const elapsed = nowMs - startedMs;
  if (elapsed < 0) return { guessesUsed: 0, status: "playing", liveState: "ready", nextUpdateAt: new Date(startedMs).toISOString() };
  const guessesUsed = plan.scheduleMs.filter((milestone) => milestone <= elapsed).length;
  const finished = guessesUsed >= plan.targetGuesses;
  if (finished) {
    return {
      guessesUsed,
      status: plan.willSolve ? "won" : "lost",
      liveState: plan.willSolve ? "solved" : "finished",
      elapsedMs: plan.scheduleMs.at(-1),
    };
  }
  const previous = guessesUsed ? plan.scheduleMs[guessesUsed - 1] : -Infinity;
  const next = plan.scheduleMs[guessesUsed];
  const liveState = elapsed - previous < 1200 ? "locked_in" : next - elapsed <= 2000 ? "typing" : "thinking";
  const transitionMs = liveState === "locked_in" ? previous + 1200 : liveState === "typing" ? next : next - 2000;
  return {
    guessesUsed,
    status: "playing",
    liveState,
    nextUpdateAt: new Date(startedMs + transitionMs).toISOString(),
  };
}

export function connectionState(lastSeenAt, now = new Date()) {
  if (!lastSeenAt) return "offline";
  const age = (now instanceof Date ? now.getTime() : new Date(now).getTime()) - new Date(lastSeenAt).getTime();
  if (age <= 12000) return "connected";
  if (age <= 20000) return "reconnecting";
  return "expired";
}

export function randomBotSeed() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0];
}
