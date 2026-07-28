import { randomAnswer } from "./game-engine.js";
import { createBotPlan } from "./duel-bot-engine.js";
import { getOrCreatePlayer, requireUser } from "./platform.js";
import {
  PARTY_COUNTDOWN_MS,
  PARTY_MAX_PLAYERS,
  PARTY_ROUND_MS,
  PARTY_ROUNDS,
  PARTY_TRANSITION_MS,
  fallbackPartyRecap,
  deterministicPartySeed,
  partyCodeFromBytes,
  partyProgressMask,
  partyRoundScore,
  rankPartyParticipants,
  validPartyCode,
} from "./party-engine.js";

const ROOM_IDLE_MS = 30 * 60 * 1000;
const BOT_HANDLES = ["Mira Vale", "Theo Quill", "Nova Reed"];
const RECAP_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    mvp: { type: "string" },
    coachingTip: { type: "string" },
  },
  required: ["headline", "summary", "mvp", "coachingTip"],
  additionalProperties: false,
};

function partyError(message, status = 400, code = "party_error") {
  return Object.assign(new Error(message), { status, code });
}

async function uniqueInviteCode(admin) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    const code = partyCodeFromBytes(bytes);
    const existing = await admin.PartyRoom.filter({ invite_code: code, status: { $in: ["lobby", "countdown", "active", "between_rounds"] } }, "-created_date", 1);
    if (!existing[0]) return code;
  }
  throw partyError("A room code could not be reserved", 503, "code_unavailable");
}

async function humanParticipant(base44, room, user, ready = false) {
  const admin = base44.asServiceRole.entities;
  const player = await getOrCreatePlayer(base44, user);
  return await admin.PartyParticipant.create({
    room_id: room.id, user_id: user.id, viewer_user_ids: room.member_user_ids,
    handle: player.profile.handle, avatar_seed: player.profile.avatar_seed, controller: "human",
    ready, status: "lobby", live_state: ready ? "ready" : "lobby", current_session_id: "",
    progress_rows: [], round_score: 0, total_score: 0, rounds_solved: 0, round_wins: 0,
    guesses_used: 0, total_guesses: 0, elapsed_ms: 0, total_elapsed_ms: 0, rank: 0,
    round_results: [], last_seen_at: new Date().toISOString(),
  });
}

async function addDemoBots(base44, room) {
  const admin = base44.asServiceRole.entities;
  for (let index = 0; index < 3; index += 1) {
    await admin.PartyParticipant.create({
      room_id: room.id, user_id: `bot:${room.id}:${index + 1}`, viewer_user_ids: room.member_user_ids,
      handle: BOT_HANDLES[index], avatar_seed: `party-${index + 1}`, controller: "bot", ready: true,
      status: "lobby", live_state: "ready", current_session_id: "", progress_rows: [],
      round_score: 0, total_score: 0, rounds_solved: 0, round_wins: 0, guesses_used: 0,
      total_guesses: 0, elapsed_ms: 0, total_elapsed_ms: 0, rank: 0, round_results: [],
      last_seen_at: new Date().toISOString(),
    });
  }
}

export async function createParty(base44, input = {}) {
  const user = await requireUser(base44);
  const admin = base44.asServiceRole.entities;
  const demo = Boolean(input.demo);
  const now = new Date();
  let room = await admin.PartyRoom.create({
    invite_code: await uniqueInviteCode(admin), host_user_id: user.id, member_user_ids: [user.id],
    status: demo ? "countdown" : "lobby", demo, round_number: 0, round_count: PARTY_ROUNDS,
    ...(demo ? { countdown_ends_at: new Date(now.getTime() + PARTY_COUNTDOWN_MS).toISOString() } : {}),
    version: 0, setup_status: "pending", settlement_status: "pending", recap_status: "pending",
    last_activity_at: now.toISOString(), completed_words: [],
  });
  await humanParticipant(base44, room, user, demo);
  if (demo) await addDemoBots(base44, room);
  room = await admin.PartyRoom.get(room.id);
  console.log(JSON.stringify({ event: "party_created", room_id: room.id, demo, user_id: user.id }));
  return await partySnapshot(base44, user, room);
}

