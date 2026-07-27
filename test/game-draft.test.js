import assert from "node:assert/strict";
import test from "node:test";
import { updateGameDraft } from "../src/lib/game-draft.js";

test("rapid keys build CRANE synchronously before immediate submit", () => {
  const draftRef = { current: "" };
  for (const key of ["C", "R", "A", "N", "E"]) {
    draftRef.current = updateGameDraft(draftRef.current, key);
  }
  assert.equal(draftRef.current, "crane");
  assert.equal(draftRef.current.length, 5);
});

test("draft input caps at five letters and backspace is synchronous", () => {
  let draft = "crane";
  draft = updateGameDraft(draft, "s");
  assert.equal(draft, "crane");
  draft = updateGameDraft(draft, "Backspace");
  assert.equal(draft, "cran");
});

