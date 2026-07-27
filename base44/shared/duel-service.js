import { compareDuel, randomAnswer, utcDayKey } from "./game-engine.js";
import { ensureSeason } from "./season-service.js";
import { applyEntityOperation, getOrCreatePlayer, mutateWallet, requireUser, runWalletDelivery } from "./platform.js";
import { hydratePlayerIdentities } from "./player-identity.js";
import { botPublicState, connectionState, createBotPlan, randomBotSeed } from "./duel-bot-engine.js";

const MATCH_MS = 120000;
const FALLBACK_MS = 8000;
const COUNTDOWN_MS = 3000;
const OPEN_STATUSES = ["waiting", "lobby", "countdown", "active"];
const LIVE_STATES = new Set(["lobby", "thinking", "typing", "checking", "finished"]);

export async function createPrivateDuel(base44) {
  const user = await requireUser(base44);
  const admin = base44.asServiceRole.entities;
  const active = await admin.DuelMatch.filter({ player_one_id: user.id, status: { $in: ["lobby", "countdown"] }, kind: "private" }, "-created_date", 1);
  if (active[0]) return await snapshotFor(base44, user, active[0]);
  const invite = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  const match = await admin.DuelMatch.create({ kind: "private", status: "lobby", invite_code: invite, player_one_id: user.id, version: 0, setup_status: "pending", settlement_status: "pending" });
  await ensureHumanParticipant(base44, match, user.id, "ready", "lobby");
  return await snapshotFor(base44, user, match);
}

export async function queueDuel(base44) {
  const user = await requireUser(base44);
  const admin = base44.asServiceRole.entities;
  const mine = await admin.DuelMatch.filter({ player_one_id: user.id, kind: "ranked", status: "waiting" }, "-created_date", 1);
  if (mine[0]) return await snapshotFor(base44, user, mine[0]);
  const waiting = await admin.DuelMatch.filter({ kind: "ranked", status: "waiting" }, "created_date", 20);
  const now = Date.now();
  const candidate = waiting.find((match) => match.player_one_id !== user.id && fallbackTime(match) > now);
  if (!candidate) {
    const match = await admin.DuelMatch.create({
      kind: "ranked", status: "waiting", player_one_id: user.id, version: 0,
      fallback_at: new Date(now + FALLBACK_MS).toISOString(), setup_status: "pending", settlement_status: "pending",
    });
    await ensureHumanParticipant(base44, match, user.id, "ready", "lobby");
    return await snapshotFor(base44, user, match);
  }
  const match = await claimHumanOpponent(base44, candidate, user.id);
  return await snapshotFor(base44, user, match);
}

export async function joinPrivateDuel(base44, inviteCode) {
  const user = await requireUser(base44);
  const admin = base44.asServiceRole.entities;
  const matches = await admin.DuelMatch.filter({ invite_code: String(inviteCode || "").toUpperCase(), kind: "private", status: { $in: ["lobby", "countdown"] } }, "-created_date", 1);
  if (!matches[0] || matches[0].player_one_id === user.id) throw Object.assign(new Error("Invite is not available"), { status: 404 });
  let match = matches[0];
  if (match.player_two_id && match.player_two_id !== user.id) throw Object.assign(new Error("Invite is not available"), { status: 404 });
  if (!match.player_two_id) {
    const claimed = await admin.DuelMatch.updateMany(
      { id: match.id, status: "lobby", version: match.version },
      { $set: { player_two_id: user.id }, $inc: { version: 1 } },
    );
    if (!claimed.updated) throw Object.assign(new Error("Another player joined first"), { status: 409, code: "match_taken" });
    match = await admin.DuelMatch.get(match.id);
  }
  await ensureHumanParticipant(base44, match, user.id, "ready", "lobby");
  return await snapshotFor(base44, user, match);
}