export async function joinParty(base44, input = {}) {
  const user = await requireUser(base44);
  const admin = base44.asServiceRole.entities;
  const code = String(input.code || "").toUpperCase();
  if (!validPartyCode(code)) throw partyError("Enter a valid six-character room code", 422, "invalid_code");
  let room = (await admin.PartyRoom.filter({ invite_code: code, status: "lobby" }, "-created_date", 1))[0];
  if (!room) throw partyError("This room is not available", 404, "room_unavailable");
  const participants = await admin.PartyParticipant.filter({ room_id: room.id }, "created_date", PARTY_MAX_PLAYERS + 1);
  const existing = participants.find((item) => item.user_id === user.id);
  if (existing) return await partySnapshot(base44, user, room);
  if (participants.length >= PARTY_MAX_PLAYERS) throw partyError("This room is full", 409, "room_full");
  const memberIds = [...new Set([...(room.member_user_ids || []), user.id])];
  const claimed = await admin.PartyRoom.updateMany(
    { id: room.id, status: "lobby", version: room.version },
    { $set: { member_user_ids: memberIds, version: room.version + 1, last_activity_at: new Date().toISOString() } },
  );
  if (!claimed.updated) throw partyError("The room changed while you joined", 409, "room_changed");
  room = await admin.PartyRoom.get(room.id);
  await humanParticipant(base44, room, user);
  const refreshed = await admin.PartyParticipant.filter({ room_id: room.id }, "created_date", PARTY_MAX_PLAYERS);
  await Promise.all(refreshed.map((item) => admin.PartyParticipant.update(item.id, { viewer_user_ids: memberIds })));
  return await partySnapshot(base44, user, room);
}

export async function setPartyReady(base44, input = {}) {
  const { user, room, participant } = await partyContext(base44, input.roomId);
  if (room.status !== "lobby") throw partyError("The room has already started", 409, "room_started");
  const ready = Boolean(input.ready);
  await base44.asServiceRole.entities.PartyParticipant.update(participant.id, {
    ready, live_state: ready ? "ready" : "lobby", last_seen_at: new Date().toISOString(),
  });
  return await partySnapshot(base44, user, await touchRoom(base44, room));
}

export async function startParty(base44, input = {}) {
  const { user, room } = await partyContext(base44, input.roomId);
  const admin = base44.asServiceRole.entities;
  if (room.host_user_id !== user.id) throw partyError("Only the host can start the room", 403, "host_required");
  if (room.status !== "lobby") throw partyError("The room has already started", 409, "room_started");
  const participants = await admin.PartyParticipant.filter({ room_id: room.id }, "created_date", PARTY_MAX_PLAYERS);
  if (participants.length < 2) throw partyError("At least two players are required", 409, "players_required");
  if (participants.some((item) => !item.ready)) throw partyError("Every player must be ready", 409, "players_not_ready");
  const countdown = new Date(Date.now() + PARTY_COUNTDOWN_MS).toISOString();
  const claimed = await admin.PartyRoom.updateMany({ id: room.id, status: "lobby", version: room.version }, {
    $set: { status: "countdown", countdown_ends_at: countdown, version: room.version + 1, last_activity_at: new Date().toISOString() },
  });
  if (!claimed.updated) throw partyError("The room changed before it could start", 409, "room_changed");
  return await partySnapshot(base44, user, await admin.PartyRoom.get(room.id));
}

