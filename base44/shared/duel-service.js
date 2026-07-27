import { compareDuel, randomAnswer, utcDayKey } from "./game-engine.js";
import { ensureSeason } from "./season-service.js";
import { getOrCreatePlayer, mutateWallet, requireUser } from "./platform.js";

export async function createPrivateDuel(base44) {
  const user = await requireUser(base44);
  const admin = base44.asServiceRole.entities;
  const active = await admin.DuelMatch.filter({ player_one_id: user.id, status: "waiting", kind: "private" }, "-created_date", 1);
  if (active[0]) return active[0];
  const invite = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return await admin.DuelMatch.create({ kind: "private", status: "waiting", invite_code: invite, player_one_id: user.id, version: 0 });
}

export async function queueDuel(base44) {
  const user = await requireUser(base44);
  const admin = base44.asServiceRole.entities;
  const mine = await admin.DuelMatch.filter({ player_one_id: user.id, kind: "ranked", status: "waiting" }, "-created_date", 1);
  if (mine[0]) return { match: mine[0], waiting: true };
  const waiting = await admin.DuelMatch.filter({ kind: "ranked", status: "waiting" }, "created_date", 20);
  const candidate = waiting.find((match) => match.player_one_id !== user.id);
  if (!candidate) {
    const match = await admin.DuelMatch.create({ kind: "ranked", status: "waiting", player_one_id: user.id, version: 0 });
    return { match, waiting: true };
  }
  const match = await activateMatch(base44, candidate, user.id);
  return { match, waiting: false };
}

export async function joinPrivateDuel(base44, inviteCode) {
  const user = await requireUser(base44);
  const admin = base44.asServiceRole.entities;
  const matches = await admin.DuelMatch.filter({ invite_code: String(inviteCode || "").toUpperCase(), kind: "private", status: "waiting" }, "-created_date", 1);
  if (!matches[0] || matches[0].player_one_id === user.id) throw Object.assign(new Error("Invite is not available"), { status: 404 });
  return await activateMatch(base44, matches[0], user.id);
}

async function activateMatch(base44, waiting, playerTwoId) {
  const admin = base44.asServiceRole.entities;
  const started = new Date();
  const deadline = new Date(started.getTime() + 120000);
  const claimed = await admin.DuelMatch.updateMany({ id: waiting.id, status: "waiting", version: waiting.version }, { $set: { status: "active", player_two_id: playerTwoId, started_at: started.toISOString(), deadline: deadline.toISOString(), version: waiting.version + 1 } });
  if (!claimed.updated) throw Object.assign(new Error("Another player joined first"), { status: 409, code: "match_taken" });
  const answer = randomAnswer();
  const sessions = await admin.GameSession.bulkCreate([
    duelSession(waiting.id, waiting.player_one_id, started, deadline),
    duelSession(waiting.id, playerTwoId, started, deadline),
  ]);
  await admin.PuzzleSecret.bulkCreate(sessions.map((session) => ({ session_id: session.id, round_number: 1, answer })));
  const users = await Promise.all([admin.User.get(waiting.player_one_id), admin.User.get(playerTwoId)]);
  const players = await Promise.all(users.map((user) => getOrCreatePlayer(base44, user)));
  const memberships = await Promise.all(users.map((user) => ensureSeason(base44, user)));
  await admin.DuelParticipant.bulkCreate(users.map((user, index) => ({
    match_id: waiting.id, user_id: user.id, handle: players[index].profile.handle, guesses_used: 0,
    status: "playing", rating_before: memberships[index].membership.duel_rating, rating_change: 0, last_seen_at: started.toISOString(),
  })));
  return await admin.DuelMatch.update(waiting.id, { session_one_id: sessions[0].id, session_two_id: sessions[1].id });
}

export async function activateCupDuel(base44, bracket) {
  const admin = base44.asServiceRole.entities;
  if (!bracket.player_one_id || !bracket.player_two_id) throw Object.assign(new Error("Cup bracket is not ready"), { status: 409 });
  if (bracket.match_id) return await admin.DuelMatch.get(bracket.match_id);
  const waiting = await admin.DuelMatch.create({
    kind: "cup", status: "waiting", player_one_id: bracket.player_one_id, version: 0,
    season_id: bracket.season_id, bracket_id: bracket.id,
  });
  const match = await activateMatch(base44, waiting, bracket.player_two_id);
  await admin.CupBracket.update(bracket.id, { match_id: match.id, status: "active" });
  return match;
}

