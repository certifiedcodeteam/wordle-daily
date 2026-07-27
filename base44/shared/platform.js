import { createClientFromRequest } from "npm:@base44/sdk";
import { levelForXp, utcDayKey } from "./game-engine.js";
import { provisionForUser } from "./provisioning-service.js";
export {
  applyEntityOperation,
  completeWalletOperation,
  findPendingWalletOperation,
  runWalletDelivery,
} from "./delivery-service.js";

export function clientFor(req) {
  return createClientFromRequest(req);
}

export async function optionalUser(base44) {
  try { return await base44.auth.me(); } catch { return null; }
}

export function jsonError(message, status = 400, code = "invalid_request") {
  return Response.json({ error: message, code }, { status });
}

export async function requireUser(base44) {
  const user = await optionalUser(base44);
  if (!user) throw Object.assign(new Error("Sign in required"), { status: 401, code: "auth_required" });
  return user;
}

export async function getOrCreatePlayer(base44, user) {
  const admin = base44.asServiceRole.entities;
  const base = (user.full_name || user.email?.split("@")[0] || "player").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16) || "player";
  const load = async () => {
    const [accounts, profiles] = await Promise.all([
      admin.PlayerAccount.filter({ user_id: user.id }, "created_date", 1),
      admin.PlayerProfile.filter({ user_id: user.id }, "created_date", 1),
    ]);
    return accounts[0] && profiles[0] ? { account: accounts[0], profile: profiles[0] } : null;
  };
  return await provisionForUser({
    admin, user, scope: "player", key: "v1", load,
    provision: async () => {
      const accounts = await admin.PlayerAccount.filter({ user_id: user.id }, "created_date", 1);
      const account = accounts[0] || await admin.PlayerAccount.create({
        user_id: user.id, xp_total: 0, token_balance: 0, wallet_version: 0,
        current_streak: 0, max_streak: 0, streak_shields: 0, daily_counters: {}, settings: {},
        applied_operation_keys: [], last_operation_delivered: true,
      });
      const profiles = await admin.PlayerProfile.filter({ user_id: user.id }, "created_date", 1);
      if (!profiles[0]) await admin.PlayerProfile.create({
        user_id: user.id, handle: `${base}${user.id.slice(-4)}`, avatar_seed: user.id,
        rename_count: 0, level: levelForXp(account.xp_total), peak_division: "bronze", games_played: 0, games_won: 0, achievements: [], applied_operation_keys: [],
      });
    },
  });
}

export async function mutateWallet(base44, account, { operationKey, delta, reason, referenceId = "", xp = 0 }) {
  const admin = base44.asServiceRole.entities;
  const existing = await admin.WalletTransaction.filter({ user_id: account.user_id, operation_key: operationKey }, "-created_date", 1);
  if (existing[0]) return walletResult(existing[0], true);
  if (account.last_operation_key === operationKey) {
    const transaction = await admin.WalletTransaction.create({
      user_id: account.user_id,
      operation_key: operationKey,
      reason: account.last_operation_reason || reason,
      delta: account.last_operation_result?.delta ?? delta,
      xp: account.last_operation_result?.xp ?? xp,
      resulting_balance: account.last_operation_result?.tokenBalance ?? account.token_balance,
      resulting_level: account.last_operation_result?.level ?? levelForXp(account.xp_total),
      reference_id: account.last_operation_reference_id || referenceId,
      delivery_status: account.last_operation_delivered ? "complete" : "pending",
    });
    return walletResult(transaction, true);
  }
  if (account.token_balance + delta < 0) throw Object.assign(new Error("Not enough tokens"), { status: 409, code: "insufficient_tokens" });
  const result = { tokenBalance: account.token_balance + delta, delta, xp, level: levelForXp(account.xp_total + xp) };
  const changed = await admin.PlayerAccount.updateMany(
    { id: account.id, wallet_version: account.wallet_version },
    {
      $set: {
        token_balance: result.tokenBalance,
        xp_total: account.xp_total + xp,
        last_operation_key: operationKey,
        last_operation_result: result,
        last_operation_reason: reason,
        last_operation_reference_id: referenceId,
        last_operation_delivered: false,
      },
      $inc: { wallet_version: 1 },
    },
  );
  if (!changed.updated) {
    const fresh = await admin.PlayerAccount.get(account.id);
    if (fresh.last_operation_key === operationKey) return await mutateWallet(base44, fresh, { operationKey, delta, reason, referenceId, xp });
    throw Object.assign(new Error("Account changed; retry this action"), { status: 409, code: "version_conflict" });
  }
  const transaction = await admin.WalletTransaction.create({
    user_id: account.user_id, operation_key: operationKey, reason, delta, xp,
    resulting_balance: result.tokenBalance, resulting_level: result.level,
    reference_id: referenceId, delivery_status: "pending",
  });
  return walletResult(transaction, false);
}