async function setupPartyRound(base44, room) {
  const admin = base44.asServiceRole.entities;
  const nextRound = room.round_number + 1;
  if (nextRound > room.round_count) return await completeParty(admin, room);
  const claimed = await admin.PartyRoom.updateMany({ id: room.id, version: room.version }, {
    $set: { setup_status: "working", settlement_status: "pending", version: room.version + 1 },
  });
  if (!claimed.updated) return await admin.PartyRoom.get(room.id);
  room = await admin.PartyRoom.get(room.id);
  const participants = await admin.PartyParticipant.filter({ room_id: room.id }, "created_date", PARTY_MAX_PLAYERS);
  const answer = randomAnswer();
  const started = new Date();
  const deadline = new Date(started.getTime() + PARTY_ROUND_MS).toISOString();
  for (const participant of participants) {
    let sessionId = "";
    if (participant.controller === "human" && participant.status !== "forfeit") {
      const session = await admin.GameSession.create({
        owner_user_id: participant.user_id, party_room_id: room.id, guest: false, mode: "party",
        puzzle_key: `party:${room.id}:${nextRound}`, puzzle_number: 0, status: "playing", guesses_used: 0,
        max_guesses: 6, round_number: nextRound, score: 0, solved_words: 0, hard_mode: false,
        reward_settled: true, started_at: started.toISOString(), deadline, version: 0,
      });
      sessionId = session.id;
      await admin.PuzzleSecret.create({ session_id: session.id, round_number: nextRound, answer });
    }
    await admin.PartyParticipant.update(participant.id, {
      current_session_id: sessionId, progress_rows: [], round_score: 0, guesses_used: 0, elapsed_ms: 0,
      status: participant.status === "forfeit" ? "forfeit" : "playing",
      live_state: participant.status === "forfeit" ? "finished" : "thinking",
    });
    if (participant.controller === "bot") {
      const plan = createBotPlan(940 + nextRound * 35 + participants.indexOf(participant) * 55, deterministicPartySeed(`${room.id}:${participant.id}:${nextRound}`));
      await admin.PartyBotState.create({
        room_id: room.id, participant_id: participant.id, round_number: nextRound,
        will_solve: plan.willSolve, target_guesses: plan.targetGuesses, schedule_ms: plan.scheduleMs,
      });
    }
  }
  return await admin.PartyRoom.update(room.id, {
    status: "active", round_number: nextRound, deadline, setup_status: "complete",
    last_activity_at: started.toISOString(), version: room.version + 1,
  });
}

async function applyPartyBots(admin, room, participants, now = Date.now()) {
  const startedAt = new Date(room.deadline).getTime() - PARTY_ROUND_MS;
  const elapsed = Math.max(0, now - startedAt);
  for (const participant of participants.filter((item) => item.controller === "bot" && item.status === "playing")) {
    const state = (await admin.PartyBotState.filter({ room_id: room.id, participant_id: participant.id, round_number: room.round_number }, "-created_date", 1))[0];
    if (!state) continue;
    const completed = state.schedule_ms.filter((point) => point <= elapsed).length;
    const rows = Array.from({ length: Math.min(completed, state.target_guesses) }, (_, index) => index === state.target_guesses - 1 && state.will_solve ? "ccccc" : index % 2 ? "apapa" : "aappa");
    const terminal = completed >= state.target_guesses;
    const solved = terminal && state.will_solve;
    if (!terminal && rows.length === (participant.progress_rows || []).length) continue;
    await admin.PartyParticipant.update(participant.id, {
      progress_rows: rows, guesses_used: rows.length, elapsed_ms: terminal ? Math.min(elapsed, state.schedule_ms[state.target_guesses - 1] || elapsed) : elapsed,
      ...(terminal ? {
        status: solved ? "solved" : "finished", live_state: solved ? "solved" : "finished",
        round_score: partyRoundScore({ solved, guessesUsed: rows.length, elapsedMs: Math.min(elapsed, state.schedule_ms[state.target_guesses - 1] || elapsed) }),
      } : { live_state: completed ? "checking" : "thinking" }),
      last_seen_at: new Date().toISOString(),
    });
  }
}

