const ENTITY_RULES = [
  { name: "PlayerAccount", key: (row) => row.user_id, merge: mergeAccount },
  { name: "PlayerProfile", key: (row) => row.user_id, merge: mergeProfile },
  { name: "LeagueMembership", key: (row) => `${row.season_id}:${row.user_id}`, merge: mergeMembership },
  { name: "LeaderboardEntry", key: (row) => `${row.season_id}:${row.user_id}`, merge: mergeLeaderboard },
  { name: "PlayerQuest", key: (row) => `${row.user_id}:${row.period_key}:${row.quest_key}`, merge: mergeQuest },
];

function maxNumber(rows, field, fallback = 0) {
  return Math.max(fallback, ...rows.map((row) => Number(row[field]) || 0));
}

function union(rows, field) {
  return [...new Set(rows.flatMap((row) => Array.isArray(row[field]) ? row[field] : []))];
}

function newest(rows) {
  return [...rows].sort((left, right) => Date.parse(right.updated_date || right.created_date || 0) - Date.parse(left.updated_date || left.created_date || 0))[0];
}

function mergeAccount(rows) {
  const latest = newest(rows);
  return {
    xp_total: maxNumber(rows, "xp_total"), token_balance: maxNumber(rows, "token_balance"),
    wallet_version: maxNumber(rows, "wallet_version"), current_streak: maxNumber(rows, "current_streak"),
    max_streak: maxNumber(rows, "max_streak"), streak_shields: maxNumber(rows, "streak_shields"),
    daily_counters: latest.daily_counters || {}, settings: latest.settings || {},
    applied_operation_keys: union(rows, "applied_operation_keys"),
  };
}

function mergeProfile(rows) {
  const latest = newest(rows);
  return {
    handle: latest.handle, avatar_seed: latest.avatar_seed, avatar_url: latest.avatar_url || "",
    rename_count: maxNumber(rows, "rename_count"), level: maxNumber(rows, "level", 1),
    games_played: maxNumber(rows, "games_played"), games_won: maxNumber(rows, "games_won"),
    peak_division: latest.peak_division || "bronze", achievements: union(rows, "achievements"),
    applied_operation_keys: union(rows, "applied_operation_keys"),
  };
}

function mergeMembership(rows) {
  const latest = newest(rows);
  return {
    handle: latest.handle, division: latest.division, cohort: latest.cohort,
    league_points: maxNumber(rows, "league_points"), duel_rating: maxNumber(rows, "duel_rating", 1000),
    rank: Math.min(...rows.map((row) => Number(row.rank) || Number.MAX_SAFE_INTEGER)),
    cup_qualified: rows.some((row) => row.cup_qualified), applied_operation_keys: union(rows, "applied_operation_keys"),
  };
}

function mergeLeaderboard(rows) {
  const latest = newest(rows);
  return {
    handle: latest.handle, division: latest.division, cohort: latest.cohort,
    points: maxNumber(rows, "points"), wins: maxNumber(rows, "wins"),
    rank: Math.min(...rows.map((row) => Number(row.rank) || Number.MAX_SAFE_INTEGER)),
    updated_at: new Date().toISOString(), applied_operation_keys: union(rows, "applied_operation_keys"),
  };
}

function mergeQuest(rows) {
  const latest = newest(rows);
  return {
    title: latest.title, target: maxNumber(rows, "target", 1), progress: maxNumber(rows, "progress"),
    reward_tokens: maxNumber(rows, "reward_tokens"), claimed: rows.some((row) => row.claimed),
    rerolled: rows.some((row) => row.rerolled), applied_operation_keys: union(rows, "applied_operation_keys"),
  };
}

export function duplicateGroups(rows, keyFor) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    if (!key) continue;
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }
  return [...grouped.entries()].filter(([, records]) => records.length > 1);
}

export async function repairDuplicatePlayerData(admin, { apply = false } = {}) {
  const report = {};
  for (const rule of ENTITY_RULES) {
    const entity = admin[rule.name];
    const rows = await entity.list("created_date", 5000);
    const groups = duplicateGroups(rows, rule.key);
    const duplicates = groups.reduce((count, [, records]) => count + records.length - 1, 0);
    report[rule.name] = { groups: groups.length, duplicates };
    if (!apply) continue;

    for (const [, records] of groups) {
      const ordered = [...records].sort((left, right) => Date.parse(left.created_date || 0) - Date.parse(right.created_date || 0));
      const [canonical, ...extra] = ordered;
      await entity.update(canonical.id, rule.merge(ordered));
      for (const duplicate of extra) await entity.delete(duplicate.id);
    }
  }
  return { applied: apply, entities: report };
}

export const repairMergers = { mergeAccount, mergeProfile, mergeMembership, mergeLeaderboard, mergeQuest };
