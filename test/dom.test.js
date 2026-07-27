import assert from "node:assert/strict";
import test from "node:test";
import { shouldIgnoreGlobalKeydown } from "../src/lib/dom.js";

function targetInside(selector) {
  return {
    closest(query) {
      return query.includes(selector) ? {} : null;
    },
  };
}

test("global game shortcuts ignore form and editable controls", () => {
  for (const selector of ["input", "textarea", "select", "button", "a[href]", "[role='textbox']"]) {
    assert.equal(shouldIgnoreGlobalKeydown({ target: targetInside(selector) }), true, selector);
  }
});

test("global game shortcuts ignore editable controls inside a composed path", () => {
  const host = { closest: () => null };
  const input = targetInside("input");
  assert.equal(shouldIgnoreGlobalKeydown({ target: host, composedPath: () => [input, host] }), true);
});

test("global game shortcuts still handle ordinary page key events", () => {
  assert.equal(shouldIgnoreGlobalKeydown({ target: { closest: () => null } }), false);
});

test("global game shortcuts yield to composition and previously handled events", () => {
  assert.equal(shouldIgnoreGlobalKeydown({ isComposing: true }), true);
  assert.equal(shouldIgnoreGlobalKeydown({ defaultPrevented: true }), true);
});