async function settlePartyRound(admin, room, participants) {
  const claimed = await admin.PartyRoom.updateMany({ id: room.id, settlement_status: "pending", version: room.version }, {
    $set: { settlement_status: "working", version: room.version + 1 },
  });
  if (!claimed.updated) return await admin.PartyRoom.get(room.id);
  room = await admin.PartyRoom.get(room.id);
  const active = participants.filter((item) => item.status !== "forfeit");
  const best = [...active].sort((left, right) => (right.round_score || 0) - (left.round_score || 0) || (left.elapsed_ms || 0) - (right.elapsed_ms || 0))[0];
  for (const participant of participants) {
    const result = {
      round: room.round_number, solved: participant.status === "solved", score: participant.round_score || 0,
      guesses: participant.guesses_used || 0, elapsedMs: participant.elapsed_ms || 0,
    };
    await admin.PartyParticipant.update(participant.id, {
      total_score: (participant.total_score || 0) + result.score,
      rounds_solved: (participant.rounds_solved || 0) + (result.solved ? 1 : 0),
      round_wins: (participant.round_wins || 0) + (best?.id === participant.id && result.solved ? 1 : 0),
      total_guesses: (participant.total_guesses || 0) + result.guesses,
      total_elapsed_ms: (participant.total_elapsed_ms || 0) + result.elapsedMs,
      round_results: [...(participant.round_results || []), result],
      status: participant.status === "forfeit" ? "forfeit" : "finished", live_state: "finished",
    });
  }
  const firstSession = active.find((item) => item.current_session_id)?.current_session_id;
  let answer = "";
  if (firstSession) answer = (await admin.PuzzleSecret.filter({ session_id: firstSession, round_number: room.round_number }, "-created_date", 1))[0]?.answer || "";
  const completedWords = [...(room.completed_words || []), answer].filter(Boolean);
  if (room.round_number >= room.round_count) return await completeParty(admin, { ...room, completed_words: completedWords });
  return await admin.PartyRoom.update(room.id, {
    status: "between_rounds", transition_ends_at: new Date(Date.now() + PARTY_TRANSITION_MS).toISOString(),
    settlement_status: "complete", setup_status: "pending", completed_words: completedWords, version: room.version + 1,
  });
}

async function completeParty(admin, room) {
  const participants = await admin.PartyParticipant.filter({ room_id: room.id }, "created_date", PARTY_MAX_PLAYERS);
  const ranked = rankPartyParticipants(participants);
  await Promise.all(ranked.map((item) => admin.PartyParticipant.update(item.id, { rank: item.rank, status: item.status === "forfeit" ? "forfeit" : "finished", live_state: "finished" })));
  return await admin.PartyRoom.update(room.id, {
    status: "complete", completed_words: room.completed_words || [], settlement_status: "complete",
    setup_status: "complete", last_activity_at: new Date().toISOString(), version: room.version + 1,
  });
}

async function advanceParty(base44, room) {
  const admin = base44.asServiceRole.entities;
  const now = Date.now();
  if (room.status === "lobby" && now - new Date(room.last_activity_at).getTime() >= ROOM_IDLE_MS) {
    return await admin.PartyRoom.update(room.id, { status: "cancelled", version: room.version + 1 });
  }
  if (room.status === "countdown" && now >= new Date(room.countdown_ends_at).getTime()) return await setupPartyRound(base44, room);
  if (room.status === "between_rounds" && now >= new Date(room.transition_ends_at).getTime()) return await setupPartyRound(base44, room);
  if (room.status !== "active") return room;
  let participants = await admin.PartyParticipant.filter({ room_id: room.id }, "created_date", PARTY_MAX_PLAYERS);
  await applyPartyBots(admin, room, participants, now);
  participants = await admin.PartyParticipant.filter({ room_id: room.id }, "created_date", PARTY_MAX_PLAYERS);
  const terminal = participants.every((item) => ["solved", "finished", "forfeit"].includes(item.status));
  if (!terminal && now < new Date(room.deadline).getTime()) return room;
  if (!terminal) {
    await Promise.all(participants.filter((item) => item.status === "playing").map((item) => admin.PartyParticipant.update(item.id, {
      status: "finished", live_state: "finished", elapsed_ms: PARTY_ROUND_MS,
    })));
    participants = await admin.PartyParticipant.filter({ room_id: room.id }, "created_date", PARTY_MAX_PLAYERS);
  }
  return await settlePartyRound(admin, room, participants);
}

export async function partyStatus(base44, input = {}) {
  const { user, room, participant } = await partyContext(base44, input.roomId);
  if (participant.controller === "human" && Date.now() - new Date(participant.last_seen_at).getTime() > 4000) {
    await base44.asServiceRole.entities.PartyParticipant.update(participant.id, { last_seen_at: new Date().toISOString() });
  }
  const advanced = await advanceParty(base44, room);
  return await partySnapshot(base44, user, advanced);
}

