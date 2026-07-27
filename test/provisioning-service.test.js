import assert from "node:assert/strict";
import test from "node:test";
import { provisionForUser } from "../base44/shared/provisioning-service.js";

test("per-user provisioning uses supported single-user updates", async () => {
  const user = { id: "user-1" };
  const storedUser = { ...user };
  const updates = [];
  let result = null;
  const admin = {
    User: {
      get: async () => ({ ...storedUser }),
      update: async (id, patch) => {
        assert.equal(id, user.id);
        updates.push(patch);
        Object.assign(storedUser, patch);
        return { ...storedUser };
      },
      updateMany: async () => {
        assert.fail("the built-in User entity does not allow bulk updates");
      },
    },
  };

  const provisioned = await provisionForUser({
    admin,
    user,
    scope: "player",
    key: "v1",
    load: async () => result,
    provision: async () => {
      result = { account: { id: "account-1" }, profile: { id: "profile-1" } };
    },
  });

  assert.equal(provisioned, result);
  assert.equal(updates.length, 2);
  assert.equal(updates[0].player_provision_status, "working");
  assert.ok(updates[0].player_provision_token);
  assert.equal(updates[1].player_provision_status, "complete");
  assert.equal(updates[1].player_provision_token, "");
});
