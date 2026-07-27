import assert from "node:assert/strict";
import test from "node:test";
import { repairDuplicatePlayerData, repairMergers } from "../base44/shared/repair-service.js";

test("account repair keeps maximum progression and never sums currency", () => {
  const merged = repairMergers.mergeAccount([
    { token_balance: 90, xp_total: 120, achievements: [], applied_operation_keys: ["a"], updated_date: "2026-01-01" },
    { token_balance: 70, xp_total: 200, applied_operation_keys: ["b"], updated_date: "2026-02-01" },
  ]);
  assert.equal(merged.token_balance, 90);
  assert.equal(merged.xp_total, 200);
  assert.deepEqual(merged.applied_operation_keys.sort(), ["a", "b"]);
});

test("repair dry-run reports duplicates without mutation and apply removes extras", async () => {
  const rowsByEntity = {
    PlayerAccount: [
      { id: "a1", user_id: "u1", token_balance: 10, created_date: "2026-01-01" },
      { id: "a2", user_id: "u1", token_balance: 20, created_date: "2026-01-02" },
    ],
    PlayerProfile: [], LeagueMembership: [], LeaderboardEntry: [], PlayerQuest: [],
  };
  const mutations = [];
  const admin = Object.fromEntries(Object.entries(rowsByEntity).map(([name, rows]) => [name, {
    list: async () => rows,
    update: async (id, patch) => mutations.push({ type: "update", name, id, patch }),
    delete: async (id) => mutations.push({ type: "delete", name, id }),
  }]));

  const dryRun = await repairDuplicatePlayerData(admin);
  assert.deepEqual(dryRun.entities.PlayerAccount, { groups: 1, duplicates: 1 });
  assert.equal(mutations.length, 0);

  await repairDuplicatePlayerData(admin, { apply: true });
  assert.equal(mutations.filter((item) => item.type === "update").length, 1);
  assert.deepEqual(mutations.find((item) => item.type === "delete"), { type: "delete", name: "PlayerAccount", id: "a2" });
  assert.equal(mutations[0].patch.token_balance, 20);
});

