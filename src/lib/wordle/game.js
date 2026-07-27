import { ANSWERS, VALID_GUESSES } from "./words.js";

export const ROWS = 6;
export const COLS = 5;
export const STORAGE_KEY = "wordle-daily-state-v1";
export const STATE_VERSION = 1;
export const PUZZLE_EPOCH = new Date(2026, 0, 1);

const SCORE = { absent: 1, present: 2, correct: 3 };

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseLocalDate(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function dayDifference(from, to) {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / 86400000);
}

export function getPuzzle(date = new Date()) {
  const offset = dayDifference(PUZZLE_EPOCH, date);
  const index = ((offset % ANSWERS.length) + ANSWERS.length) % ANSWERS.length;
  return { answer: ANSWERS[index], number: offset + 1, date: localDateKey(date) };
}

export function evaluateGuess(guess, answer) {
  const letters = guess.toLowerCase().split("");
  const target = answer.toLowerCase().split("");
  const result = Array(COLS).fill("absent");
  const remaining = {};

  target.forEach((letter, index) => {
    if (letters[index] === letter) result[index] = "correct";
    else remaining[letter] = (remaining[letter] || 0) + 1;
  });
  letters.forEach((letter, index) => {
    if (result[index] === "correct") return;
    if (remaining[letter] > 0) {
      result[index] = "present";
      remaining[letter] -= 1;
    }
  });
  return result;
}

export function isValidGuess(word) {
  return VALID_GUESSES.has(word.toLowerCase());
}

export function validateHardMode(guess, guesses, answer) {
  if (!guesses.length) return null;
  const requiredPositions = Array(COLS).fill(null);
  const requiredCounts = {};

  guesses.forEach((previousGuess) => {
    const evaluation = evaluateGuess(previousGuess, answer);
    const rowCounts = {};
    evaluation.forEach((status, index) => {
      if (status === "correct") requiredPositions[index] = previousGuess[index];
      if (status !== "absent") {
        const letter = previousGuess[index];
        rowCounts[letter] = (rowCounts[letter] || 0) + 1;
      }
    });
    Object.entries(rowCounts).forEach(([letter, count]) => {
      requiredCounts[letter] = Math.max(requiredCounts[letter] || 0, count);
    });
  });

  for (let index = 0; index < COLS; index += 1) {
    if (requiredPositions[index] && guess[index] !== requiredPositions[index]) {
      return `${index + 1}${ordinalSuffix(index + 1)} letter must be ${requiredPositions[index].toUpperCase()}`;
    }
  }
  for (const [letter, count] of Object.entries(requiredCounts)) {
    const actual = guess.split(letter).length - 1;
    if (actual < count) return `Guess must contain ${letter.toUpperCase()}`;
  }
  return null;
}

function ordinalSuffix(value) {
  if (value === 1) return "st";
  if (value === 2) return "nd";
  if (value === 3) return "rd";
  return "th";
}

export function keyboardStatuses(guesses, answer) {
  const statuses = {};
  guesses.forEach((guess) => {
    evaluateGuess(guess, answer).forEach((status, index) => {
      const letter = guess[index];
      if (!statuses[letter] || SCORE[status] > SCORE[statuses[letter]]) statuses[letter] = status;
    });
  });
  return statuses;
}

export function createDefaultState(now = new Date()) {
  return {
    version: STATE_VERSION,
    updatedAt: now.toISOString(),
    settingsUpdatedAt: now.toISOString(),
    seenWelcome: false,
    settings: {
      hardMode: false,
      darkMode: typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
      highContrast: false,
      onscreenOnly: false,
      soundEffects: true,
      backgroundMusic: false,
    },
    games: {},
  };
}

export function normalizeState(input) {
  const fallback = createDefaultState();
  if (!input || typeof input !== "object") return fallback;
  return {
    ...fallback,
    ...input,
    version: STATE_VERSION,
    settings: { ...fallback.settings, ...(input.settings || {}) },
    games: input.games && typeof input.games === "object" ? input.games : {},
  };
}

export function createGame(puzzle, now = new Date()) {
  return {
    date: puzzle.date,
    puzzleNumber: puzzle.number,
    guesses: [],
    draft: "",
    status: "playing",
    hardMode: false,
    updatedAt: now.toISOString(),
  };
}

export function mergeStates(localInput, cloudInput) {
  const local = normalizeState(localInput);
  const cloud = normalizeState(cloudInput);
  const games = {};
  const keys = new Set([...Object.keys(cloud.games), ...Object.keys(local.games)]);
  keys.forEach((key) => {
    const left = local.games[key];
    const right = cloud.games[key];
    if (!left) games[key] = right;
    else if (!right) games[key] = left;
    else if (left.status !== "playing" && right.status === "playing") games[key] = left;
    else if (right.status !== "playing" && left.status === "playing") games[key] = right;
    else if ((left.guesses?.length || 0) !== (right.guesses?.length || 0)) {
      games[key] = (left.guesses?.length || 0) > (right.guesses?.length || 0) ? left : right;
    } else games[key] = timestamp(left.updatedAt) >= timestamp(right.updatedAt) ? left : right;
  });

  const localSettingsWin = timestamp(local.settingsUpdatedAt) >= timestamp(cloud.settingsUpdatedAt);
  return {
    version: STATE_VERSION,
    updatedAt: new Date(Math.max(timestamp(local.updatedAt), timestamp(cloud.updatedAt), Date.now())).toISOString(),
    settingsUpdatedAt: localSettingsWin ? local.settingsUpdatedAt : cloud.settingsUpdatedAt,
    seenWelcome: local.seenWelcome || cloud.seenWelcome,
    settings: localSettingsWin ? local.settings : cloud.settings,
    games,
  };
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculateStats(games, now = new Date()) {
  const completed = Object.values(games)
    .filter((game) => game.status === "won" || game.status === "lost")
    .sort((a, b) => a.date.localeCompare(b.date));
  const wins = completed.filter((game) => game.status === "won");
  const distribution = [0, 0, 0, 0, 0, 0];
  wins.forEach((game) => {
    const count = game.guesses?.length || 0;
    if (count >= 1 && count <= ROWS) distribution[count - 1] += 1;
  });

  let maxStreak = 0;
  let rolling = 0;
  let priorDate = null;
  completed.forEach((game) => {
    const date = parseLocalDate(game.date);
    const consecutive = priorDate && dayDifference(priorDate, date) === 1;
    rolling = game.status === "won" ? (consecutive ? rolling + 1 : 1) : 0;
    maxStreak = Math.max(maxStreak, rolling);
    priorDate = date;
  });

  let currentStreak = rolling;
  const last = completed[completed.length - 1];
  if (!last || last.status !== "won" || dayDifference(parseLocalDate(last.date), now) > 1) currentStreak = 0;
  return {
    played: completed.length,
    wins: wins.length,
    winPercentage: completed.length ? Math.round((wins.length / completed.length) * 100) : 0,
    currentStreak,
    maxStreak,
    distribution,
  };
}

export function shareText(game, answer, highContrast = false) {
  const score = game.status === "won" ? game.guesses.length : "X";
  const tiles = highContrast
    ? { correct: "🟧", present: "🟦", absent: "⬛" }
    : { correct: "🟩", present: "🟨", absent: "⬛" };
  const rows = game.guesses.map((guess) =>
    evaluateGuess(guess, answer).map((status) => tiles[status]).join("")
  );
  return `Wordle Daily #${game.puzzleNumber} ${score}/${ROWS}${game.hardMode ? "*" : ""}\n\n${rows.join("\n")}`;
}

export function millisecondsToMidnight(now = new Date()) {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}