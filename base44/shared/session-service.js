import {
  BASE_GUESSES,
  dailyPuzzle,
  dailySettlement,
  evaluateGuess,
  isValidGuess,
  randomAnswer,
  rushWordScore,
  utcDayKey,
  validateHardMode,
} from "./game-engine.js";
import {
  applyEntityOperation,
  getOrCreatePlayer,
  mutateWallet,
  optionalUser,
  runWalletDelivery,
  utcWeekKey,
} from "./platform.js";
import { recordDuelProgress } from "./duel-service.js";
import { recordPartyProgress } from "./party-service.js";
import { canAccessSession } from "./session-access.js";
import { claimGuestDaily } from "./session-claim.js";
export { canAccessSession } from "./session-access.js";

export async function startSession(base44, input = {}) {
  const user = await optionalUser(base44);
  const mode = ["daily", "endless", "rush"].includes(input.mode) ? input.mode : "daily";
  if (!user && mode !== "daily") throw Object.assign(new Error("Sign in to unlock this mode"), { status: 401, code: "auth_required" });
  const admin = base44.asServiceRole.entities;
  const now = new Date();
  const daily = dailyPuzzle(now);
  let player;
  if (user) player = await getOrCreatePlayer(base44, user);
  if (user && mode === "daily") {
    if (player.account.daily_session_key === daily.key && player.account.daily_session_id) {
      const claimed = await admin.GameSession.get(player.account.daily_session_id);
      if (claimed) return publicSession(claimed);
    }
    const existing = await admin.GameSession.filter({ owner_user_id: user.id, mode: "daily", puzzle_key: daily.key }, "-created_date", 1);
    if (existing[0]) {
      await admin.PlayerAccount.update(player.account.id, { daily_session_key: daily.key, daily_session_id: existing[0].id });
      return publicSession(existing[0]);
    }
  }
  const deadline = mode === "rush" ? new Date(now.getTime() + 180000).toISOString() : undefined;
  const session = await admin.GameSession.create({
    owner_user_id: user?.id || "", guest: !user, mode,
    puzzle_key: mode === "daily" ? daily.key : `${mode}:${crypto.randomUUID()}`,
    puzzle_number: mode === "daily" ? daily.number : 0,
    status: "playing", guesses_used: 0, max_guesses: BASE_GUESSES, round_number: 1,
    score: 0, solved_words: 0, hard_mode: Boolean(input.hardMode), reward_settled: false,
    started_at: now.toISOString(), ...(deadline ? { deadline } : {}), version: 0,
  });
  if (mode !== "daily") await admin.PuzzleSecret.create({ session_id: session.id, round_number: 1, answer: randomAnswer() });
  if (user && mode === "daily") {
    const claimed = await admin.PlayerAccount.updateMany(
      { id: player.account.id, daily_session_key: { $ne: daily.key } },
      { $set: { daily_session_key: daily.key, daily_session_id: session.id } },
    );
    if (!claimed.updated) {
      const fresh = await admin.PlayerAccount.get(player.account.id);
      if (fresh.daily_session_id && fresh.daily_session_id !== session.id) {
        await admin.GameSession.delete(session.id);
        return publicSession(await admin.GameSession.get(fresh.daily_session_id));
      }
    }
  }
  console.log(JSON.stringify({ event: "mode_started", mode, user_id: user?.id || "guest", session_id: session.id }));
  return publicSession(session);
}

export async function claimGuestDailySession(base44, input = {}) {
  const sessionId = String(input.sessionId || "");
  if (!sessionId) throw Object.assign(new Error("Guest session is required"), { status: 400, code: "session_required" });

  const user = await optionalUser(base44);
  if (!user) throw Object.assign(new Error("Sign in required"), { status: 401, code: "auth_required" });

  const admin = base44.asServiceRole.entities;
  const currentDailyKey = dailyPuzzle(new Date()).key;
  const result = await claimGuestDaily({
    admin,
    user,
    sessionId,
    currentDailyKey,
    getPlayer: () => getOrCreatePlayer(base44, user),
    settleWonSession: (session) => settleWin(base44, user, session, `claim:${session.id}`),
  });
  console.log(JSON.stringify({ event: "guest_daily_claimed", user_id: user.id, session_id: result.sessionId }));
  return result;
}

