import { clientFor, ensureDailyQuests, ensureWeeklyQuest, getOrCreatePlayer, handleFunctionError, optionalUser } from "../../../shared/platform.js";
import { dailyPuzzle, utcDayKey } from "../../../shared/game-engine.js";
import { ensureSeason } from "../../../shared/season-service.js";

Deno.serve(async (req) => {
  try {
    const base44 = clientFor(req);
    const user = await optionalUser(base44);
    const daily = dailyPuzzle();
    if (!user) return Response.json({ authenticated: false, daily: { puzzleNumber: daily.number, dayKey: utcDayKey() } });
    const { account, profile } = await getOrCreatePlayer(base44, user);
    const [dailyQuests, weeklyQuest, inventory, activeSessions, competition] = await Promise.all([
      ensureDailyQuests(base44, user.id),
      ensureWeeklyQuest(base44, user.id),
      base44.asServiceRole.entities.PlayerInventory.filter({ user_id: user.id }, "-created_date", 100),
      base44.asServiceRole.entities.GameSession.filter({ owner_user_id: user.id, status: "playing" }, "-updated_date", 10),
      ensureSeason(base44, user),
    ]);
    const quests = [...dailyQuests, weeklyQuest];
    return Response.json({ authenticated: true, profile, account, quests, inventory, activeSessions, competition, daily: { puzzleNumber: daily.number, dayKey: utcDayKey() } });
  } catch (error) { return handleFunctionError(error); }
});
