import { clientFor, handleFunctionError, requireUser } from "../../../shared/platform.js";
import { levelForXp, utcDayKey } from "../../../shared/game-engine.js";
import { seasonWindow } from "../../../shared/season-service.js";

const ADMIN_EMAIL = "wing@certifiedcode.us";
const CONFIRMATION = "clear-and-seed-demo";

const CLEAR_ENTITIES = [
  "DuelBotState",
  "DuelParticipant",
  "GuessAttempt",
  "PuzzleSecret",
  "GameSession",
  "DuelMatch",
  "CupBracket",
  "AchievementUnlock",
  "LeaderboardEntry",
  "LeagueMembership",
  "PlayerInventory",
  "PlayerQuest",
  "WalletTransaction",
  "WordlePlayerState",
  "PlayerProfile",
  "PlayerAccount",
  "Season",
] as const;

const DEMO_PLAYERS = [
  ["wing", "Wing", 2440, 32, 1],
  ["atlas", "AtlasAce", 2210, 41, 2],
  ["nova", "NovaLex", 1760, 29, 3],
  ["moss", "MossWord", 1580, 25, 4],
  ["pixel", "PixelType", 1430, 23, 5],
  ["ember", "EmberFive", 1280, 19, 6],
  ["quill", "QuillQuest", 1120, 17, 7],
  ["lumen", "LumenLoop", 980, 14, 8],
] as const;

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed", code: "method_not_allowed" }, { status: 405 });
    }

    const base44 = clientFor(req);
    const user = await requireUser(base44);
    if (user.email?.trim().toLowerCase() !== ADMIN_EMAIL) {
      throw Object.assign(new Error("Not found"), { status: 404, code: "not_found" });
    }

    const body = await req.json();
    if (body?.confirmation !== CONFIRMATION) {
      throw Object.assign(new Error("Reset confirmation is required"), { status: 400, code: "confirmation_required" });
    }

    const admin = base44.asServiceRole.entities;
    const cleared: Record<string, number> = {};
    for (const entityName of CLEAR_ENTITIES) {
      const result = await admin[entityName].deleteMany({});
      cleared[entityName] = result.deleted || 0;
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const window = seasonWindow(now);
    const season = await admin.Season.create({
      key: window.key,
      name: `Season ${window.index + 1}`,
      status: now >= window.leagueEnds ? "cup" : "active",
      starts_at: window.starts.toISOString(),
      league_ends_at: window.leagueEnds.toISOString(),
      ends_at: window.ends.toISOString(),
    });

    const demoPlayers = DEMO_PLAYERS.map(([key, handle, points, wins, rank]) => ({
      userId: key === "wing" ? user.id : `demo:${key}`,
      key,
      handle,
      points,
      wins,
      rank,
    }));

    await admin.PlayerProfile.bulkCreate(demoPlayers.map((player, index) => ({
      user_id: player.userId,
      handle: player.handle,
      avatar_seed: `demo-${player.key}`,
      rename_count: 0,
      level: index === 0 ? levelForXp(6400) : Math.max(2, 8 - index),
      equipped_cosmetic: index === 0 ? "board-midnight" : "",
      peak_division: index < 2 ? "gold" : "silver",
      games_played: player.wins + 11,
      games_won: player.wins,
      achievements: index === 0 ? ["first-win", "week-warrior", "streak-seven"] : [],
      applied_operation_keys: [],
    })));

    await admin.LeagueMembership.bulkCreate(demoPlayers.map((player) => ({
      season_id: season.id,
      user_id: player.userId,
      handle: player.handle,
      division: "gold",
      cohort: 1,
      league_points: player.points,
      duel_rating: 1320 - (player.rank - 1) * 35,
      rank: player.rank,
      cup_qualified: player.rank <= 5,
      applied_operation_keys: [],
    })));

    await admin.LeaderboardEntry.bulkCreate(demoPlayers.map((player) => ({
      season_id: season.id,
      user_id: player.userId,
      handle: player.handle,
      division: "gold",
      cohort: 1,
      points: player.points,
      wins: player.wins,
      rank: player.rank,
      updated_at: nowIso,
      applied_operation_keys: [],
    })));

    await admin.PlayerAccount.create({
      user_id: user.id,
      xp_total: 6400,
      token_balance: 850,
      wallet_version: 1,
      current_streak: 7,
      max_streak: 12,
      last_daily_key: utcDayKey(new Date(now.getTime() - 86400000)),
      streak_shields: 2,
      daily_counters: { games_completed: 2, games_won: 2 },
      settings: {},
      applied_operation_keys: [],
      last_operation_delivered: true,
    });

    await Promise.all([
      admin.PlayerInventory.bulkCreate([
        { user_id: user.id, item_key: "keycaps-forest", item_type: "cosmetic", quantity: 1, acquired_at: nowIso },
        { user_id: user.id, item_key: "board-midnight", item_type: "cosmetic", quantity: 1, acquired_at: nowIso },
        { user_id: user.id, item_key: "season-cup-crown", item_type: "badge", quantity: 1, acquired_at: nowIso },
      ]),
      admin.PlayerQuest.bulkCreate([
        { user_id: user.id, period_key: utcDayKey(now), quest_key: "daily_play", title: "Finish today's Daily", target: 1, progress: 1, reward_tokens: 10, claimed: false, rerolled: false, applied_operation_keys: [] },
        { user_id: user.id, period_key: utcDayKey(now), quest_key: "solve_two", title: "Solve two words", target: 2, progress: 2, reward_tokens: 20, claimed: false, rerolled: false, applied_operation_keys: [] },
        { user_id: user.id, period_key: utcDayKey(now), quest_key: "hard_win", title: "Win once in Hard Mode", target: 1, progress: 0, reward_tokens: 20, claimed: false, rerolled: false, applied_operation_keys: [] },
      ]),
      admin.WalletTransaction.create({
        user_id: user.id,
        operation_key: `demo-seed:${nowIso}`,
        reason: "demo_seed",
        delta: 850,
        xp: 6400,
        resulting_balance: 850,
        resulting_level: levelForXp(6400),
        reference_id: season.id,
        delivery_status: "complete",
      }),
      admin.AchievementUnlock.bulkCreate([
        { user_id: user.id, achievement_key: "first-win", title: "First Win", unlocked_at: nowIso },
        { user_id: user.id, achievement_key: "streak-seven", title: "Seven Day Streak", unlocked_at: nowIso },
      ]),
    ]);

    const seededRecords = 1 + demoPlayers.length * 3 + 1 + 3 + 3 + 1 + 2;
    console.log(JSON.stringify({ event: "admin_demo_reset", user_id: user.id, cleared, seeded_records: seededRecords }));
    return Response.json({ success: true, ownerEmail: ADMIN_EMAIL, cleared, seededRecords });
  } catch (error) {
    return handleFunctionError(error);
  }
});