export async function submitGuess(base44, input = {}) {
  const { sessionId, requestId, expectedVersion } = input;
  const guess = String(input.guess || "").toLowerCase();
  if (!sessionId || !requestId || !Number.isInteger(expectedVersion)) throw Object.assign(new Error("Session, version, and request ID are required"), { status: 400 });
  if (!isValidGuess(guess)) throw Object.assign(new Error("Not in the word list"), { status: 422, code: "invalid_word" });
  const admin = base44.asServiceRole.entities;
  const user = await optionalUser(base44);
  const session = await admin.GameSession.get(sessionId);
  if (!session) throw Object.assign(new Error("Session not found"), { status: 404 });
  if (!canAccessSession(session, user)) throw Object.assign(new Error("Session not found"), { status: 404 });
  if (session.last_request_id === requestId) {
    const cached = { ...session.last_request_result };
    if (user && !session.guest && session.status === "won" && ["daily", "endless"].includes(session.mode)) {
      cached.rewards = await settleWin(base44, user, session, requestId);
    }
    return cached;
  }
  if (session.version !== expectedVersion) throw Object.assign(new Error("Game changed on another device"), { status: 409, code: "version_conflict", current: publicSession(session) });
  if (session.status !== "playing") throw Object.assign(new Error("This game is complete"), { status: 409, code: "game_complete" });
  const now = new Date();
  if (session.deadline && now >= new Date(session.deadline)) {
    await admin.GameSession.update(session.id, { status: "expired", completed_at: now.toISOString(), version: session.version + 1 });
    throw Object.assign(new Error("Time is up"), { status: 409, code: "expired" });
  }
  const attempts = await admin.GuessAttempt.filter({ session_id: session.id, round_number: session.round_number }, "sequence", 10);
  if (session.hard_mode) {
    const hardError = validateHardMode(guess, attempts);
    if (hardError) throw Object.assign(new Error(hardError), { status: 422, code: "hard_mode" });
  }
  const answer = await answerFor(admin, session);
  const evaluation = evaluateGuess(guess, answer);
  const solved = guess === answer;
  const nextCount = session.guesses_used + 1;
  const failedRound = !solved && nextCount >= session.max_guesses;
  let patch = { guesses_used: nextCount, version: session.version + 1 };
  let result;

  if (session.mode === "rush" && (solved || failedRound)) {
    const secondsRemaining = Math.max(0, (new Date(session.deadline).getTime() - now.getTime()) / 1000);
    const scoreGain = solved ? rushWordScore(nextCount, secondsRemaining) : 0;
    const nextRound = session.round_number + 1;
    const penaltyMs = failedRound ? 15000 : 0;
    patch = { ...patch, guesses_used: 0, round_number: nextRound, score: session.score + scoreGain, solved_words: session.solved_words + (solved ? 1 : 0), deadline: new Date(new Date(session.deadline).getTime() - penaltyMs).toISOString() };
    result = responseFor({ ...session, ...patch }, evaluation, { roundComplete: true, solved, scoreGain, answer });
    await admin.PuzzleSecret.create({ session_id: session.id, round_number: nextRound, answer: randomAnswer() });
  } else {
    const finished = solved || failedRound;
    patch = { ...patch, status: solved ? "won" : failedRound ? "lost" : "playing", ...(finished ? { completed_at: now.toISOString() } : {}) };
    const extraChanceAvailable = Boolean(user && session.mode === "daily" && failedRound && nextCount === BASE_GUESSES && session.max_guesses === BASE_GUESSES);
    result = responseFor({ ...session, ...patch }, evaluation, {
      solved,
      extraChanceAvailable,
      answer: finished && !extraChanceAvailable && session.mode !== "party" ? answer : undefined,
    });
  }
  patch.last_request_id = requestId;
  patch.last_request_result = result;
  const changed = await admin.GameSession.updateMany({ id: session.id, version: session.version }, { $set: patch });
  if (!changed.updated) throw Object.assign(new Error("Game changed on another device"), { status: 409, code: "version_conflict" });
  await admin.GuessAttempt.create({ session_id: session.id, owner_user_id: session.owner_user_id || "", round_number: session.round_number, sequence: nextCount, word: guess, evaluation, request_id: requestId, submitted_at: now.toISOString() });
  if (session.mode === "duel") await recordDuelProgress(base44, { ...session, ...patch });
  if (session.mode === "party") await recordPartyProgress(base44, { ...session, ...patch }, evaluation);
  if (user && !session.guest && solved && ["daily", "endless"].includes(session.mode)) result.rewards = await settleWin(base44, user, { ...session, ...patch }, requestId);
  console.log(JSON.stringify({ event: "guess_submitted", mode: session.mode, solved, session_id: session.id }));
  return result;
}

export async function answerFor(admin, session) {
  if (session.mode === "daily") return dailyPuzzle(new Date(`${session.puzzle_key.slice(6)}T00:00:00Z`)).answer;
  const secrets = await admin.PuzzleSecret.filter({ session_id: session.id, round_number: session.round_number }, "-created_date", 1);
  if (!secrets[0]) throw new Error("Puzzle secret missing");
  return secrets[0].answer;
}

