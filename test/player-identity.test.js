import assert from "node:assert/strict";
import test from "node:test";
import { hydratePlayerIdentities } from "../base44/shared/player-identity.js";

test("player identity hydration uses the latest profile for every snapshot row", async () => {
  let receivedQuery;
  const admin = {
    PlayerProfile: {
      filter: async (query) => {
        receivedQuery = query;
        return [{ user_id: "user-1", handle: "Latest name", avatar_url: "https://example.com/latest.webp", avatar_seed: "seed-1" }];
      },
    },
  };
  const records = [
    { id: "entry-1", user_id: "user-1", handle: "Old name", points: 50 },
    { id: "duel-1", user_id: "user-1", handle: "Older name", status: "won" },
    { id: "entry-2", user_id: "user-2", handle: "Profile unavailable", points: 20 },
  ];

  const hydrated = await hydratePlayerIdentities(admin, records);

  assert.deepEqual(receivedQuery, { user_id: { $in: ["user-1", "user-2"] } });
  assert.deepEqual(hydrated[0], {
    ...records[0],
    handle: "Latest name",
    avatar_url: "https://example.com/latest.webp",
    avatar_seed: "seed-1",
  });
  assert.equal(hydrated[1].handle, "Latest name");
  assert.equal(hydrated[1].avatar_url, "https://example.com/latest.webp");
  assert.deepEqual(hydrated[2], records[2]);
  assert.deepEqual(records[0], { id: "entry-1", user_id: "user-1", handle: "Old name", points: 50 });
});
