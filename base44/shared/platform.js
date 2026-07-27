import { createClientFromRequest } from "npm:@base44/sdk";
import { levelForXp, utcDayKey } from "./game-engine.js";

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
  const accounts = await admin.PlayerAccount.filter({ user_id: user.id }, "-created_date", 1);
  const profiles = await admin.PlayerProfile.filter({ user_id: user.id }, "-created_date", 1);
  const base = (user.full_name || user.email?.split("@")[0] || "player").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16) || "player";
  const account = accounts[0] || await admin.PlayerAccount.create({
    user_id: user.id, xp_total: 0, token_balance: 0, wallet_version: 0,
    current_streak: 0, max_streak: 0, streak_shields: 0, daily_counters: {}, settings: {},
  });
  const profile = profiles[0] || await admin.PlayerProfile.create({
    user_id: user.id, handle: `${base}${user.id.slice(-4)}`, avatar_seed: user.id,
    rename_count: 0, level: levelForXp(account.xp_total), peak_division: "bronze", games_played: 0, games_won: 0, achievements: [],
  });
  return { account, profile };
}

export async function mutateWallet(base44, account, { operationKey, delta, reason, referenceId = "", xp = 0 }) {
  const admin = base44.asServiceRole.entities;
  if (account.last_operation_key === operationKey) return account.last_operation_result;
  const existing = await admin.WalletTransaction.filter({ user_id: account.user_id, operation_key: operationKey }, "-created_date", 1);
  if (existing[0]) return { tokenBalance: existing[0].resulting_balance, delta: existing[0].delta, duplicate: true };
  if (account.token_balance + delta < 0) throw Object.assign(new Error("Not enough tokens"), { status: 409, code: "insufficient_tokens" });
  const result = { tokenBalance: account.token_balance + delta, delta, xp, level: levelForXp(account.xp_total + xp) };
  const changed = await admin.PlayerAccount.updateMany(
    { id: account.id, wallet_version: account.wallet_version },
    { $set: { token_balance: result.tokenBalance, xp_total: account.xp_total + xp, last_operation_key: operationKey, last_operation_result: result }, $inc: { wallet_version: 1 } },
  );
  if (!changed.updated) {
    const fresh = await admin.PlayerAccount.get(account.id);
    if (fresh.last_operation_key === operationKey) return fresh.last_operation_result;
    throw Object.assign(new Error("Account changed; retry this action"), { status: 409, code: "version_conflict" });
  }
  await admin.WalletTransaction.create({ user_id: account.user_id, operation_key: operationKey, reason, delta, resulting_balance: result.tokenBalance, reference_id: referenceId });
  return result;
}

export async function ensureDailyQuests(base44, userId, dayKey = utcDayKey()) {
  const admin = base44.asServiceRole.entities;
  const existing = await admin.PlayerQuest.filter({ user_id: userId, period_key: dayKey }, "created_date", 10);
  if (existing.length) return existing;
  return await admin.PlayerQuest.bulkCreate([
    { user_id: userId, period_key: dayKey, quest_key: "daily_play", title: "Finish today's Daily", target: 1, progress: 0, reward_tokens: 10, claimed: false, rerolled: false },
    { user_id: userId, period_key: dayKey, quest_key: "solve_two", title: "Solve two words", target: 2, progress: 0, reward_tokens: 20, claimed: false, rerolled: false },
    { user_id: userId, period_key: dayKey, quest_key: "hard_win", title: "Win once in Hard Mode", target: 1, progress: 0, reward_tokens: 20, claimed: false, rerolled: false },
  ]);
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
  const existing = await admin.PlayerQuest.filter({ user_id: userId, period_key: periodKey }, "-created_date", 1);
  if (existing[0]) return existing[0];
  return await admin.PlayerQuest.create({ user_id: userId, period_key: periodKey, quest_key: "weekly_wins", title: "Win ten games this week", target: 10, progress: 0, reward_tokens: 50, claimed: false, rerolled: false });
}

export function handleFunctionError(error) {
  console.error(JSON.stringify({ event: "function_error", message: error?.message, code: error?.code }));
  return jsonError(error?.message || "Unexpected server error", error?.status || 500, error?.code || "server_error");
}
