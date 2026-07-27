import assert from "node:assert/strict";
import test from "node:test";

import * as backendWords from "../base44/shared/words.js";
import * as frontendWords from "../src/lib/wordle/words.js";

test("frontend and backend word lists stay synchronized", () => {
  assert.deepEqual(frontendWords.ANSWERS, backendWords.ANSWERS);
  assert.deepEqual(frontendWords.EXTRA_GUESSES, backendWords.EXTRA_GUESSES);
});

test("word-list invariants hold", () => {
  assert.equal(frontendWords.ANSWERS.length, 900);
  assert.ok(frontendWords.VALID_GUESSES.size >= 12_000);
  assert.ok(frontendWords.ANSWERS.every((word) => /^[a-z]{5}$/.test(word)));
  assert.ok([...frontendWords.VALID_GUESSES].every((word) => /^[a-z]{5}$/.test(word)));
  assert.ok(frontendWords.ANSWERS.every((word) => frontendWords.VALID_GUESSES.has(word)));
});
