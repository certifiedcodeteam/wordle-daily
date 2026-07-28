import assert from "node:assert/strict";
import test from "node:test";
import {
  deterministicPartySeed,
  fallbackPartyRecap,
  partyCodeFromBytes,
  partyProgressMask,
  partyRoundScore,
  rankPartyParticipants,
  validPartyCode,
} from "../base44/shared/party-engine.js";

test("party scoring rewards accuracy and speed with a floor", () => {
  assert.equal(partyRoundScore({ solved: false, guessesUsed: 1, elapsedMs: 1000 }), 0);
  assert.equal(partyRoundScore({ solved: true, guessesUsed: 1, elapsedMs: 1000 }), 997);
  assert.equal(partyRoundScore({ solved: true, guessesUsed: 6, elapsedMs: 90000 }), 230);
  assert.equal(partyRoundScore({ solved: true, guessesUsed: 20, elapsedMs: 90000 }), 100);
});

test("party ranking applies score, solves, guesses, elapsed, then handle", () => {
  const ranked = rankPartyParticipants([
    { handle: "Zed", total_score: 1000, rounds_solved: 2, total_guesses: 8, total_elapsed_ms: 90000 },
    { handle: "Ari", total_score: 1000, rounds_solved: 2, total_guesses: 7, total_elapsed_ms: 95000 },
    { handle: "Mira", total_score: 1200, rounds_solved: 1, total_guesses: 5, total_elapsed_ms: 60000 },
  ]);
  assert.deepEqual(ranked.map(({ handle, rank }) => [handle, rank]), [["Mira", 1], ["Ari", 2], ["Zed", 3]]);
});

test("party codes exclude ambiguous characters and validate exactly", () => {
  assert.equal(partyCodeFromBytes(new Uint8Array([0, 1, 2, 3, 4, 5])), "ABCDEF");
  assert.equal(validPartyCode("ABC234"), true);
  assert.equal(validPartyCode("ABCI10"), false);
  assert.equal(validPartyCode("SHORT"), false);
});

test("party progress hides letters and deterministic helpers stay stable", () => {
  assert.equal(partyProgressMask(["correct", "present", "absent", "absent", "correct"]), "cpaac");
  assert.equal(deterministicPartySeed("room:player:1"), deterministicPartySeed("room:player:1"));
  const recap = fallbackPartyRecap([{ handle: "Ari", rank: 1, rounds_solved: 2 }]);
  assert.equal(recap.mvp, "Ari");
  assert.equal(recap.summary.includes("2 words"), true);
});
