import assert from "node:assert/strict";
import test from "node:test";
import { applyEntityOperation, runWalletDelivery } from "../base44/shared/delivery-service.js";
import { canAccessSession } from "../base44/shared/session-access.js";
import { claimGuestDaily } from "../base44/shared/session-claim.js";
import { dailyPuzzle } from "../base44/shared/game-engine.js";

test("guest sessions are available only to unauthenticated callers", () => {
  assert.equal(canAccessSession({ guest: true, owner_user_id: "" }, null), true);
  assert.equal(canAccessSession({ guest: true, owner_user_id: "" }, { id: "user-1" }), false);
  assert.equal(canAccessSession({ guest: false, owner_user_id: "user-1" }, { id: "user-1" }), true);
  assert.equal(canAccessSession({ guest: false, owner_user_id: "user-1" }, { id: "user-2" }), false);
  assert.equal(canAccessSession({ guest: false, owner_user_id: "user-1" }, null), false);
});

test("claiming a guest Daily transfers the session, attempts, and account link", async () => {
  const session = {
    id: "guest-session-1",
    guest: true,
    owner_user_id: "",
    mode: "daily",
    puzzle_key: dailyPuzzle(new Date()).key,
    status: "playing",
  };
  const account = { id: "account-1", user_id: "user-1", xp_total: 0 };
  const profile = { id: "profile-1", user_id: "user-1" };
  const updates = [];
  const admin = {
        GameSession: {
          get: async () => ({ ...session }),
          updateMany: async (query, update) => {
            updates.push({ entity: "session", query, update });
            Object.assign(session, update.$set);
            return { updated: 1 };
          },
        },
        GuessAttempt: {
          updateMany: async (query, update) => {
            updates.push({ entity: "attempt", query, update });
            return { updated: 2 };
          },
        },
        PlayerAccount: {
          filter: async () => [account],
          update: async (id, update) => {
            updates.push({ entity: "account", id, update });
            return { ...account, ...update };
          },
        },
        PlayerProfile: { filter: async () => [profile] },
  };

  const result = await claimGuestDaily({
    admin,
    user: { id: "user-1", email: "player@example.com" },
    sessionId: session.id,
    currentDailyKey: session.puzzle_key,
    getPlayer: async () => ({ account, profile }),
    settleWonSession: async () => null,
  });

  assert.deepEqual(result, { claimed: true, sessionId: session.id, status: "playing", rewards: undefined });
  assert.equal(session.guest, false);
  assert.equal(session.owner_user_id, "user-1");
  assert.deepEqual(updates.at(-1), {
    entity: "account",
    id: "account-1",
    update: { daily_session_key: session.puzzle_key, daily_session_id: session.id },
  });
});

test("entity operations atomically guard and record an operation key", async () => {
  let received;
  const entity = {
    updateMany: async (query, update) => {
      received = { query, update };
      return { updated: 1 };
    },
  };

  await applyEntityOperation(entity, "profile-1", "reward-1", {
    $inc: { games_won: 1 },
    $addToSet: { achievements: "first-win" },
  });

  assert.deepEqual(received, {
    query: { id: "profile-1", applied_operation_keys: { $nin: ["reward-1"] } },
    update: {
      $inc: { games_won: 1 },
      $addToSet: { achievements: "first-win", applied_operation_keys: "reward-1" },
    },
  });
});

test("wallet delivery runs once and records completion", async () => {
  const transaction = { id: "txn-1", delivery_status: "pending", created_date: new Date().toISOString() };
  const accountUpdates = [];
  const admin = {
    WalletTransaction: {
      get: async () => ({ ...transaction }),
      update: async (_id, patch) => Object.assign(transaction, patch),
      updateMany: async (query, update) => {
        if (transaction.delivery_status !== query.delivery_status) return { updated: 0 };
        Object.assign(transaction, update.$set);
        return { updated: 1 };
      },
    },
    PlayerAccount: {
      updateMany: async (query, update) => {
        accountUpdates.push({ query, update });
        return { updated: 1 };
      },
    },
  };
  let deliveries = 0;
  const wallet = { transactionId: transaction.id };

  assert.equal(await runWalletDelivery(admin, "account-1", "reward-1", wallet, async () => { deliveries += 1; }), true);
  assert.equal(await runWalletDelivery(admin, "account-1", "reward-1", wallet, async () => { deliveries += 1; }), false);
  assert.equal(deliveries, 1);
  assert.equal(transaction.delivery_status, "complete");
  assert.deepEqual(accountUpdates[0].query, { id: "account-1", last_operation_key: "reward-1" });
});

test("stale wallet delivery claims can be recovered", async () => {
  const transaction = { id: "txn-2", delivery_status: "delivering", updated_date: "2000-01-01T00:00:00.000Z" };
  const admin = {
    WalletTransaction: {
      get: async () => ({ ...transaction }),
      update: async (_id, patch) => Object.assign(transaction, patch),
      updateMany: async (query, update) => {
        if (transaction.delivery_status !== query.delivery_status) return { updated: 0 };
        Object.assign(transaction, update.$set);
        return { updated: 1 };
      },
    },
    PlayerAccount: { updateMany: async () => ({ updated: 1 }) },
  };
  let delivered = false;

  await runWalletDelivery(admin, "account-2", "reward-2", { transactionId: transaction.id }, async () => { delivered = true; });

  assert.equal(delivered, true);
  assert.equal(transaction.delivery_status, "complete");
});