async function claimHumanOpponent(base44, waiting, playerTwoId) {
  const admin = base44.asServiceRole.entities;
  const countdownEnds = new Date(Date.now() + COUNTDOWN_MS).toISOString();
  const claimed = await admin.DuelMatch.updateMany(
    { id: waiting.id, status: "waiting", version: waiting.version },
    { $set: { status: "countdown", player_two_id: playerTwoId, countdown_ends_at: countdownEnds }, $inc: { version: 1 } },
  );
  if (!claimed.updated) throw Object.assign(new Error("Another player joined first"), { status: 409, code: "match_taken" });
  const match = await admin.DuelMatch.get(waiting.id);
  await ensureHumanParticipant(base44, match, playerTwoId, "ready", "ready");
  return match;
}

async function ensureHumanParticipant(base44, match, userId, status = "playing", liveState = "thinking") {
  const admin = base44.asServiceRole.entities;
  const existing = await admin.DuelParticipant.filter({ match_id: match.id, user_id: userId }, "-created_date", 1);
  const now = new Date().toISOString();
  if (existing[0]) return await admin.DuelParticipant.update(existing[0].id, { last_seen_at: now, live_state: liveState, controller: "human" });
  const user = await admin.User.get(userId);
  const player = await getOrCreatePlayer(base44, user);
  const competition = await ensureSeason(base44, user);
  return await admin.DuelParticipant.create({
    match_id: match.id, user_id: userId, handle: player.profile.handle, avatar_seed: player.profile.avatar_seed,
    guesses_used: 0, status, controller: "human", live_state: liveState,
    division: competition.membership.division, rating_before: competition.membership.duel_rating,
    rating_change: 0, reward_xp: 0, reward_tokens: 0, league_points: 0,
    last_seen_at: now, applied_operation_keys: [],
  });
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
    const participants = await admin.DuelParticipant.filter({ match_id: match.id }, "created_date", 10);
    const humanIds = [match.player_one_id, match.player_two_id].filter((userId) => userId && participants.some((item) => item.user_id === userId && (item.controller || "human") === "human"));
    const sessions = [];
    for (const userId of humanIds) {
      let session = existingSessions.find((item) => item.owner_user_id === userId);
      if (!session) session = await admin.GameSession.create(duelSession(match.id, userId, started, deadline));
      sessions.push(session);
    }
    if (!sessions.length) throw new Error("Duel has no active player session");
    let secret = (await admin.PuzzleSecret.filter({ session_id: sessions[0].id, round_number: 1 }, "-created_date", 1))[0];
    if (!secret) secret = await admin.PuzzleSecret.create({ session_id: sessions[0].id, round_number: 1, answer: randomAnswer() });
    for (const session of sessions.slice(1)) {
      const secondSecret = await admin.PuzzleSecret.filter({ session_id: session.id, round_number: 1 }, "-created_date", 1);
      if (!secondSecret[0]) await admin.PuzzleSecret.create({ session_id: session.id, round_number: 1, answer: secret.answer });
    }
    for (const participant of participants) {
      if (participant.status === "ready") await admin.DuelParticipant.update(participant.id, { status: "playing", live_state: participant.controller === "bot" ? "ready" : "thinking" });
    }
    const sessionOne = sessions.find((item) => item.owner_user_id === match.player_one_id);
    const sessionTwo = sessions.find((item) => item.owner_user_id === match.player_two_id);
    return await admin.DuelMatch.update(match.id, { session_one_id: sessionOne?.id || "", session_two_id: sessionTwo?.id || "", setup_status: "complete" });
  } catch (error) {
    await admin.DuelMatch.update(match.id, { setup_status: "pending" });
    throw error;
  }
}

async function beginCountdown(admin, match) {
  const countdownEnds = new Date(Date.now() + COUNTDOWN_MS).toISOString();
  const claimed = await admin.DuelMatch.updateMany(
    { id: match.id, status: match.status, version: match.version },
    { $set: { status: "countdown", countdown_ends_at: countdownEnds }, $inc: { version: 1 } },
  );
  return claimed.updated ? await admin.DuelMatch.get(match.id) : await admin.DuelMatch.get(match.id);
}

