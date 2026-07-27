const LEASE_MS = 15000;
const RETRY_DELAYS_MS = [15, 30, 60, 120, 240, 400, 650, 1000];

const SCOPE_FIELDS = {
  player: "player_provision",
  dailyQuests: "daily_quest_provision",
  weeklyQuest: "weekly_quest_provision",
  league: "league_provision",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function leaseFields(scope) {
  const prefix = SCOPE_FIELDS[scope];
  if (!prefix) throw new Error(`Unknown provisioning scope: ${scope}`);
  return {
    key: `${prefix}_key`,
    status: `${prefix}_status`,
    token: `${prefix}_token`,
    claimedAt: `${prefix}_claimed_at`,
  };
}

function isFreshLease(user, fields, now) {
  const claimed = Date.parse(user?.[fields.claimedAt] || "");
  return user?.[fields.status] === "working" && Number.isFinite(claimed) && now - claimed < LEASE_MS;
}

/**
 * Coordinates creation of per-user resources using a lease on User.
 * `load` must return the complete canonical result, or null while provisioning is incomplete.
 */
export async function provisionForUser({ admin, user, scope, key, load, provision, sleepFn = sleep, nowFn = Date.now }) {
  const fields = leaseFields(scope);

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const existing = await load();
    if (existing) return existing;

    const currentUser = await admin.User.get(user.id);
    const now = nowFn();
    if (isFreshLease(currentUser, fields, now)) {
      if (attempt === RETRY_DELAYS_MS.length) break;
      await sleepFn(RETRY_DELAYS_MS[attempt]);
      continue;
    }

    const token = crypto.randomUUID();
    const claimedAt = new Date(now).toISOString();
    await admin.User.update(user.id, {
      [fields.key]: key,
      [fields.status]: "working",
      [fields.token]: token,
      [fields.claimedAt]: claimedAt,
    });
    const claim = await admin.User.get(user.id);

    if (claim?.[fields.token] !== token) {
      if (attempt === RETRY_DELAYS_MS.length) break;
      await sleepFn(RETRY_DELAYS_MS[attempt]);
      continue;
    }

    try {
      await provision();
      const result = await load();
      if (!result) throw new Error(`Provisioning ${scope} did not create its required records`);
      const lease = await admin.User.get(user.id);
      if (lease?.[fields.token] === token) {
        await admin.User.update(user.id, {
          [fields.key]: key,
          [fields.status]: "complete",
          [fields.token]: "",
        });
      }
      return result;
    } catch (error) {
      const lease = await admin.User.get(user.id);
      if (lease?.[fields.token] === token) {
        await admin.User.update(user.id, {
          [fields.status]: "pending",
          [fields.token]: "",
        });
      }
      throw error;
    }
  }

  throw Object.assign(new Error("Player setup is still in progress. Try again."), {
    status: 409,
    code: "provisioning_in_progress",
  });
}

export const PROVISIONING_LEASE_MS = LEASE_MS;