async function settleWin(base44, user, session, requestId) {
  const admin = base44.asServiceRole.entities;
  const { account, profile } = await getOrCreatePlayer(base44, user);
  const dayKey = utcDayKey();
  let xp = 0;
  let tokens = 0;
  let leaguePoints = 0;
  let endlessCounters = null;
  const operationKey = session.mode === "daily" ? `daily:${user.id}:${session.puzzle_key}` : `win:${session.id}`;
  if (session.mode === "daily") ({ xp, tokens, leaguePoints } = dailySettlement(session.guesses_used, session.hard_mode));
  if (session.mode === "endless") {
    endlessCounters = account.daily_counters?.key === dayKey ? account.daily_counters : { key: dayKey, endlessWins: 0, endlessXpSessions: 0, duelRewards: 0 };
    xp = endlessCounters.endlessXpSessions < 20 ? 25 : 0;
    tokens = endlessCounters.endlessWins < 5 ? 4 : 0;
  }
  const wallet = await mutateWallet(base44, account, { operationKey, delta: tokens, xp, reason: `${session.mode}_win`, referenceId: session.id });
  await runWalletDelivery(admin, account.id, operationKey, wallet, async () => {
    if (endlessCounters) {
      await applyEntityOperation(admin.PlayerAccount, account.id, operationKey, {
        $set: { daily_counters: { ...endlessCounters, endlessWins: endlessCounters.endlessWins + 1, endlessXpSessions: endlessCounters.endlessXpSessions + 1 } },
      });
    }
    await applyEntityOperation(admin.PlayerProfile, profile.id, operationKey, {
      $set: { level: wallet.level },
      $inc: { games_played: 1, games_won: 1 },
    });
    await updateQuestProgress(admin, user.id, dayKey, session, operationKey);
    if (session.mode === "daily") await settleDailyStreak(admin, account, dayKey, operationKey);
    if (leaguePoints) await addLeaguePoints(admin, user.id, leaguePoints, operationKey);
    await unlockAchievements(admin, user.id, profile, { mode: session.mode, level: wallet.level, streak: account.current_streak + (session.mode === "daily" ? 1 : 0) });
    await admin.GameSession.update(session.id, { reward_settled: true });
  });
  if (!session.reward_settled) await admin.GameSession.update(session.id, { reward_settled: true });
  return { xp: wallet.xp, tokens: wallet.delta, leaguePoints, tokenBalance: wallet.tokenBalance, level: wallet.level, requestId, duplicate: wallet.duplicate };
}

async function updateQuestProgress(admin, userId, dayKey, session, operationKey) {
  const [daily, weekly] = await Promise.all([
    admin.PlayerQuest.filter({ user_id: userId, period_key: dayKey }, "created_date", 10),
    admin.PlayerQuest.filter({ user_id: userId, period_key: utcWeekKey() }, "created_date", 10),
  ]);
  const quests = [...daily, ...weekly];
  for (const quest of quests) {
    const applies = quest.quest_key === "solve_two" || quest.quest_key === "weekly_wins" || (quest.quest_key === "daily_play" && session.mode === "daily") || (quest.quest_key === "hard_win" && session.hard_mode) || (quest.quest_key === "endless_one" && session.mode === "endless") || (quest.quest_key === "efficient_win" && session.guesses_used <= 4) || quest.quest_key === "play_three";
    if (applies && quest.progress < quest.target) {
      await applyEntityOperation(admin.PlayerQuest, quest.id, operationKey, {
        $set: { progress: Math.min(quest.target, quest.progress + 1) },
      });
    }
  }
}

async function unlockAchievements(admin, userId, profile, context) {
  const candidates = [
    { key: "first_win", title: "First Word", when: profile.games_won === 0 },
    { key: "level_five", title: "Word Scholar", when: context.level >= 5 },
    { key: "streak_seven", title: "Perfect Week", when: context.streak >= 7 },
  ].filter((item) => item.when);
  if (!candidates.length) return;
  const keys = new Set(profile.achievements || []);
  for (const item of candidates) {
    if (keys.has(item.key)) continue;
    await admin.AchievementUnlock.create({ user_id: userId, achievement_key: item.key, title: item.title, unlocked_at: new Date().toISOString() });
    keys.add(item.key);
  }
  await admin.PlayerProfile.update(profile.id, { achievements: [...keys] });
}