async function activateCountdown(base44, match) {
  const admin = base44.asServiceRole.entities;
  const started = new Date();
  const claimed = await admin.DuelMatch.updateMany(
    { id: match.id, status: "countdown", version: match.version },
    { $set: { status: "active", started_at: started.toISOString(), deadline: new Date(started.getTime() + MATCH_MS).toISOString(), setup_status: "pending", settlement_status: "pending" }, $inc: { version: 1 } },
  );
  const current = await admin.DuelMatch.get(match.id);
  return claimed.updated || current.status === "active" ? await ensureMatchSetup(base44, current) : current;
}

async function createBotParticipant(base44, match, rating, departedUserId = "") {
  const admin = base44.asServiceRole.entities;
  const plan = createBotPlan(rating, randomBotSeed());
  const participant = await admin.DuelParticipant.create({
    match_id: match.id, user_id: `bot:${match.id}:${plan.personaKey}`, handle: plan.handle,
    avatar_seed: plan.avatarSeed, guesses_used: 0, status: "ready", controller: "bot", live_state: "ready",
    persona_key: plan.personaKey, division: plan.division, departed_user_id: departedUserId,
    rating_before: plan.rating, rating_change: 0, reward_xp: 0, reward_tokens: 0, league_points: 0,
    last_seen_at: new Date().toISOString(), applied_operation_keys: [],
  });
  await admin.DuelBotState.create({
    match_id: match.id, participant_id: participant.id, persona_key: plan.personaKey, handle: plan.handle,
    avatar_seed: plan.avatarSeed, division: plan.division, rating: plan.rating, will_solve: plan.willSolve,
    target_guesses: plan.targetGuesses, schedule_ms: plan.scheduleMs,
  });
  return participant;
}

async function activateFallbackBot(base44, match) {
  const admin = base44.asServiceRole.entities;
  const countdownEnds = new Date(Date.now() + COUNTDOWN_MS).toISOString();
  const claimed = await admin.DuelMatch.updateMany(
    { id: match.id, status: "waiting", version: match.version },
    { $set: { status: "countdown", countdown_ends_at: countdownEnds }, $inc: { version: 1 } },
  );
  if (!claimed.updated) return await admin.DuelMatch.get(match.id);
  const human = (await admin.DuelParticipant.filter({ match_id: match.id, controller: "human" }, "created_date", 1))[0];
  await createBotParticipant(base44, match, human?.rating_before || 1000);
  return await admin.DuelMatch.get(match.id);
}

