import { ANSWERS, VALID_GUESSES } from "./words.js";

export const COLS = 5;
export const BASE_GUESSES = 6;
export const DAILY_EPOCH = Date.UTC(2026, 0, 1);

export function utcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function dailyPuzzle(date = new Date()) {
  const day = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - DAILY_EPOCH) / 86400000);
  const index = ((day % ANSWERS.length) + ANSWERS.length) % ANSWERS.length;
  return { key: `daily:${utcDayKey(date)}`, number: day + 1, answer: ANSWERS[index] };
}

export function randomAnswer() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return ANSWERS[bytes[0] % ANSWERS.length];
}

export function isValidGuess(word) {
  return typeof word === "string" && /^[a-z]{5}$/.test(word) && VALID_GUESSES.has(word);
}

export function evaluateGuess(guess, answer) {
  const letters = guess.split("");
  const target = answer.split("");
  const result = Array(COLS).fill("absent");
  const remaining = {};
  target.forEach((letter, index) => {
    if (letters[index] === letter) result[index] = "correct";
    else remaining[letter] = (remaining[letter] || 0) + 1;
  });
  letters.forEach((letter, index) => {
    if (result[index] === "correct") return;
    if ((remaining[letter] || 0) > 0) {
      result[index] = "present";
      remaining[letter] -= 1;
    }
  });
  return result;
}

export function validateHardMode(guess, previousAttempts) {
  const requiredPositions = Array(COLS).fill(null);
  const requiredCounts = {};
  for (const attempt of previousAttempts) {
    const rowCounts = {};
    attempt.evaluation.forEach((status, index) => {
      if (status === "correct") requiredPositions[index] = attempt.word[index];
      if (status !== "absent") rowCounts[attempt.word[index]] = (rowCounts[attempt.word[index]] || 0) + 1;
    });
    for (const [letter, count] of Object.entries(rowCounts)) requiredCounts[letter] = Math.max(requiredCounts[letter] || 0, count);
  }
  for (let index = 0; index < COLS; index += 1) {
    if (requiredPositions[index] && guess[index] !== requiredPositions[index]) return `Position ${index + 1} must be ${requiredPositions[index].toUpperCase()}`;
  }
  for (const [letter, count] of Object.entries(requiredCounts)) {
    if (guess.split(letter).length - 1 < count) return `Guess must contain ${letter.toUpperCase()}`;
  }
  return null;
}

export function levelForXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}

export function dailySettlement(guesses, hardMode = false) {
  const unused = Math.max(0, BASE_GUESSES - guesses);
  return {
    xp: 100 + unused * 10,
    tokens: guesses === 7 ? 10 : 10 + unused * 2 + (hardMode ? 3 : 0),
    leaguePoints: guesses === 7 ? 40 : Math.max(0, 100 - (guesses - 1) * 10) + (hardMode ? 5 : 0),
  };
}

export function rushWordScore(guesses, secondsRemaining) {
  return 1000 + Math.max(0, BASE_GUESSES - guesses) * 100 + Math.max(0, Math.floor(secondsRemaining)) * 5;
}

export function compareDuel(left, right) {
  if (left.solved !== right.solved) return left.solved ? -1 : 1;
  if (left.guesses !== right.guesses) return left.guesses - right.guesses;
  return left.elapsedMs - right.elapsedMs;
}
