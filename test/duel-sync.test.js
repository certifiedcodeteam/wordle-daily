import assert from "node:assert/strict";
import test from "node:test";
import { nextDuelSync } from "../src/lib/duel-sync.js";

test("duel sync selects the earliest synchronization point", () => {
  const snapshot = {
    nextSyncAt: "2026-01-01T00:00:20.000Z",
    fallbackAt: "2026-01-01T00:00:08.000Z",
    countdownEndsAt: "2026-01-01T00:00:11.000Z",
    match: { status: "waiting", deadline: "2026-01-01T00:02:11.000Z" },
  };

  assert.deepEqual(nextDuelSync(snapshot), {
    key: snapshot.fallbackAt,
    at: new Date(snapshot.fallbackAt).getTime(),
  });
});

test("duel sync keeps overdue points eligible until consumed", () => {
  const snapshot = {
    nextSyncAt: "2026-01-01T00:00:20.000Z",
    match: { status: "active", deadline: "2026-01-01T00:02:00.000Z" },
  };
  const consumed = new Set([snapshot.nextSyncAt]);

  assert.deepEqual(nextDuelSync(snapshot, consumed), {
    key: snapshot.match.deadline,
    at: new Date(snapshot.match.deadline).getTime(),
  });
  consumed.add(snapshot.match.deadline);
  assert.equal(nextDuelSync(snapshot, consumed), null);
});

test("duel sync ignores invalid timestamps and duplicate deadlines", () => {
  const timestamp = "2026-01-01T00:00:20.000Z";
  const snapshot = { nextSyncAt: "invalid", fallbackAt: timestamp, match: { status: "active", deadline: timestamp } };

  assert.deepEqual(nextDuelSync(snapshot), { key: timestamp, at: new Date(timestamp).getTime() });
});

test("active duel ignores expired matchmaking and countdown timestamps", () => {
  const snapshot = {
    nextSyncAt: "2026-01-01T00:00:40.000Z",
    fallbackAt: "2026-01-01T00:00:08.000Z",
    countdownEndsAt: "2026-01-01T00:00:11.000Z",
    match: { status: "active", deadline: "2026-01-01T00:02:11.000Z" },
  };

  assert.deepEqual(nextDuelSync(snapshot), {
    key: snapshot.nextSyncAt,
    at: new Date(snapshot.nextSyncAt).getTime(),
  });
});

test("completed duel has no synchronization deadline", () => {
  const snapshot = {
    nextSyncAt: "2026-01-01T00:00:40.000Z",
    match: { status: "complete", deadline: "2026-01-01T00:02:11.000Z" },
  };

  assert.equal(nextDuelSync(snapshot), null);
});