export async function activateCupDuel(base44, bracket) {
  const admin = base44.asServiceRole.entities;
  if (!bracket.player_one_id || !bracket.player_two_id) throw Object.assign(new Error("Cup bracket is not ready"), { status: 409 });
  if (bracket.match_id) {
    const existing = await admin.DuelMatch.get(bracket.match_id);
    return existing.status === "active" && existing.setup_status !== "complete"
      ? await ensureMatchSetup(base44, existing)
      : existing;
  }
  await recoverStaleWorkflow(admin.CupBracket, bracket, "activation_status");
  const claimed = await admin.CupBracket.updateMany(
    { id: bracket.id, activation_status: { $nin: ["working", "complete"] } },
    { $set: { activation_status: "working" } },
  );
  if (!claimed.updated) throw Object.assign(new Error("Cup match activation is in progress"), { status: 409, code: "operation_in_progress" });
  try {
    const waiting = await admin.DuelMatch.create({
      kind: "cup", status: "countdown", player_one_id: bracket.player_one_id, player_two_id: bracket.player_two_id, version: 0,
      countdown_ends_at: new Date(Date.now() + COUNTDOWN_MS).toISOString(),
      season_id: bracket.season_id, bracket_id: bracket.id, setup_status: "pending", settlement_status: "pending",
    });
    await admin.CupBracket.update(bracket.id, { match_id: waiting.id });
    await Promise.all([
      ensureHumanParticipant(base44, waiting, bracket.player_one_id, "ready", "ready"),
      ensureHumanParticipant(base44, waiting, bracket.player_two_id, "ready", "ready"),
    ]);
    await admin.CupBracket.update(bracket.id, { match_id: waiting.id, status: "active", activation_status: "complete" });
    return waiting;
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
  const status = session.status === "won" ? "won" : session.status === "lost" ? "lost" : "playing";
  await admin.DuelParticipant.update(participants[0].id, {
    guesses_used: session.guesses_used, status, elapsed_ms: elapsed,
    live_state: status === "won" ? "solved" : status === "lost" ? "finished" : "thinking",
    last_seen_at: new Date().toISOString(),
  });
}

export async function duelStatus(base44, matchId) {
  const user = await requireUser(base44);
  const admin = base44.asServiceRole.entities;
  const match = await admin.DuelMatch.get(matchId);
  if (!match || ![match.player_one_id, match.player_two_id].includes(user.id)) throw Object.assign(new Error("Match not found"), { status: 404 });
  return await snapshotFor(base44, user, match);
}

export async function currentDuel(base44) {
  const user = await requireUser(base44);
  const admin = base44.asServiceRole.entities;
  const [asOne, asTwo] = await Promise.all([
    admin.DuelMatch.filter({ player_one_id: user.id, status: { $in: OPEN_STATUSES } }, "-created_date", 10),
    admin.DuelMatch.filter({ player_two_id: user.id, status: { $in: OPEN_STATUSES } }, "-created_date", 10),
  ]);
  const match = [...asOne, ...asTwo].sort((left, right) => new Date(right.updated_date || right.created_date) - new Date(left.updated_date || left.created_date))[0];
  if (!match) return null;
  const participant = (await admin.DuelParticipant.filter({ match_id: match.id, user_id: user.id }, "-created_date", 1))[0];
  if (participant && participant.controller !== "bot") await admin.DuelParticipant.update(participant.id, { last_seen_at: new Date().toISOString() });
  return await snapshotFor(base44, user, match);
}

export async function updateDuelPresence(base44, input = {}) {
  const user = await requireUser(base44);
  const admin = base44.asServiceRole.entities;
  let match = await admin.DuelMatch.get(String(input.matchId || ""));
  if (!match || ![match.player_one_id, match.player_two_id].includes(user.id)) throw Object.assign(new Error("Match not found"), { status: 404 });
  const away = input.activity === "away";
  const liveState = away ? "reconnecting" : LIVE_STATES.has(input.activity) ? input.activity : match.status === "lobby" ? "lobby" : "thinking";
  const matchParticipants = await admin.DuelParticipant.filter({ match_id: match.id }, "created_date", 10);
  const departedSeat = matchParticipants.find((item) => item.controller === "bot" && item.departed_user_id === user.id);
  if (departedSeat) return await snapshotFor(base44, user, match);
  let participant = matchParticipants.find((item) => item.user_id === user.id);
  if (!participant) participant = await ensureHumanParticipant(base44, match, user.id, match.status === "active" ? "playing" : "ready", liveState);
  else if (participant.controller !== "bot") {
    const timestamp = new Date().toISOString();
    await admin.DuelParticipant.update(participant.id, away
      ? { live_state: "reconnecting", connection_lost_at: timestamp }
      : { last_seen_at: timestamp, live_state: liveState });
  }
  match = await admin.DuelMatch.get(match.id);
  return await snapshotFor(base44, user, match);
}

async function snapshotFor(base44, user, initialMatch) {
  const admin = base44.asServiceRole.entities;
  let match = await reconcileMatch(base44, initialMatch);
  let participants = await admin.DuelParticipant.filter({ match_id: match.id }, "created_date", 10);
  if (match.status === "complete" && match.settlement_status !== "complete") {
    match = await settleCompletedMatch(base44, match, participants);
    participants = await admin.DuelParticipant.filter({ match_id: match.id }, "created_date", 10);
  }
  const hydrated = await hydratePlayerIdentities(admin, participants.filter((participant) => participant.controller !== "bot"));
  const humanById = new Map(hydrated.map((participant) => [participant.id, participant]));
  const snapshotNow = new Date();
  participants = participants.map((participant) => {
    const hydratedParticipant = humanById.get(participant.id) || participant;
    return {
      ...hydratedParticipant,
      connection_state: publicConnectionState(participant, snapshotNow),
    };
  });
  const self = participants.find((participant) => participant.user_id === user.id || participant.departed_user_id === user.id) || null;
  const opponent = participants.find((participant) => participant.id !== self?.id) || null;
  const sessionId = self?.controller === "bot" ? "" : user.id === match.player_one_id ? match.session_one_id : match.session_two_id;
  return {
    match, participants, self, opponent, sessionId: sessionId || "", serverNow: new Date().toISOString(),
    fallbackAt: match.fallback_at || (match.status === "waiting" ? new Date(fallbackTime(match)).toISOString() : ""),
    countdownEndsAt: match.countdown_ends_at || "",
    nextSyncAt: opponent?.next_update_at || match.countdown_ends_at || match.fallback_at || "",
  };
}

async function reconcileMatch(base44, initialMatch) {
  const admin = base44.asServiceRole.entities;
  let match = await admin.DuelMatch.get(initialMatch.id);
  const now = new Date();
  if (match.status === "waiting" && match.kind === "ranked" && now.getTime() >= fallbackTime(match)) match = await activateFallbackBot(base44, match);
  let participants = await admin.DuelParticipant.filter({ match_id: match.id }, "created_date", 10);
  if (match.status === "lobby" && match.kind === "private" && match.player_two_id && bothHumansConnected(participants, now)) match = await beginCountdown(admin, match);
  if (match.status === "countdown") {
    participants = await admin.DuelParticipant.filter({ match_id: match.id }, "created_date", 10);
    let hasBot = participants.some((participant) => participant.controller === "bot");
    if (match.kind === "ranked" && participants.length === 1 && !hasBot && !match.player_two_id) {
      await createBotParticipant(base44, match, participants[0].rating_before || 1000);
      participants = await admin.DuelParticipant.filter({ match_id: match.id }, "created_date", 10);
      hasBot = true;
    }
    const connected = hasBot || bothHumansConnected(participants, now);
    if (!connected && match.kind === "private") match = await admin.DuelMatch.update(match.id, { status: "lobby", version: match.version + 1 });
    else if (now >= new Date(match.countdown_ends_at)) match = await activateCountdown(base44, match);
  }
  if (match.status === "active") {
    if (match.setup_status !== "complete") match = await ensureMatchSetup(base44, match);
    participants = await admin.DuelParticipant.filter({ match_id: match.id }, "created_date", 10);
    await reconcileBots(admin, match, participants, now);
    participants = await admin.DuelParticipant.filter({ match_id: match.id }, "created_date", 10);
    await reconcileDisconnects(base44, match, participants, now);
    participants = await admin.DuelParticipant.filter({ match_id: match.id }, "created_date", 10);
    const deadlinePassed = match.deadline && now >= new Date(match.deadline);
    const bothFinished = participants.length === 2 && participants.every((player) => ["won", "lost", "forfeit"].includes(player.status));
    if (deadlinePassed || bothFinished) match = await finalizeMatch(base44, match, participants);
  }
  return await admin.DuelMatch.get(match.id);
}

function fallbackTime(match) {
  return match.fallback_at ? new Date(match.fallback_at).getTime() : new Date(match.created_date).getTime() + FALLBACK_MS;
}

function bothHumansConnected(participants, now) {
  const humans = participants.filter((participant) => (participant.controller || "human") === "human");
  return humans.length === 2 && humans.every((participant) => participant.live_state !== "reconnecting" && connectionState(participant.last_seen_at, now) === "connected");
}

function publicConnectionState(participant, now) {
  if (participant.controller === "bot") return "connected";
  if (participant.live_state !== "reconnecting") return "connected";
  if (!participant.connection_lost_at) return "reconnecting";
  return now.getTime() - new Date(participant.connection_lost_at).getTime() > 20000 ? "expired" : "reconnecting";
}

async function reconcileBots(admin, match, participants, now) {
  const bots = participants.filter((participant) => participant.controller === "bot");
  if (!bots.length) return;
  const states = await admin.DuelBotState.filter({ match_id: match.id }, "created_date", 10);
  for (const participant of bots) {
    const hidden = states.find((state) => state.participant_id === participant.id);
    if (!hidden) continue;
    const publicState = botPublicState({
      willSolve: hidden.will_solve,
      targetGuesses: hidden.target_guesses,
      scheduleMs: hidden.schedule_ms,
    }, match.started_at, now);
    if (participant.guesses_used !== publicState.guessesUsed || participant.status !== publicState.status || participant.live_state !== publicState.liveState || participant.next_update_at !== publicState.nextUpdateAt) {
      await admin.DuelParticipant.update(participant.id, {
        guesses_used: publicState.guessesUsed, status: publicState.status, live_state: publicState.liveState,
        elapsed_ms: publicState.elapsedMs || 0, ...(publicState.nextUpdateAt ? { next_update_at: publicState.nextUpdateAt } : {}), last_seen_at: now.toISOString(),
      });
    }
  }
}

async function reconcileDisconnects(base44, match, participants, now) {
  const admin = base44.asServiceRole.entities;
  const activeHumans = participants.filter((participant) => participant.controller !== "bot" && participant.status === "playing");
  for (const participant of activeHumans) {
    if (participant.live_state !== "reconnecting" || !participant.connection_lost_at) continue;
    if (now.getTime() - new Date(participant.connection_lost_at).getTime() <= 20000) continue;
    if (match.kind === "ranked") {
      const planParticipant = await createBotParticipant(base44, match, participant.rating_before || 1000, participant.user_id);
      await admin.DuelParticipant.delete(participant.id);
      if (planParticipant) continue;
    }
    await admin.DuelParticipant.update(participant.id, { status: "forfeit", live_state: "finished" });
    const opponent = participants.find((other) => other.id !== participant.id && other.status === "playing");
    if (opponent) await admin.DuelParticipant.update(opponent.id, { status: "won", live_state: "solved", elapsed_ms: Math.max(0, now.getTime() - new Date(match.started_at).getTime()) });
  }
}

async function finalizeMatch(base44, match, participants) {
  const admin = base44.asServiceRole.entities;
  for (const participant of participants) {
    if (participant.status === "playing") {
      await admin.DuelParticipant.update(participant.id, { status: "lost", live_state: "finished", elapsed_ms: MATCH_MS });
      participant.status = "lost";
      participant.elapsed_ms = MATCH_MS;
    }
  }
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
    if (participant.controller === "bot") {
      if (participant.departed_user_id) await settleDepartedForfeit(base44, match, participant);
      continue;
    }
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
      if (row) await applyEntityOperation(admin.DuelParticipant, row.id, operationKey, { $set: { rating_change: ratingChange, reward_xp: xp, reward_tokens: tokens, league_points: points } });
    });
  }
}

async function settleDepartedForfeit(base44, match, participant) {
  const admin = base44.asServiceRole.entities;
  const user = await admin.User.get(participant.departed_user_id);
  const competition = await ensureSeason(base44, user);
  const operationKey = `duel-forfeit:${match.id}:${user.id}`;
  await applyEntityOperation(admin.LeagueMembership, competition.membership.id, operationKey, { $inc: { duel_rating: -24 } });
  const entries = await admin.LeaderboardEntry.filter({ season_id: competition.season.id, user_id: user.id }, "-created_date", 1);
  if (entries[0]) await applyEntityOperation(admin.LeaderboardEntry, entries[0].id, operationKey, { $set: { updated_at: new Date().toISOString() } });
  await applyEntityOperation(admin.DuelParticipant, participant.id, operationKey, {
    $set: { rating_change: -24, reward_xp: 0, reward_tokens: 0, league_points: 0 },
  });
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