function walletResult(transaction, duplicate) {
  return {
    tokenBalance: transaction.resulting_balance,
    delta: transaction.delta,
    xp: transaction.xp || 0,
    level: transaction.resulting_level,
    transactionId: transaction.id,
    deliveryStatus: transaction.delivery_status || "complete",
    duplicate,
  };
}

export async function ensureDailyQuests(base44, userId, dayKey = utcDayKey()) {
  const admin = base44.asServiceRole.entities;
  const user = await admin.User.get(userId);
  const questTemplates = [
    { quest_key: "daily_play", title: "Finish today's Daily", target: 1, reward_tokens: 10 },
    { quest_key: "solve_two", title: "Solve two words", target: 2, reward_tokens: 20 },
    { quest_key: "hard_win", title: "Win once in Hard Mode", target: 1, reward_tokens: 20 },
  ];
  const load = async () => {
    const rows = await admin.PlayerQuest.filter({ user_id: userId, period_key: dayKey }, "created_date", 20);
    const byKey = new Map(rows.map((row) => [row.quest_key, row]));
    return questTemplates.every((template) => byKey.has(template.quest_key))
      ? questTemplates.map((template) => byKey.get(template.quest_key))
      : null;
  };
  return await provisionForUser({
    admin, user, scope: "dailyQuests", key: dayKey, load,
    provision: async () => {
      const rows = await admin.PlayerQuest.filter({ user_id: userId, period_key: dayKey }, "created_date", 20);
      const existingKeys = new Set(rows.map((row) => row.quest_key));
      const missing = questTemplates.filter((template) => !existingKeys.has(template.quest_key));
      if (missing.length) await admin.PlayerQuest.bulkCreate(missing.map((template) => ({
        user_id: userId, period_key: dayKey, ...template, progress: 0, claimed: false, rerolled: false, applied_operation_keys: [],
      })));
    },
  });
}

export function utcWeekKey(date = new Date()) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() - weekday + 1);
  return `week:${day.toISOString().slice(0, 10)}`;
}

export async function ensureWeeklyQuest(base44, userId) {
  const admin = base44.asServiceRole.entities;
  const periodKey = utcWeekKey();
  const user = await admin.User.get(userId);
  const load = async () => (await admin.PlayerQuest.filter({ user_id: userId, period_key: periodKey, quest_key: "weekly_wins" }, "created_date", 1))[0] || null;
  return await provisionForUser({
    admin, user, scope: "weeklyQuest", key: periodKey, load,
    provision: async () => {
      if (!await load()) await admin.PlayerQuest.create({ user_id: userId, period_key: periodKey, quest_key: "weekly_wins", title: "Win ten games this week", target: 10, progress: 0, reward_tokens: 50, claimed: false, rerolled: false, applied_operation_keys: [] });
    },
  });
}

export function handleFunctionError(error) {
  console.error(JSON.stringify({ event: "function_error", message: error?.message, code: error?.code }));
  return jsonError(error?.message || "Unexpected server error", error?.status || 500, error?.code || "server_error");
}