export async function updatePartyPresence(base44, input = {}) {
  const { user, room, participant } = await partyContext(base44, input.roomId);
  const liveState = input.activity === "away" ? "reconnecting" : ["typing", "checking", "thinking"].includes(input.activity) ? input.activity : participant.live_state;
  await base44.asServiceRole.entities.PartyParticipant.update(participant.id, { live_state: liveState, last_seen_at: new Date().toISOString() });
  return await partySnapshot(base44, user, room);
}

export async function leaveParty(base44, input = {}) {
  const { room, participant } = await partyContext(base44, input.roomId);
  const admin = base44.asServiceRole.entities;
  if (room.status === "lobby") {
    await admin.PartyParticipant.delete(participant.id);
    const remaining = (await admin.PartyParticipant.filter({ room_id: room.id }, "created_date", PARTY_MAX_PLAYERS)).filter((item) => item.controller === "human");
    if (!remaining.length) {
      await admin.PartyRoom.update(room.id, { status: "cancelled", member_user_ids: [], version: room.version + 1 });
      return { left: true };
    }
    const memberIds = remaining.map((item) => item.user_id);
    await admin.PartyRoom.update(room.id, { host_user_id: remaining[0].user_id, member_user_ids: memberIds, version: room.version + 1, last_activity_at: new Date().toISOString() });
    await Promise.all(remaining.map((item) => admin.PartyParticipant.update(item.id, { viewer_user_ids: memberIds })));
    return { left: true };
  }
  await admin.PartyParticipant.update(participant.id, { status: "forfeit", live_state: "finished", last_seen_at: new Date().toISOString() });
  return { left: true };
}

export async function recordPartyProgress(base44, session, evaluation = []) {
  if (!session.party_room_id) return;
  const admin = base44.asServiceRole.entities;
  const participant = (await admin.PartyParticipant.filter({ room_id: session.party_room_id, user_id: session.owner_user_id }, "-created_date", 1))[0];
  if (!participant) return;
  const attempts = await admin.GuessAttempt.filter({ session_id: session.id, round_number: session.round_number }, "sequence", 10);
  const finished = session.status !== "playing";
  const solved = session.status === "won";
  const elapsedMs = finished ? Math.max(0, new Date(session.completed_at || Date.now()).getTime() - new Date(session.started_at).getTime()) : 0;
  await admin.PartyParticipant.update(participant.id, {
    progress_rows: attempts.map((attempt) => partyProgressMask(attempt.evaluation)).concat(evaluation.length && attempts.length < session.guesses_used ? [partyProgressMask(evaluation)] : []),
    guesses_used: session.guesses_used, elapsed_ms: finished ? elapsedMs : participant.elapsed_ms,
    status: solved ? "solved" : finished ? "finished" : "playing",
    live_state: solved ? "solved" : finished ? "finished" : "thinking",
    round_score: finished ? partyRoundScore({ solved, guessesUsed: session.guesses_used, elapsedMs }) : 0,
    last_seen_at: new Date().toISOString(),
  });
}

export async function partyRecap(base44, input = {}) {
  const { room } = await partyContext(base44, input.roomId);
  if (room.status !== "complete") throw partyError("Finish the room before requesting its recap", 409, "room_incomplete");
  const admin = base44.asServiceRole.entities;
  const existing = (await admin.PartyRecap.filter({ room_id: room.id }, "-generated_at", 1))[0];
  if (existing) return publicRecap(existing);
  const claimed = await admin.PartyRoom.updateMany({ id: room.id, recap_status: "pending" }, {
    $set: { recap_status: "working" },
  });
  if (!claimed.updated) throw partyError("The match recap is already being written", 409, "recap_pending");
  const participants = rankPartyParticipants(await admin.PartyParticipant.filter({ room_id: room.id }, "created_date", PARTY_MAX_PLAYERS));
  const fallback = fallbackPartyRecap(participants);
  let recap = fallback;
  let aiGenerated = false;
  try {
    const generated = await base44.integrations.Core.InvokeLLM({
      prompt: `Write a concise sports-style recap for a three-round word race. Use only these completed words and statistics. Do not invent events or personal details. Words: ${JSON.stringify(room.completed_words || [])}. Table: ${JSON.stringify(participants.map(({ handle, rank, total_score, rounds_solved, total_guesses, total_elapsed_ms }) => ({ handle, rank, total_score, rounds_solved, total_guesses, total_elapsed_ms })))}.`,
      response_json_schema: RECAP_SCHEMA,
    });
    if ([generated?.headline, generated?.summary, generated?.mvp, generated?.coachingTip].every((value) => typeof value === "string" && value.trim())) {
      recap = generated;
      aiGenerated = true;
    }
  } catch { /* deterministic recap remains available */ }
  const record = await admin.PartyRecap.create({
    room_id: room.id, viewer_user_ids: room.member_user_ids, headline: recap.headline.trim(), summary: recap.summary.trim(),
    mvp: recap.mvp.trim(), coaching_tip: recap.coachingTip.trim(), generated_at: new Date().toISOString(), ai_generated: aiGenerated,
  });
  await admin.PartyRoom.update(room.id, { recap_status: aiGenerated ? "complete" : "fallback" });
  return publicRecap(record);
}

