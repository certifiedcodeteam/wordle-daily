import { clientFor, handleFunctionError, requireUser } from "../../../shared/platform.js";

type FilterableEntity<T> = {
  filter: (query: Record<string, unknown>, sort: string, limit: number, skip: number) => Promise<T[]>;
};

async function listAll<T>(entity: FilterableEntity<T>, query: Record<string, unknown>) {
  const records: T[] = [];
  const batchSize = 1000;
  for (let skip = 0; ; skip += batchSize) {
    const batch = await entity.filter(query, "created_date", batchSize, skip);
    records.push(...batch);
    if (batch.length < batchSize) return records;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = clientFor(req);
    const user = await requireUser(base44);
    const admin = base44.asServiceRole.entities;
    const anonymousId = `deleted:${crypto.randomUUID()}`;

    const sessions = await listAll(admin.GameSession, { owner_user_id: user.id });
    for (const session of sessions) {
      await admin.PuzzleSecret.deleteMany({ session_id: session.id });
    }
    await admin.GuessAttempt.deleteMany({ owner_user_id: user.id });
    await admin.GameSession.deleteMany({ owner_user_id: user.id });

    const matchLists = await Promise.all([
      listAll(admin.DuelMatch, { player_one_id: user.id }),
      listAll(admin.DuelMatch, { player_two_id: user.id }),
    ]);
    const matches = new Map(matchLists.flat().map((match) => [match.id, match]));
    for (const match of matches.values()) {
      const patch: Record<string, string> = {};
      if (match.player_one_id === user.id) patch.player_one_id = anonymousId;
      if (match.player_two_id === user.id) patch.player_two_id = anonymousId;
      if (match.winner_user_id === user.id) patch.winner_user_id = anonymousId;
      if (["waiting", "active"].includes(match.status)) patch.status = "cancelled";
      await admin.DuelMatch.update(match.id, patch);
    }

    const participants = await listAll(admin.DuelParticipant, { user_id: user.id });
    for (const participant of participants) {
      await admin.DuelParticipant.update(participant.id, {
        user_id: anonymousId,
        handle: "Deleted player",
        status: participant.status === "playing" ? "forfeit" : participant.status,
      });
    }

    const bracketLists = await Promise.all([
      listAll(admin.CupBracket, { player_one_id: user.id }),
      listAll(admin.CupBracket, { player_two_id: user.id }),
      listAll(admin.CupBracket, { winner_user_id: user.id }),
    ]);
    const brackets = new Map(bracketLists.flat().map((bracket) => [bracket.id, bracket]));
    for (const bracket of brackets.values()) {
      const patch: Record<string, string | boolean> = {};
      if (bracket.player_one_id === user.id) {
        patch.player_one_id = anonymousId;
        patch.player_one_checked_in = false;
      }
      if (bracket.player_two_id === user.id) {
        patch.player_two_id = anonymousId;
        patch.player_two_checked_in = false;
      }
      if (bracket.winner_user_id === user.id) patch.winner_user_id = anonymousId;
      await admin.CupBracket.update(bracket.id, patch);
    }

    await Promise.all([
      admin.AchievementUnlock.deleteMany({ user_id: user.id }),
      admin.LeaderboardEntry.deleteMany({ user_id: user.id }),
      admin.LeagueMembership.deleteMany({ user_id: user.id }),
      admin.PlayerInventory.deleteMany({ user_id: user.id }),
      admin.PlayerQuest.deleteMany({ user_id: user.id }),
      admin.WalletTransaction.deleteMany({ user_id: user.id }),
      admin.WordlePlayerState.deleteMany({ user_id: user.id }),
      admin.WordlePlayerState.deleteMany({ created_by_id: user.id }),
    ]);
    await admin.PlayerProfile.deleteMany({ user_id: user.id });
    await admin.PlayerAccount.deleteMany({ user_id: user.id });
    await admin.User.delete(user.id);

    return Response.json({ deleted: true });
  } catch (error) {
    return handleFunctionError(error);
  }
});
