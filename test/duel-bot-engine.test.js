import test from "node:test";
import assert from "node:assert/strict";
import { botPublicState, connectionState, createBotPlan } from "../base44/shared/duel-bot-engine.js";

test("bot plans are deterministic, rating-matched, and monotonic", () => {
  const first = createBotPlan(1080, 4242);
  const second = createBotPlan(1080, 4242);
  assert.deepEqual(first, second);
  assert.ok(first.rating >= 1020 && first.rating <= 1140);
  assert.equal(first.scheduleMs.length, first.targetGuesses);
  first.scheduleMs.forEach((value, index) => {
    assert.ok(value > (first.scheduleMs[index - 1] || 0));
    if (index) assert.ok(value - first.scheduleMs[index - 1] >= 7000);
  });
});

test("bot state reveals only current progress", () => {
  const plan = { willSolve: true, targetGuesses: 3, scheduleMs: [10000, 25000, 40000] };
  const started = new Date("2026-01-01T00:00:00.000Z");
  const state = botPublicState(plan, started, new Date("2026-01-01T00:00:26.000Z"));
  assert.equal(state.guessesUsed, 2);
  assert.equal(state.status, "playing");
  assert.equal(state.liveState, "locked_in");
  assert.equal("scheduleMs" in state, false);
  assert.equal("targetGuesses" in state, false);
});

test("bot terminal state records its result and elapsed time", () => {
  const plan = { willSolve: false, targetGuesses: 6, scheduleMs: [10000, 20000, 30000, 40000, 50000, 60000] };
  const started = new Date("2026-01-01T00:00:00.000Z");
  const state = botPublicState(plan, started, new Date("2026-01-01T00:01:01.000Z"));
  assert.deepEqual(state, { guessesUsed: 6, status: "lost", liveState: "finished", elapsedMs: 60000 });
});

test("presence uses connected and reconnect grace thresholds", () => {
  const now = new Date("2026-01-01T00:00:30.000Z");
  assert.equal(connectionState("2026-01-01T00:00:18.000Z", now), "connected");
  assert.equal(connectionState("2026-01-01T00:00:17.999Z", now), "reconnecting");
  assert.equal(connectionState("2026-01-01T00:00:10.000Z", now), "reconnecting");
  assert.equal(connectionState("2026-01-01T00:00:09.999Z", now), "expired");
});