async function partyContext(base44, roomId) {
  const user = await requireUser(base44);
  const admin = base44.asServiceRole.entities;
  const room = await admin.PartyRoom.get(String(roomId || ""));
  if (!room || !(room.member_user_ids || []).includes(user.id)) throw partyError("Room not found", 404, "room_not_found");
  const participant = (await admin.PartyParticipant.filter({ room_id: room.id, user_id: user.id }, "-created_date", 1))[0];
  if (!participant) throw partyError("Room not found", 404, "room_not_found");
  return { user, room, participant };
}

async function touchRoom(base44, room) {
  return await base44.asServiceRole.entities.PartyRoom.update(room.id, { last_activity_at: new Date().toISOString() });
}

async function partySnapshot(base44, user, room) {
  const admin = base44.asServiceRole.entities;
  const participants = rankPartyParticipants(await admin.PartyParticipant.filter({ room_id: room.id }, "created_date", PARTY_MAX_PLAYERS));
  const self = participants.find((item) => item.user_id === user.id);
  const recap = room.status === "complete" ? (await admin.PartyRecap.filter({ room_id: room.id }, "-generated_at", 1))[0] : null;
  const answer = ["between_rounds", "complete"].includes(room.status) ? room.completed_words?.[room.round_number - 1] : undefined;
  return {
    room: {
      id: room.id, invite_code: room.invite_code, host_user_id: room.host_user_id, status: room.status,
      demo: room.demo, round_number: room.round_number, round_count: room.round_count,
      countdown_ends_at: room.countdown_ends_at, deadline: room.deadline, transition_ends_at: room.transition_ends_at,
      recap_status: room.recap_status,
    },
    participants: participants.map(publicParticipant), self: self ? publicParticipant(self) : null,
    ...(answer ? { answer } : {}), ...(recap ? { recap: publicRecap(recap) } : {}),
  };
}

function publicParticipant(participant) {
  const stale = participant.controller === "human" && participant.status === "playing" && Date.now() - new Date(participant.last_seen_at).getTime() > 5000;
  return {
    id: participant.id, user_id: participant.user_id, handle: participant.handle, avatar_seed: participant.avatar_seed,
    controller: participant.controller, ready: participant.ready, status: participant.status, live_state: stale ? "reconnecting" : participant.live_state,
    current_session_id: participant.current_session_id, progress_rows: participant.progress_rows || [],
    round_score: participant.round_score || 0, total_score: participant.total_score || 0,
    rounds_solved: participant.rounds_solved || 0, round_wins: participant.round_wins || 0,
    guesses_used: participant.guesses_used || 0, total_guesses: participant.total_guesses || 0,
    elapsed_ms: participant.elapsed_ms || 0, total_elapsed_ms: participant.total_elapsed_ms || 0,
    rank: participant.rank || 0, round_results: participant.round_results || [],
  };
}

function publicRecap(record) {
  return { headline: record.headline, summary: record.summary, mvp: record.mvp, coachingTip: record.coaching_tip, aiGenerated: record.ai_generated };
}
