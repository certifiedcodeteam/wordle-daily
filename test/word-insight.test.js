import assert from "node:assert/strict";
import test from "node:test";
import {
  assertWordInsightAccess, isWordInsight, publicWordInsight,
} from "../base44/shared/word-insight-rules.js";

const completed = {
  id: "session-1", owner_user_id: "u1", guest: false, mode: "daily",
  status: "won", guesses_used: 4, max_guesses: 6,
};

test("word details reject active, unauthorized, and seventh-guess sessions", () => {
  assert.throws(
    () => assertWordInsightAccess({ ...completed, status: "playing" }, { id: "u1" }),
    (error) => error.code === "round_incomplete",
  );
  assert.throws(
    () => assertWordInsightAccess(completed, { id: "u2" }),
    (error) => error.code === "not_found",
  );
  assert.throws(
    () => assertWordInsightAccess({ ...completed, status: "lost", guesses_used: 6 }, { id: "u1" }),
    (error) => error.code === "extra_guess_available",
  );
  assert.doesNotThrow(() => assertWordInsightAccess(completed, { id: "u1" }));
});

test("word detail output must contain every non-empty structured field", () => {
  const generated = {
    partOfSpeech: "noun", pronunciation: "krayn", definition: "A machine for lifting.",
    example: "The crane lifted the beam.", origin: "From Old English.", usageNote: "Also names a bird.",
  };
  assert.equal(isWordInsight(generated), true);
  assert.equal(isWordInsight({ ...generated, origin: "" }), false);
});

test("public word details expose no prompts or cache internals", () => {
  const result = publicWordInsight({
    word: "crane", part_of_speech: "noun", pronunciation: "krayn", definition: "A lifting machine.",
    example: "The crane moved steel.", origin: "Old English.", usage_note: "Also a bird.", schema_version: 1,
  });
  assert.deepEqual(Object.keys(result), [
    "word", "partOfSpeech", "pronunciation", "definition", "example", "origin", "usageNote", "generatedBy",
  ]);
  assert.equal(result.generatedBy, "base44-ai");
});

