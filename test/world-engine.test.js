import test from "node:test";
import assert from "node:assert/strict";
import {
  compareDuel,
  dailyPuzzle,
  dailySettlement,
  evaluateGuess,
  levelForXp,
  rushWordScore,
  utcDayKey,
  validateHardMode,
} from "../base44/shared/game-engine.js";

test("the Daily uses one UTC key regardless of local formatting", () => {
  const before = new Date("2026-07-27T23:59:59Z");
  const after = new Date("2026-07-28T00:00:00Z");
  assert.equal(utcDayKey(before), "2026-07-27");
  assert.notEqual(dailyPuzzle(before).key, dailyPuzzle(after).key);
});

test("server evaluation handles repeated letters", () => {
  assert.deepEqual(evaluateGuess("alley", "apple"), ["correct", "present", "absent", "present", "absent"]);
});

test("daily reward and league formulas include the seventh guess", () => {
  assert.deepEqual(dailySettlement(7, true), { xp: 100, tokens: 10, leaguePoints: 40 });
  assert.deepEqual(dailySettlement(3, true), { xp: 130, tokens: 19, leaguePoints: 85 });
});

test("permanent level curve and Rush score follow the product rules", () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(400), 3);
  assert.equal(rushWordScore(3, 30), 1450);
});

test("duels sort solves before failures, then guesses, then speed", () => {
  const players = [
    { solved: true, guesses: 4, elapsedMs: 20000 },
    { solved: true, guesses: 3, elapsedMs: 50000 },
    { solved: false, guesses: 6, elapsedMs: 120000 },
  ].sort(compareDuel);
  assert.equal(players[0].guesses, 3);
  assert.equal(players[2].solved, false);
});

test("hard mode validates discovered positions and letters", () => {
  const previous = [{ word: "cable", evaluation: evaluateGuess("cable", "cabin") }];
  assert.equal(validateHardMode("caper", previous), "Position 3 must be B");
  assert.equal(validateHardMode("cabin", previous), null);
});
