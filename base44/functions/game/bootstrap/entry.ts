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
    const quests = [...await ensureDailyQuests(base44, user.id), await ensureWeeklyQuest(base44, user.id)];
    const inventory = await base44.asServiceRole.entities.PlayerInventory.filter({ user_id: user.id }, "-created_date", 100);
    const activeSessions = await base44.asServiceRole.entities.GameSession.filter({ owner_user_id: user.id, status: "playing" }, "-updated_date", 10);
    const competition = await ensureSeason(base44, user);
    return Response.json({ authenticated: true, profile, account, quests, inventory, activeSessions, competition, daily: { puzzleNumber: daily.number, dayKey: utcDayKey() } });
  } catch (error) { return handleFunctionError(error); }
});
