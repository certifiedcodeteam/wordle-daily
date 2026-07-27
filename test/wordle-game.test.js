import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateStats,
  createDefaultState,
  evaluateGuess,
  mergeStates,
  shareText,
  validateHardMode,
} from "../src/lib/wordle/game.js";

test("scores repeated letters only as many times as the answer contains them", () => {
  assert.deepEqual(evaluateGuess("alley", "apple"), ["correct", "present", "absent", "present", "absent"]);
});

test("hard mode requires known positions and revealed letters", () => {
  assert.equal(validateHardMode("caper", ["cable"], "cabin"), "3rd letter must be B");
  assert.equal(validateHardMode("cabin", ["cable"], "cabin"), null);
});

test("merge keeps completed progress over an in-progress copy", () => {
  const local = createDefaultState(new Date("2026-01-02T10:00:00Z"));
  const cloud = createDefaultState(new Date("2026-01-02T11:00:00Z"));
  local.games["2026-01-02"] = { date: "2026-01-02", guesses: ["crane"], status: "won", updatedAt: "2026-01-02T10:00:00Z" };
  cloud.games["2026-01-02"] = { date: "2026-01-02", guesses: ["slate", "proud"], status: "playing", updatedAt: "2026-01-02T11:00:00Z" };
  assert.equal(mergeStates(local, cloud).games["2026-01-02"].status, "won");
});

test("statistics count wins, streaks, and guess distribution", () => {
  const games = {
    one: { date: "2026-01-01", guesses: ["crane", "apple"], status: "won" },
    two: { date: "2026-01-02", guesses: ["brick"], status: "won" },
    three: { date: "2026-01-03", guesses: Array(6).fill("slate"), status: "lost" },
  };
  assert.deepEqual(calculateStats(games, new Date(2026, 0, 3)), {
    played: 3,
    wins: 2,
    winPercentage: 67,
    currentStreak: 0,
    maxStreak: 2,
    distribution: [1, 1, 0, 0, 0, 0],
  });
});

test("share text contains only puzzle metadata and colored result rows", () => {
  const text = shareText({ puzzleNumber: 42, guesses: ["apple"], status: "won", hardMode: true }, "apple");
  assert.equal(text, "Wordle Daily #42 1/6*\n\n🟩🟩🟩🟩🟩");
});