function duelSession(matchId, userId, started, deadline) {
  return { owner_user_id: userId, match_id: matchId, guest: false, mode: "duel", puzzle_key: `duel:${matchId}`, puzzle_number: 0, status: "playing", guesses_used: 0, max_guesses: 6, round_number: 1, score: 0, solved_words: 0, hard_mode: false, reward_settled: false, started_at: started.toISOString(), deadline: deadline.toISOString(), version: 0 };
}

export async function recordDuelProgress(base44, session) {
  const admin = base44.asServiceRole.entities;
  const participants = await admin.DuelParticipant.filter({ match_id: session.match_id, user_id: session.owner_user_id }, "-created_date", 1);
  if (!participants[0]) return;
  const elapsed = session.completed_at ? new Date(session.completed_at).getTime() - new Date(session.started_at).getTime() : 0;
  await admin.DuelParticipant.update(participants[0].id, { guesses_used: session.guesses_used, status: session.status === "won" ? "won" : session.status === "lost" ? "lost" : "playing", elapsed_ms: elapsed, last_seen_at: new Date().toISOString() });
}

export async function duelStatus(base44, matchId) {
  const user = await requireUser(base44);
  const admin = base44.asServiceRole.entities;
  let match = await admin.DuelMatch.get(matchId);
  if (!match || ![match.player_one_id, match.player_two_id].includes(user.id)) throw Object.assign(new Error("Match not found"), { status: 404 });
  let participants = await admin.DuelParticipant.filter({ match_id: match.id }, "created_date", 2);
  if (match.status === "active") {
    const deadlinePassed = new Date() >= new Date(match.deadline);
    const bothFinished = participants.length === 2 && participants.every((player) => ["won", "lost", "forfeit"].includes(player.status));
    if (deadlinePassed || bothFinished) {
      match = await finalizeMatch(base44, match, participants);
      participants = await admin.DuelParticipant.filter({ match_id: match.id }, "created_date", 2);
    }
  }
  const sessionId = user.id === match.player_one_id ? match.session_one_id : match.session_two_id;
  return { match, participants, sessionId };
}

async function finalizeMatch(base44, match, participants) {
  const admin = base44.asServiceRole.entities;
  const normalized = participants.map((player) => ({ ...player, solved: player.status === "won", guesses: player.guesses_used || 99, elapsedMs: player.elapsed_ms || 120000 }));
  normalized.sort(compareDuel);
  const winner = normalized[0]?.solved ? normalized[0] : null;
  const updated = await admin.DuelMatch.update(match.id, { status: "complete", winner_user_id: winner?.user_id || "" });
  if (match.kind === "ranked" && participants.length === 2) await settleRankedDuel(base44, match, participants, winner?.user_id);
  if (match.kind === "cup" && winner?.user_id) await advanceCup(base44, match, participants, winner.user_id);
  return updated;
}

async function advanceCup(base44, match, participants, winnerId) {
  const admin = base44.asServiceRole.entities;
  const bracket = await admin.CupBracket.get(match.bracket_id);
  if (!bracket || bracket.status === "complete") return;
  await admin.CupBracket.update(bracket.id, { status: "complete", winner_user_id: winnerId });
  const loserId = participants.find((player) => player.user_id !== winnerId)?.user_id;
  if (bracket.round === 2 && loserId) await rewardCupPlayer(base44, loserId, 75, `cup:semi:${bracket.id}`, false);
  if (bracket.round === 3) {
    await rewardCupPlayer(base44, winnerId, 250, `cup:champion:${bracket.id}`, true);
    if (loserId) await rewardCupPlayer(base44, loserId, 150, `cup:runner-up:${bracket.id}`, false);
    return;
  }
  const nextRound = bracket.round + 1;
  const nextSlot = Math.ceil(bracket.slot / 2);
  let next = (await admin.CupBracket.filter({ season_id: bracket.season_id, division: bracket.division, cohort: bracket.cohort, round: nextRound, slot: nextSlot }, "-created_date", 1))[0];
  const playerField = bracket.slot % 2 === 1 ? "player_one_id" : "player_two_id";
  if (!next) {
    next = await admin.CupBracket.create({
      season_id: bracket.season_id, division: bracket.division, cohort: bracket.cohort,
      round: nextRound, slot: nextSlot, [playerField]: winnerId, status: "pending",
      check_in_at: new Date(Date.now() + 3600000).toISOString(), player_one_checked_in: false, player_two_checked_in: false,
    });
  } else {
    next = await admin.CupBracket.update(next.id, { [playerField]: winnerId });
  }
  if (next.player_one_id && next.player_two_id) await admin.CupBracket.update(next.id, { status: "check_in", check_in_at: new Date(Date.now() + 3600000).toISOString() });
}

