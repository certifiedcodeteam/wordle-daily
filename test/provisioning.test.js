import assert from "node:assert/strict";
import test from "node:test";
import { provisionForUser } from "../base44/shared/provisioning-service.js";

function userAdmin(initial = {}) {
  const record = { id: "user-1", ...initial };
  return {
    record,
    User: {
      get: async () => ({ ...record }),
      update: async (_id, patch) => {
        Object.assign(record, patch);
        return { ...record };
      },
    },
  };
}

test("ten parallel provisioning calls create one logical resource", async () => {
  const admin = userAdmin();
  let resource = null;
  let creates = 0;
  const run = () => provisionForUser({
    admin,
    user: { id: "user-1" },
    scope: "player",
    key: "v1",
    load: async () => resource,
    provision: async () => {
      creates += 1;
      await new Promise((resolve) => setTimeout(resolve, 3));
      resource = { id: "player-1" };
    },
    sleepFn: () => new Promise((resolve) => setTimeout(resolve, 1)),
  });

  const results = await Promise.all(Array.from({ length: 10 }, run));
  assert.equal(creates, 1);
  assert.deepEqual(new Set(results.map((result) => result.id)), new Set(["player-1"]));
  assert.equal(admin.record.player_provision_status, "complete");
});

test("stale provisioning leases are recovered", async () => {
  const admin = userAdmin({
    player_provision_status: "working",
    player_provision_token: "abandoned",
    player_provision_claimed_at: "2000-01-01T00:00:00.000Z",
  });
  let resource = null;
  const result = await provisionForUser({
    admin,
    user: { id: "user-1" },
    scope: "player",
    key: "v1",
    load: async () => resource,
    provision: async () => { resource = { id: "player-recovered" }; },
  });
  assert.equal(result.id, "player-recovered");
  assert.equal(admin.record.player_provision_status, "complete");
});