async function settleDailyStreak(admin, account, dayKey, operationKey) {
  if (account.last_daily_key === dayKey) return;
  const prior = account.last_daily_key ? new Date(`${account.last_daily_key}T00:00:00Z`) : null;
  const gap = prior ? Math.round((new Date(`${dayKey}T00:00:00Z`) - prior) / 86400000) : 1;
  let streak = gap === 1 ? account.current_streak + 1 : 1;
  let shields = account.streak_shields;
  if (gap === 2 && shields > 0) { streak = account.current_streak + 1; shields -= 1; }
  await applyEntityOperation(admin.PlayerAccount, account.id, operationKey, {
    $set: { current_streak: streak, max_streak: Math.max(account.max_streak, streak), last_daily_key: dayKey, streak_shields: shields },
  });
}

async function addLeaguePoints(admin, userId, points, operationKey) {
  const memberships = await admin.LeagueMembership.filter({ user_id: userId }, "-created_date", 1);
  if (!memberships[0]) return;
  const membership = memberships[0];
  await applyEntityOperation(admin.LeagueMembership, membership.id, operationKey, { $inc: { league_points: points } });
  const entries = await admin.LeaderboardEntry.filter({ season_id: membership.season_id, user_id: userId }, "-created_date", 1);
  if (entries[0]) await applyEntityOperation(admin.LeaderboardEntry, entries[0].id, operationKey, {
    $inc: { points },
    $set: { updated_at: new Date().toISOString() },
  });
}

function publicSession(session) {
  return { sessionId: session.id, mode: session.mode, puzzleNumber: session.puzzle_number, status: session.status, guessesUsed: session.guesses_used, maxGuesses: session.max_guesses, roundNumber: session.round_number, score: session.score, solvedWords: session.solved_words, hardMode: session.hard_mode, startedAt: session.started_at, deadline: session.deadline, version: session.version };
}

export async function sessionStatus(base44, input = {}) {
  const admin = base44.asServiceRole.entities;
  const user = await optionalUser(base44);
  let session = await admin.GameSession.get(input.sessionId);
  if (!session || !canAccessSession(session, user)) throw Object.assign(new Error("Session not found"), { status: 404 });
  let rewards;
  if (session.mode === "rush" && session.status === "playing" && new Date() >= new Date(session.deadline)) {
    session = await admin.GameSession.update(session.id, { status: "expired", completed_at: new Date().toISOString(), version: session.version + 1 });
    if (user && !session.reward_settled) rewards = await settleRush(base44, user, session);
  }
  const attempts = await admin.GuessAttempt.filter({ session_id: session.id, round_number: session.round_number }, "sequence", 10);
  const extraChanceAvailable = Boolean(user && session.mode === "daily" && session.status === "lost" && session.guesses_used === BASE_GUESSES && session.max_guesses === BASE_GUESSES);
  const answer = session.status !== "playing" && !extraChanceAvailable && session.mode !== "party" ? await answerFor(admin, session) : undefined;
  return { ...publicSession(session), attempts: attempts.map(({ word, evaluation, sequence }) => ({ word, evaluation, sequence })), extraChanceAvailable, ...(answer ? { answer } : {}), rewards };
}

async function settleRush(base44, user, session) {
  const admin = base44.asServiceRole.entities;
  const { account, profile } = await getOrCreatePlayer(base44, user);
  const dayKey = utcDayKey();
  const counters = account.daily_counters?.key === dayKey ? account.daily_counters : { key: dayKey, endlessWins: 0, endlessXpSessions: 0, duelRewards: 0, duelOpponents: {} };
  const firstRun = !counters.rushClaimed;
  const tokens = firstRun ? Math.min(10, session.solved_words) : 0;
  const xp = session.solved_words * 10;
  const leaguePoints = firstRun ? Math.min(100, Math.floor(session.score / 100)) : 0;
  const operationKey = `rush:${session.id}`;
  const wallet = await mutateWallet(base44, account, { operationKey, delta: tokens, xp, reason: "rush_complete", referenceId: session.id });
  await runWalletDelivery(admin, account.id, operationKey, wallet, async () => {
    await applyEntityOperation(admin.PlayerAccount, account.id, operationKey, { $set: { daily_counters: { ...counters, rushClaimed: true } } });
    await applyEntityOperation(admin.PlayerProfile, profile.id, operationKey, { $set: { level: wallet.level }, $inc: { games_played: 1 } });
    if (leaguePoints) await addLeaguePoints(admin, user.id, leaguePoints, operationKey);
    await admin.GameSession.update(session.id, { reward_settled: true });
  });
  if (!session.reward_settled) await admin.GameSession.update(session.id, { reward_settled: true });
  return { xp: wallet.xp, tokens: wallet.delta, leaguePoints, tokenBalance: wallet.tokenBalance, level: wallet.level, duplicate: wallet.duplicate };
}

function responseFor(session, evaluation, extra) {
  return { ...publicSession(session), evaluation, ...extra };
}
