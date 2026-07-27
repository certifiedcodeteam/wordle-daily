import { compareDuel, randomAnswer, utcDayKey } from "./game-engine.js";
import { ensureSeason } from "./season-service.js";
import { applyEntityOperation, getOrCreatePlayer, mutateWallet, requireUser, runWalletDelivery } from "./platform.js";
import { hydratePlayerIdentities } from "./player-identity.js";

export async function createPrivateDuel(base44) {
  const user = await requireUser(base44);
  const admin = base44.asServiceRole.entities;
  const active = await admin.DuelMatch.filter({ player_one_id: user.id, status: "waiting", kind: "private" }, "-created_date", 1);
  if (active[0]) return active[0];
  const invite = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return await admin.DuelMatch.create({ kind: "private", status: "waiting", invite_code: invite, player_one_id: user.id, version: 0, setup_status: "pending", settlement_status: "pending" });
}

export async function queueDuel(base44) {
  const user = await requireUser(base44);
  const admin = base44.asServiceRole.entities;
  const mine = await admin.DuelMatch.filter({ player_one_id: user.id, kind: "ranked", status: "waiting" }, "-created_date", 1);
  if (mine[0]) return { match: mine[0], waiting: true };
  const waiting = await admin.DuelMatch.filter({ kind: "ranked", status: "waiting" }, "created_date", 20);
  const candidate = waiting.find((match) => match.player_one_id !== user.id);
  if (!candidate) {
    const match = await admin.DuelMatch.create({ kind: "ranked", status: "waiting", player_one_id: user.id, version: 0, setup_status: "pending", settlement_status: "pending" });
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
  const claimed = await admin.DuelMatch.updateMany(
    { id: waiting.id, status: "waiting", version: waiting.version },
    { $set: { status: "active", player_two_id: playerTwoId, started_at: started.toISOString(), deadline: deadline.toISOString(), setup_status: "pending", settlement_status: "pending" }, $inc: { version: 1 } },
  );
  if (!claimed.updated) {
    const current = await admin.DuelMatch.get(waiting.id);
    if (current.status === "active" && current.player_two_id === playerTwoId) return await ensureMatchSetup(base44, current);
    throw Object.assign(new Error("Another player joined first"), { status: 409, code: "match_taken" });
  }
  return await ensureMatchSetup(base44, await admin.DuelMatch.get(waiting.id));
}

async function ensureMatchSetup(base44, match) {
  const admin = base44.asServiceRole.entities;
  if (match.setup_status === "complete") return match;
  await recoverStaleWorkflow(admin.DuelMatch, match, "setup_status");
  const claimed = await admin.DuelMatch.updateMany({ id: match.id, setup_status: "pending" }, { $set: { setup_status: "working" } });
  if (!claimed.updated) throw Object.assign(new Error("Match setup is still in progress"), { status: 409, code: "operation_in_progress" });
  try {
    const started = new Date(match.started_at);
    const deadline = new Date(match.deadline);
    const existingSessions = await admin.GameSession.filter({ match_id: match.id }, "created_date", 10);
    const sessions = [];
    for (const userId of [match.player_one_id, match.player_two_id]) {
      let session = existingSessions.find((item) => item.owner_user_id === userId);
      if (!session) session = await admin.GameSession.create(duelSession(match.id, userId, started, deadline));
      sessions.push(session);
    }
    let secret = (await admin.PuzzleSecret.filter({ session_id: sessions[0].id, round_number: 1 }, "-created_date", 1))[0];
    if (!secret) secret = await admin.PuzzleSecret.create({ session_id: sessions[0].id, round_number: 1, answer: randomAnswer() });
    const secondSecret = await admin.PuzzleSecret.filter({ session_id: sessions[1].id, round_number: 1 }, "-created_date", 1);
    if (!secondSecret[0]) await admin.PuzzleSecret.create({ session_id: sessions[1].id, round_number: 1, answer: secret.answer });
    const users = await Promise.all([admin.User.get(match.player_one_id), admin.User.get(match.player_two_id)]);
    const players = await Promise.all(users.map((user) => getOrCreatePlayer(base44, user)));
    const memberships = await Promise.all(users.map((user) => ensureSeason(base44, user)));
    const participants = await admin.DuelParticipant.filter({ match_id: match.id }, "created_date", 10);
    for (let index = 0; index < users.length; index += 1) {
      if (!participants.some((item) => item.user_id === users[index].id)) {
        await admin.DuelParticipant.create({
          match_id: match.id, user_id: users[index].id, handle: players[index].profile.handle, guesses_used: 0,
          status: "playing", rating_before: memberships[index].membership.duel_rating, rating_change: 0,
          last_seen_at: started.toISOString(), applied_operation_keys: [],
        });
      }
    }
    return await admin.DuelMatch.update(match.id, { session_one_id: sessions[0].id, session_two_id: sessions[1].id, setup_status: "complete" });
  } catch (error) {
    await admin.DuelMatch.update(match.id, { setup_status: "pending" });
    throw error;
  }
}

export async function activateCupDuel(base44, bracket) {
  const admin = base44.asServiceRole.entities;
  if (!bracket.player_one_id || !bracket.player_two_id) throw Object.assign(new Error("Cup bracket is not ready"), { status: 409 });
  if (bracket.match_id) {
    const existing = await admin.DuelMatch.get(bracket.match_id);
    return existing.status === "waiting"
      ? await activateMatch(base44, existing, bracket.player_two_id)
      : await ensureMatchSetup(base44, existing);
  }
  await recoverStaleWorkflow(admin.CupBracket, bracket, "activation_status");
  const claimed = await admin.CupBracket.updateMany(
    { id: bracket.id, activation_status: { $nin: ["working", "complete"] } },
    { $set: { activation_status: "working" } },
  );
  if (!claimed.updated) throw Object.assign(new Error("Cup match activation is in progress"), { status: 409, code: "operation_in_progress" });
  try {
    const waiting = await admin.DuelMatch.create({
      kind: "cup", status: "waiting", player_one_id: bracket.player_one_id, version: 0,
      season_id: bracket.season_id, bracket_id: bracket.id, setup_status: "pending", settlement_status: "pending",
    });
    await admin.CupBracket.update(bracket.id, { match_id: waiting.id });
    const match = await activateMatch(base44, waiting, bracket.player_two_id);
    await admin.CupBracket.update(bracket.id, { match_id: match.id, status: "active", activation_status: "complete" });
    return match;
  } catch (error) {
    await admin.CupBracket.update(bracket.id, { activation_status: "pending" });
    throw error;
  }
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
  if (match.status === "active" && match.setup_status !== "complete") match = await ensureMatchSetup(base44, match);
  let participants = await admin.DuelParticipant.filter({ match_id: match.id }, "created_date", 2);
  if (match.status === "active") {
    const deadlinePassed = new Date() >= new Date(match.deadline);
    const bothFinished = participants.length === 2 && participants.every((player) => ["won", "lost", "forfeit"].includes(player.status));
    if (deadlinePassed || bothFinished) {
      match = await finalizeMatch(base44, match, participants);
      participants = await admin.DuelParticipant.filter({ match_id: match.id }, "created_date", 2);
    }
  }
  if (match.status === "complete" && match.settlement_status !== "complete") {
    match = await settleCompletedMatch(base44, match, participants);
    participants = await admin.DuelParticipant.filter({ match_id: match.id }, "created_date", 2);
  }
  const sessionId = user.id === match.player_one_id ? match.session_one_id : match.session_two_id;
  return { match, participants: await hydratePlayerIdentities(admin, participants), sessionId };
}

async function finalizeMatch(base44, match, participants) {
  const admin = base44.asServiceRole.entities;
  const normalized = participants.map((player) => ({ ...player, solved: player.status === "won", guesses: player.guesses_used || 99, elapsedMs: player.elapsed_ms || 120000 }));
  normalized.sort(compareDuel);
  const winner = normalized[0]?.solved ? normalized[0] : null;
  await admin.DuelMatch.updateMany(
    { id: match.id, status: "active", version: match.version },
    { $set: { status: "complete", winner_user_id: winner?.user_id || "", settlement_status: "pending" }, $inc: { version: 1 } },
  );
  const completed = await admin.DuelMatch.get(match.id);
  return await settleCompletedMatch(base44, completed, participants);
}

async function settleCompletedMatch(base44, match, participants) {
  const admin = base44.asServiceRole.entities;
  if (match.settlement_status === "complete") return match;
  await recoverStaleWorkflow(admin.DuelMatch, match, "settlement_status");
  const claimed = await admin.DuelMatch.updateMany({ id: match.id, settlement_status: "pending" }, { $set: { settlement_status: "working" } });
  if (!claimed.updated) return await admin.DuelMatch.get(match.id);
  try {
    if (match.kind === "ranked" && participants.length === 2) await settleRankedDuel(base44, match, participants, match.winner_user_id || null);
    if (match.kind === "cup" && match.winner_user_id) await advanceCup(base44, match, participants, match.winner_user_id);
    return await admin.DuelMatch.update(match.id, { settlement_status: "complete" });
  } catch (error) {
    await admin.DuelMatch.update(match.id, { settlement_status: "pending" });
    throw error;
  }
}

async function advanceCup(base44, match, participants, winnerId) {
  const admin = base44.asServiceRole.entities;
  const bracket = await admin.CupBracket.get(match.bracket_id);
  if (!bracket || bracket.advancement_status === "complete") return;
  await recoverStaleWorkflow(admin.CupBracket, bracket, "advancement_status");
  const claimed = await admin.CupBracket.updateMany({ id: bracket.id, advancement_status: "pending" }, { $set: { advancement_status: "working" } });
  if (!claimed.updated) throw Object.assign(new Error("Cup advancement is in progress"), { status: 409, code: "operation_in_progress" });
  try {
    await admin.CupBracket.update(bracket.id, { status: "complete", winner_user_id: winnerId });
    const loserId = participants.find((player) => player.user_id !== winnerId)?.user_id;
    if (bracket.round === 2 && loserId) await rewardCupPlayer(base44, loserId, 75, `cup:semi:${bracket.id}`, false);
    if (bracket.round === 3) {
      await rewardCupPlayer(base44, winnerId, 250, `cup:champion:${bracket.id}`, true);
      if (loserId) await rewardCupPlayer(base44, loserId, 150, `cup:runner-up:${bracket.id}`, false);
    } else {
      const nextRound = bracket.round + 1;
      const nextSlot = Math.ceil(bracket.slot / 2);
      let next = (await admin.CupBracket.filter({ season_id: bracket.season_id, division: bracket.division, cohort: bracket.cohort, round: nextRound, slot: nextSlot }, "-created_date", 1))[0];
      const playerField = bracket.slot % 2 === 1 ? "player_one_id" : "player_two_id";
      if (!next) {
        next = await admin.CupBracket.create({
          season_id: bracket.season_id, division: bracket.division, cohort: bracket.cohort,
          round: nextRound, slot: nextSlot, [playerField]: winnerId, status: "pending",
          check_in_at: new Date(Date.now() + 3600000).toISOString(), player_one_checked_in: false, player_two_checked_in: false,
          activation_status: "pending", advancement_status: "pending",
        });
      } else {
        next = await admin.CupBracket.update(next.id, { [playerField]: winnerId });
      }
      if (next.player_one_id && next.player_two_id) await admin.CupBracket.update(next.id, { status: "check_in", check_in_at: new Date(Date.now() + 3600000).toISOString() });
    }
    await admin.CupBracket.update(bracket.id, { advancement_status: "complete" });
  } catch (error) {
    await admin.CupBracket.update(bracket.id, { advancement_status: "pending" });
    throw error;
  }
}

async function rewardCupPlayer(base44, userId, tokens, operationKey, champion) {
  const admin = base44.asServiceRole.entities;
  const user = await admin.User.get(userId);
  const { account } = await getOrCreatePlayer(base44, user);
  const wallet = await mutateWallet(base44, account, { operationKey, delta: tokens, reason: champion ? "cup_champion" : "cup_finish", referenceId: operationKey });
  await runWalletDelivery(admin, account.id, operationKey, wallet, async () => {
    if (champion) {
      const owned = await admin.PlayerInventory.filter({ user_id: userId, item_key: "season-cup-crown" }, "-created_date", 1);
      if (!owned[0]) await admin.PlayerInventory.create({ user_id: userId, item_key: "season-cup-crown", item_type: "badge", quantity: 1, acquired_at: new Date().toISOString() });
    }
  });
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
    const operationKey = `duel:${match.id}:${participant.user_id}`;
    const wallet = await mutateWallet(base44, account, { operationKey, delta: tokens, xp, reason: won ? "duel_win" : "duel_loss", referenceId: match.id });
    const ratingChange = won ? 24 : winnerId ? -24 : 0;
    const points = won ? 20 : 5;
    const entries = await admin.LeaderboardEntry.filter({ season_id: competition.season.id, user_id: participant.user_id }, "-created_date", 1);
    const row = (await admin.DuelParticipant.filter({ match_id: match.id, user_id: participant.user_id }, "-created_date", 1))[0];
    await runWalletDelivery(admin, account.id, operationKey, wallet, async () => {
      await applyEntityOperation(admin.PlayerAccount, account.id, operationKey, { $set: { daily_counters: { ...counters, duelRewards: counters.duelRewards + (eligible ? 1 : 0), duelOpponents: { ...(counters.duelOpponents || {}), ...(eligible ? { [opponent]: true } : {}) } } } });
      await applyEntityOperation(admin.LeagueMembership, competition.membership.id, operationKey, { $inc: { duel_rating: ratingChange, league_points: points } });
      if (entries[0]) await applyEntityOperation(admin.LeaderboardEntry, entries[0].id, operationKey, { $inc: { points, wins: won ? 1 : 0 }, $set: { updated_at: new Date().toISOString() } });
      if (row) await applyEntityOperation(admin.DuelParticipant, row.id, operationKey, { $set: { rating_change: ratingChange } });
    });
  }
}

async function recoverStaleWorkflow(entity, record, field) {
  const value = record[field];
  if (!value) {
    await entity.update(record.id, { [field]: "pending" });
    record[field] = "pending";
    return;
  }
  if (value !== "working") return;
  const age = Date.now() - new Date(record.updated_date || record.created_date).getTime();
  if (age < 30000) return;
  await entity.update(record.id, { [field]: "pending" });
  record[field] = "pending";
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