async function rewardCupPlayer(base44, userId, tokens, operationKey, champion) {
  const admin = base44.asServiceRole.entities;
  const user = await admin.User.get(userId);
  const { account } = await getOrCreatePlayer(base44, user);
  await mutateWallet(base44, account, { operationKey, delta: tokens, reason: champion ? "cup_champion" : "cup_finish", referenceId: operationKey });
  if (champion) {
    const owned = await admin.PlayerInventory.filter({ user_id: userId, item_key: "season-cup-crown" }, "-created_date", 1);
    if (!owned[0]) await admin.PlayerInventory.create({ user_id: userId, item_key: "season-cup-crown", item_type: "badge", quantity: 1, acquired_at: new Date().toISOString() });
  }
}

async function settleRankedDuel(base44, match, participants, winnerId) {
  const admin = base44.asServiceRole.entities;
  for (const participant of participants) {
    const user = await admin.User.get(participant.user_id);
    const { account } = await getOrCreatePlayer(base44, user);
    const competition = await ensureSeason(base44, user);
    const won = participant.user_id === winnerId;
    const opponent = participants.find((other) => other.user_id !== participant.user_id)?.user_id || "draw";
    const dayKey = utcDayKey();
    const counters = account.daily_counters?.key === dayKey ? account.daily_counters : { key: dayKey, endlessWins: 0, endlessXpSessions: 0, duelRewards: 0, duelOpponents: {} };
    const opponentRewarded = counters.duelOpponents?.[opponent];
    const eligible = counters.duelRewards < 5 && !opponentRewarded;
    const tokens = eligible ? (won ? 8 : 2) : 0;
    const xp = won ? 40 : 20;
    await mutateWallet(base44, account, { operationKey: `duel:${match.id}:${participant.user_id}`, delta: tokens, xp, reason: won ? "duel_win" : "duel_loss", referenceId: match.id });
    await admin.PlayerAccount.update(account.id, { daily_counters: { ...counters, duelRewards: counters.duelRewards + (eligible ? 1 : 0), duelOpponents: { ...(counters.duelOpponents || {}), ...(eligible ? { [opponent]: true } : {}) } } });
    const ratingChange = won ? 24 : winnerId ? -24 : 0;
    const points = won ? 20 : 5;
    await admin.LeagueMembership.update(competition.membership.id, { duel_rating: competition.membership.duel_rating + ratingChange, league_points: competition.membership.league_points + points });
    const entries = await admin.LeaderboardEntry.filter({ season_id: competition.season.id, user_id: participant.user_id }, "-created_date", 1);
    if (entries[0]) await admin.LeaderboardEntry.update(entries[0].id, { points: competition.membership.league_points + points, wins: entries[0].wins + (won ? 1 : 0), updated_at: new Date().toISOString() });
    const row = (await admin.DuelParticipant.filter({ match_id: match.id, user_id: participant.user_id }, "-created_date", 1))[0];
    if (row) await admin.DuelParticipant.update(row.id, { rating_change: ratingChange });
  }
}

export async function forfeitDuel(base44, matchId) {
  const user = await requireUser(base44);
  const admin = base44.asServiceRole.entities;
  const match = await admin.DuelMatch.get(matchId);
  if (!match || match.status !== "active" || ![match.player_one_id, match.player_two_id].includes(user.id)) throw Object.assign(new Error("Active match not found"), { status: 404 });
  const participant = (await admin.DuelParticipant.filter({ match_id: match.id, user_id: user.id }, "-created_date", 1))[0];
  if (participant) await admin.DuelParticipant.update(participant.id, { status: "forfeit", last_seen_at: new Date().toISOString() });
  return await duelStatus(base44, match.id);
}
