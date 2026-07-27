import assert from "node:assert/strict";
import test from "node:test";
import { nicknameValidationError, normalizeNickname, renameCostFor } from "../base44/shared/profile-rules.js";

test("the first nickname change is free and later changes cost 500 coins", () => {
  assert.equal(renameCostFor(0), 0);
  assert.equal(renameCostFor(undefined), 0);
  assert.equal(renameCostFor(1), 500);
  assert.equal(renameCostFor(12), 500);
});

test("nicknames are normalized and restricted to safe display characters", () => {
  assert.equal(normalizeNickname("  Daily   Hero  "), "Daily Hero");
  assert.equal(nicknameValidationError("Daily Hero"), "");
  assert.equal(nicknameValidationError("ab"), "Nickname must be 3 to 20 characters");
  assert.equal(nicknameValidationError("daily.hero"), "Use only letters, numbers, spaces, underscores, or hyphens");
});
