import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import confetti from "canvas-confetti";
import {
  Activity, BookOpenText, CalendarDays, Camera, Check, ChevronRight, CircleUserRound, Coins, Crown, Flame,
  Gauge, Info, Loader2, LockKeyhole, LogIn, MoonStar, Pencil, RefreshCw,
  Radio, RotateCcw, ShieldCheck, Sunset, Swords, Target, Timer, TreePine, WifiOff, X, Zap,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { worldApi, trackWorld } from "@/api/worldClient";
import { useAuth } from "@/lib/AuthContext";
import { shouldIgnoreGlobalKeydown } from "@/lib/dom";
import { GUEST_DAILY_KEY, saveAuthIntent } from "@/lib/auth-flow";
import { nextDuelSync } from "@/lib/duel-sync";
import {
  DEFAULT_WORLD_PATH, WORLD_MODES, buildPlayPath, buildPlayerPath, parseWorldPath,
} from "@/lib/world-routes";
import { playInvalid, playKey, playLose, playReveal, playWin } from "@/lib/wordle/audio";
import { ANSWERS } from "@/lib/wordle/words";
import {
  DuelResultSheet, GameHud, MODES, ModeDrawer, PlayerDrawer, ProgressionInfoDialog, ResultSheet,
  SeasonLeagueInfoDialog, SettingsPanel, ShopItemInfoDialog, WordDetailsDialog,
} from "@/components/world/WorldChrome";
import { useGamePreferences } from "@/components/world/useGamePreferences";
import DeleteAccountDialog from "@/components/wordle/DeleteAccountDialog";
import WordleLoader from "@/components/WordleLoader";
import "@/components/world/world.css";

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const REVEAL_MS = 980;
export const SHOP = [
  { id: "streak-shield", name: "Streak shield", price: 50, type: "Utility", icon: ShieldCheck, accent: "#4f9564", summary: "Protect one break in your Daily streak.", detail: "Used automatically when you return after missing exactly one day. Your streak continues and one shield is consumed. You can carry up to two." },
  { id: "keycaps-forest", name: "Forest keys", price: 100, type: "Cosmetic", icon: TreePine, accent: "#3f8356", summary: "A forest-green keyboard collectible.", detail: "Permanently unlocks the Forest Keys cosmetic in your inventory." },
  { id: "keycaps-sunset", name: "Sunset keys", price: 140, type: "Cosmetic", icon: Sunset, accent: "#d45d35", summary: "A warm sunset keyboard collectible.", detail: "Permanently unlocks the Sunset Keys cosmetic in your inventory." },
  { id: "board-midnight", name: "Midnight board", price: 220, type: "Cosmetic", icon: MoonStar, accent: "#55506f", summary: "A dark midnight board collectible.", detail: "Permanently unlocks the Midnight Board cosmetic in your inventory." },
  { id: "victory-crown", name: "Victory crown", price: 400, type: "Cosmetic", icon: Crown, accent: "#c39425", summary: "A crown collectible for your victories.", detail: "Permanently unlocks the Victory Crown cosmetic in your inventory." },
];

/** @type {any} */
const worldEntities = base44.entities;
const NOOP = (..._args) => {};

function applyCollectionEvent(records, event, includes = (_record) => true) {
  const previous = records.find((record) => record.id === event.id);
  const remaining = records.filter((record) => record.id !== event.id);
  if (event.type === "delete" || !event.data) return remaining;
  const next = { ...previous, ...event.data };
  return includes(next) ? [...remaining, next] : remaining;
}

function rankLeaderboard(entries) {
  return [...entries]
    .sort((left, right) => right.points - left.points || left.rank - right.rank)
    .slice(0, 30)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export default function WordleWorld() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, logout } = useAuth();
  const { preferences, updatePreference, haptic, unlockAudio } = useGamePreferences();
  const route = parseWorldPath(location.pathname);
  const routeState = location.state && typeof location.state === "object" ? location.state : {};
  const stateReturnRoute = parseWorldPath(routeState.returnTo);
  const returnTo = route?.kind === "play"
    ? route.path
    : stateReturnRoute?.kind === "play" ? stateReturnRoute.path : DEFAULT_WORLD_PATH;
  const backgroundMode = WORLD_MODES.includes(routeState.worldMode) ? routeState.worldMode : "daily";
  const mode = route?.kind === "play" ? route.mode : backgroundMode;
  const drawerView = route?.kind === "player" ? route.panel : "missions";
  const [bootstrap, setBootstrap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modeDrawerOpen, setModeDrawerOpen] = useState(false);
  const [hudDetail, setHudDetail] = useState("");
  const activityLogged = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await worldApi.bootstrap();
      setBootstrap(data);
      setError("");
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activityLogged.current) return;
    activityLogged.current = true;
    base44.appLogs?.logUserInApp?.("wordle-world").catch(() => {});
  }, []);

  const requestAuth = useCallback((reason, nextMode = "daily", destination = buildPlayPath(nextMode), replace = false) => {
    saveAuthIntent({ mode: nextMode, reason, destination });
    navigate("/login", { replace });
  }, [navigate]);

  useEffect(() => {
    if (isAuthenticated || !route?.requiresAuth) return;
    requestAuth(route.kind === "play" ? "unlock" : "account", route.kind === "play" ? route.mode : "daily", route.path, true);
  }, [isAuthenticated, requestAuth, route?.kind, route?.mode, route?.path, route?.requiresAuth]);
  useEffect(() => {
    if (!isAuthenticated && route?.requiresAuth) return;
    load();
  }, [load, isAuthenticated, route?.requiresAuth]);
  useEffect(() => { setHudDetail(""); }, [mode]);
  useEffect(() => {
    if (!isAuthenticated || !user) return undefined;
    const subscriptions = [];
    const patchRecord = (key) => (event) => {
      setBootstrap((current) => {
        if (!current || (event.data?.user_id || current[key]?.user_id) !== user.id || (event.type === "delete" && current[key]?.id !== event.id)) return current;
        return {
          ...current,
          [key]: event.type === "delete" ? null : { ...current[key], ...event.data },
        };
      });
    };
    const patchCollection = (key) => (event) => {
      setBootstrap((current) => {
        if (!current) return current;
        const records = current[key] || [];
        const previous = records.find((record) => record.id === event.id);
        if ((event.data?.user_id || previous?.user_id) !== user.id) return current;
        return { ...current, [key]: applyCollectionEvent(records, event) };
      });
    };
    try { subscriptions.push(worldEntities.PlayerAccount.subscribe(patchRecord("account"))); } catch { /* initial bootstrap remains available */ }
    try { subscriptions.push(worldEntities.PlayerProfile.subscribe(patchRecord("profile"))); } catch { /* initial bootstrap remains available */ }
    try { subscriptions.push(worldEntities.PlayerQuest.subscribe(patchCollection("quests"))); } catch { /* initial bootstrap remains available */ }
    try { subscriptions.push(worldEntities.PlayerInventory.subscribe(patchCollection("inventory"))); } catch { /* initial bootstrap remains available */ }
    return () => subscriptions.forEach((unsubscribe) => unsubscribe?.());
  }, [isAuthenticated, user]);

  const selectMode = (nextMode) => {
    if (!isAuthenticated && nextMode !== "daily") {
      requestAuth("unlock", nextMode, buildPlayPath(nextMode));
      return;
    }
    setModeDrawerOpen(false);
    navigate(buildPlayPath(nextMode));
    trackWorld("mode_selected", { mode: nextMode });
  };

  const selectPanel = (view, replace = false) => {
    const destination = buildPlayerPath(view);
    if (!destination) return;
    if (!isAuthenticated && view !== "settings") {
      requestAuth("account", "daily", destination);
      return;
    }
    navigate(destination, { replace, state: { returnTo, worldMode: mode } });
  };

  const openOverlay = (view) => {
    if (view === "login") { requestAuth("save", "daily", route?.path || DEFAULT_WORLD_PATH); return; }
    if (view === "modes") { setModeDrawerOpen(true); return; }
    selectPanel(view);
  };

  if (!route || (!isAuthenticated && route.requiresAuth)) return <WordleLoader />;
  if (loading && !bootstrap) return <WordleLoader />;

  const unclaimedRewardCount = isAuthenticated
    ? (bootstrap?.quests || []).filter((quest) => quest.progress >= quest.target && !quest.claimed).length
    : 0;

  const panel = drawerView === "settings"
    ? <SettingsPanel preferences={preferences} onChange={updatePreference} />
    : !isAuthenticated
      ? <SignedOutPanel onLogin={() => requestAuth("save")} />
      : drawerView === "shop"
        ? <ShopPanel data={bootstrap} onMissions={() => selectPanel("missions", true)} />
        : drawerView === "profile"
          ? <ProfilePanel data={bootstrap} onLogout={() => logout(true)} />
          : <QuestPanel quests={bootstrap?.quests || []} />;

  const sharedGameProps = {
    authenticated: isAuthenticated,
    onAccountChange: NOOP,
    onHudChange: setHudDetail,
    onOpenPanel: openOverlay,
    onSaveProgress: () => requestAuth("save", "daily", route.path),
    userId: user?.id || "",
    currentStreak: bootstrap?.account?.current_streak || 0,
    preferences,
    haptic,
    unlockAudio,
  };

  return (
    <div className="world-shell game-first">
      <a className="skip-link" href="#world-main">Skip to game</a>
      <GameHud
        mode={mode}
        detail={hudDetail}
        account={bootstrap?.account}
        profile={bootstrap?.profile}
        authenticated={isAuthenticated}
        missionRewardCount={unclaimedRewardCount}
        soundEnabled={preferences.soundEnabled}
        onToggleSound={() => updatePreference("soundEnabled", !preferences.soundEnabled)}
        onOpen={openOverlay}
      />
      <main id="world-main" className="world-main">
        {error && <InlineError message={error} onRetry={load} />}
        {mode === "daily" && <GameMode key="daily" mode="daily" {...sharedGameProps} />}
        {mode === "endless" && <GameMode key="endless" mode="endless" {...sharedGameProps} />}
        {mode === "rush" && <GameMode key="rush" mode="rush" {...sharedGameProps} />}
        {mode === "duel" && <DuelMode {...sharedGameProps} />}
        {mode === "league" && <LeagueMode onHudChange={setHudDetail} />}
      </main>
      <ModeDrawer open={modeDrawerOpen} mode={mode} onClose={() => setModeDrawerOpen(false)} onSelect={selectMode} />
      <PlayerDrawer open={route.kind === "player"} view={drawerView} rewardCount={unclaimedRewardCount} account={bootstrap?.account} profile={bootstrap?.profile} onView={(view) => selectPanel(view, true)} onClose={() => navigate(returnTo, { replace: true })}>{panel}</PlayerDrawer>
    </div>
  );
}

function GameMode({ mode, authenticated, onAccountChange, onHudChange, onOpenPanel, onSaveProgress, currentStreak, haptic, unlockAudio, sessionId = "", battle = null, onBattleRefresh = NOOP, onActivityChange = NOOP, onDuelAgain = NOOP }) {
  const [session, setSession] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState("loading");
  const [message, setMessage] = useState("");
  const [reward, setReward] = useState(null);
  const [clock, setClock] = useState(Date.now());
  const [shakeKey, setShakeKey] = useState(0);
  const [revealingRow, setRevealingRow] = useState(null);
  const [roundNotice, setRoundNotice] = useState("");
  const [result, setResult] = useState(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [detailWord, setDetailWord] = useState("");
  const timers = useRef([]);
  const loggedAnswerRef = useRef("");
  const modeInfo = MODES.find((item) => item.id === mode) || MODES[0];
  const inputLocked = phase !== "input" || !session || session.status !== "playing";
  const duelFinalizing = mode === "duel" && ["won", "lost"].includes(phase) && battle?.match?.status !== "complete";

  const later = useCallback((fn, delay) => {
    const timer = window.setTimeout(fn, delay);
    timers.current.push(timer);
    return timer;
  }, []);

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const start = useCallback(async () => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    setPhase("loading");
    setMessage("");
    setAttempts([]);
    setDraft("");
    setReward(null);
    setResult(null);
    setResultOpen(false);
    setDetailWord("");
    try {
      const guestKey = GUEST_DAILY_KEY;
      const savedGuest = !authenticated && mode === "daily" ? JSON.parse(window.localStorage.getItem(guestKey) || "null") : null;
      const today = new Date().toISOString().slice(0, 10);
      let data;
      if (sessionId) data = await worldApi.status(sessionId);
      else if (savedGuest?.dayKey === today && savedGuest?.sessionId) {
        try { data = await worldApi.status(savedGuest.sessionId); }
        catch { window.localStorage.removeItem(guestKey); }
      }
      if (!data) data = await worldApi.start(mode);
      if (data.guessesUsed > 0 && !data.attempts) data = await worldApi.status(data.sessionId);
      if (!authenticated && mode === "daily") window.localStorage.setItem(guestKey, JSON.stringify({ dayKey: today, sessionId: data.sessionId }));
      setSession(data);
      setAttempts(data.attempts || []);
      if (data.status === "playing") setPhase("input");
      else {
        const nextResult = resultFrom(data, data.attempts?.length || data.guessesUsed, data.rewards);
        setPhase(data.status === "won" ? "won" : "lost");
        setResult(nextResult);
        // Restored results stay on the completed board instead of replaying the
        // end-of-round takeover. Keep the final-guess offer reachable when eligible.
        if (data.extraChanceAvailable) later(() => setResultOpen(true), 180);
      }
      trackWorld("mode_started", { mode });
    } catch (error) {
      setMessage(error.message);
      setPhase("input");
    }
  }, [authenticated, mode, sessionId, later]);

  useEffect(() => { start(); }, [start]);
  useEffect(() => {
    const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    if (!isLocalhost || !session) return;
    const puzzleNumber = session.puzzleNumber;
    const answer = mode === "daily" && Number.isInteger(puzzleNumber)
      ? ANSWERS[((puzzleNumber - 1) % ANSWERS.length + ANSWERS.length) % ANSWERS.length]
      : session.answer;
    if (!answer) return;
    const logKey = `${session.sessionId}:${session.roundNumber || 1}:${session.roundComplete ? "round" : session.status}:${answer}`;
    if (loggedAnswerRef.current === logKey) return;
    loggedAnswerRef.current = logKey;
    console.log(`[Wordle World] ${modeInfo.title} answer: ${answer.toUpperCase()}`);
  }, [mode, modeInfo.title, session]);
  useEffect(() => {
    if (!session?.deadline || session.status !== "playing") return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [session?.deadline, session?.status]);

  useEffect(() => {
    if (mode !== "rush" || !session?.deadline || session.status !== "playing" || clock < new Date(session.deadline).getTime()) return;
    setPhase("submitting");
    worldApi.status(session.sessionId).then((data) => {
      setSession(data);
      setReward(data.rewards || null);
      setPhase("lost");
      const nextResult = resultFrom(data, data.attempts?.length || 0, data.rewards);
      setResult(nextResult);
      playLose();
      haptic([30, 45, 30]);
      setResultOpen(true);
      onAccountChange();
    }).catch((error) => { setMessage(error.message); setPhase("input"); });
  }, [clock, mode, session, haptic, onAccountChange]);

  const remaining = session?.deadline ? Math.max(0, new Date(session.deadline).getTime() - clock) : 0;
  useEffect(() => {
    if (!session) { onHudChange("Loading arena"); return; }
    if (mode === "daily") onHudChange(`Puzzle #${session.puzzleNumber || ""}`);
    else if (mode === "rush") onHudChange(`${session.score || 0} pts - ${formatDuration(remaining)}`);
    else onHudChange(`Round ${session.roundNumber || 1} - ${phaseLabel(phase)}`);
  }, [mode, onHudChange, phase, remaining, session]);

  useEffect(() => {
    if (mode !== "duel") return;
    const activity = phase === "submitting" || phase === "revealing" ? "checking"
      : ["won", "lost"].includes(phase) ? "finished"
        : draft ? "typing" : "thinking";
    onActivityChange(activity);
  }, [draft, mode, onActivityChange, phase]);

  const invalidGuess = useCallback((text) => {
    setMessage(text);
    setShakeKey((value) => value + 1);
    playInvalid();
    haptic([30, 40, 30]);
  }, [haptic]);

  const finishRound = useCallback((response, nextAttempts) => {
    setRevealingRow(null);
    if (mode === "rush" && response.roundComplete) {
      setRoundNotice(response.solved ? "Round clear" : `Missed - ${response.answer?.toUpperCase() || "next word"}`);
      response.solved ? playWin() : playLose();
      haptic(response.solved ? [18, 35, 18] : [30, 45, 30]);
      setPhase("transitioning");
      setSession(response);
      later(() => {
        setAttempts([]);
        setRoundNotice("");
        setPhase("input");
      }, 620);
      return;
    }

    setSession(response);
    if (response.status === "playing") {
      setPhase("input");
      if (mode === "duel") onBattleRefresh();
      return;
    }

    const won = response.status === "won" || response.solved;
    setPhase(won ? "won" : "lost");
    const nextResult = resultFrom(response, nextAttempts.length, response.rewards);
    setResult(nextResult);
    if (won) {
      playWin();
      haptic([20, 35, 20, 35, 45]);
      if (!reduceMotion()) confetti({ particleCount: 120, spread: 76, origin: { y: 0.6 }, colors: ["#4f9564", "#e0ad35", "#ff6a00", "#f7f6f1"] });
    } else {
      playLose();
      haptic([35, 55, 35]);
    }
    if (mode === "duel") later(onBattleRefresh, 220);
    else later(() => setResultOpen(true), 220);
  }, [haptic, later, mode, onBattleRefresh]);

  const submit = useCallback(async () => {
    if (inputLocked) return;
    if (draft.length !== 5) { invalidGuess("Enter all 5 letters"); return; }
    setPhase("submitting");
    setMessage("");
    try {
      const guess = draft;
      const response = await worldApi.guess(session.sessionId, guess, session.version);
      const attempt = { word: guess, evaluation: response.evaluation, sequence: attempts.length + 1 };
      const nextAttempts = [...attempts, attempt];
      setAttempts(nextAttempts);
      setDraft("");
      setReward(response.rewards || null);
      setRevealingRow(attempts.length);
      setPhase("revealing");
      playReveal();
      if (response.rewards) onAccountChange();
      later(() => finishRound(response, nextAttempts), reduceMotion() ? 20 : REVEAL_MS);
    } catch (error) {
      if (error.code === "version_conflict") { setMessage("Game updated on another device"); start(); return; }
      invalidGuess(error.message);
      setPhase("input");
    }
  }, [attempts, draft, finishRound, inputLocked, invalidGuess, later, onAccountChange, session, start]);

  const onKey = useCallback((key) => {
    if (inputLocked) return;
    unlockAudio();
    if (key === "Enter") { submit(); return; }
    if (key === "Backspace") {
      if (draft) { playKey(); haptic(8); setDraft((value) => value.slice(0, -1)); }
      return;
    }
    if (/^[a-z]$/i.test(key) && draft.length < 5) {
      playKey();
      haptic(8);
      setDraft((value) => `${value}${key.toLowerCase()}`);
    }
  }, [draft, haptic, inputLocked, submit, unlockAudio]);

  useEffect(() => {
    const listener = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || shouldIgnoreGlobalKeydown(event)) return;
      if (event.key === "Enter" || event.key === "Backspace" || /^[a-z]$/i.test(event.key)) {
        event.preventDefault();
        onKey(event.key);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onKey]);

  const buyExtra = async () => {
    setPhase("submitting");
    try {
      const data = await worldApi.buyExtraGuess(session.sessionId);
      setSession((current) => ({ ...current, ...data, status: "playing" }));
      setMessage("Final guess unlocked");
      setResultOpen(false);
      setPhase("input");
      onAccountChange();
    } catch (error) { setMessage(error.message); setPhase("lost"); }
  };

  const visibleKeyboardAttempts = phase === "revealing" ? attempts.slice(0, -1) : attempts;
  const canBuyExtra = mode === "daily" && authenticated && result?.extraChanceAvailable;
  const primaryAction = canBuyExtra
    ? buyExtra
    : mode === "endless" || mode === "rush"
      ? start
      : mode === "daily"
        ? authenticated
          ? () => { setResultOpen(false); onOpenPanel("missions"); }
          : onSaveProgress
        : () => { setResultOpen(false); onOpenPanel("modes"); };
  const primaryLabel = canBuyExtra ? "Unlock final guess - 30 tokens" : mode === "endless" || mode === "rush" ? "Next round" : mode === "daily" ? authenticated ? "View missions" : "Save progress" : "Choose mode";

  return (
    <section className={`game-workspace phase-${phase} ${battle ? "duel-game-workspace" : ""}`} aria-label={modeInfo.title}>
      {battle ? <BattleHeader snapshot={battle} now={clock} /> : <div className="arena-heading">
        <div><span>{modeInfo.label}</span><h1>{modeInfo.title}</h1></div>
        {mode === "rush" && <div className="arena-score"><strong>{session?.score || 0}</strong><span>score</span></div>}
        {session?.deadline && <div className="mode-timer"><Timer />{formatDuration(remaining)}</div>}
      </div>}
      <div className="game-board-wrap">
        {phase === "loading" && !session ? <ArenaLoader /> : <WorldBoard attempts={attempts} draft={draft} rows={session?.maxGuesses || 6} revealingRow={revealingRow} shakeKey={shakeKey} won={phase === "won"} />}
        {roundNotice && <div className="round-notice" role="status">{roundNotice}</div>}
      </div>
      <WorldKeyboard attempts={visibleKeyboardAttempts} onKey={onKey} disabled={inputLocked} />
      <div className={`game-status ${message ? "has-message" : ""}`} role="status" aria-live="polite">
        {(phase === "submitting" || phase === "loading" || duelFinalizing) && <Loader2 className="world-inline-spinner" />}
        <span>{message || (duelFinalizing ? "Finalizing battle" : reward ? `+${reward.xp || 0} XP - +${reward.tokens || 0} tokens` : phase === "input" ? "Build a five-letter word" : phaseLabel(phase))}</span>
        {mode !== "duel" && !resultOpen && !detailWord && result?.answer && !result.extraChanceAvailable && <button className="game-status-word-details" onClick={() => setDetailWord(result.answer)}><BookOpenText />Word details</button>}
      </div>
      {mode !== "duel" && <ResultSheet open={resultOpen && !detailWord} result={result} streak={currentStreak} onClose={() => setResultOpen(false)} onPrimary={primaryAction} primaryLabel={primaryLabel} onSecondary={() => setResultOpen(false)} secondaryLabel="Back to board" onWordDetails={setDetailWord} />}
      {mode === "duel" && <DuelResultSheet snapshot={battle} open={!detailWord} onAgain={onDuelAgain} onClose={NOOP} onWordDetails={setDetailWord} />}
      <WordDetailsDialog word={detailWord} open={Boolean(detailWord)} onClose={() => setDetailWord("")} />
    </section>
  );
}

function WorldBoard({ attempts, draft, rows, revealingRow, shakeKey, won }) {
  return <div className="world-board" style={/** @type {import("react").CSSProperties} */ ({ "--world-rows": rows })} role="grid" aria-label="Word grid">
    {Array.from({ length: rows }, (_, row) => {
      const attempt = attempts[row];
      const letters = attempt?.word || (row === attempts.length ? draft : "");
      const isRevealing = revealingRow === row;
      const isWinning = won && row === attempts.length - 1;
      return <div className={`world-board-row ${row === attempts.length && shakeKey ? "is-shaking" : ""} ${isWinning ? "is-winning" : ""}`} role="row" key={`${row}-${row === attempts.length ? shakeKey : 0}`}>
        {Array.from({ length: 5 }, (_, column) => {
          const status = attempt?.evaluation?.[column];
          return <div role="gridcell" aria-label={letters[column] ? `${letters[column].toUpperCase()}${status ? `, ${status}` : ""}` : "Empty"} key={column} className={`world-tile ${letters[column] ? "is-filled" : ""} ${status ? `tile-${status}` : ""} ${isRevealing ? "is-revealing" : ""}`} style={isRevealing ? { animationDelay: `${column * 105}ms` } : undefined}>{letters[column] || ""}</div>;
        })}
      </div>;
    })}
  </div>;
}

function WorldKeyboard({ attempts, onKey, disabled }) {
  const statuses = useMemo(() => {
    const score = { absent: 1, present: 2, correct: 3 };
    const result = {};
    attempts.forEach((attempt) => attempt.word.split("").forEach((letter, index) => {
      const status = attempt.evaluation[index];
      if (!result[letter] || score[status] > score[result[letter]]) result[letter] = status;
    }));
    return result;
  }, [attempts]);
  return <div className="world-keyboard" aria-label="Keyboard">{KEY_ROWS.map((row, index) => <div className="world-keyboard-row" key={row}>
    {index === 2 && <button className="is-wide" disabled={disabled} onClick={() => onKey("Enter")}>Enter</button>}
    {row.split("").map((letter) => <button key={letter} disabled={disabled} aria-label={`Add ${letter.toUpperCase()}`} className={statuses[letter] ? `key-${statuses[letter]}` : ""} onClick={() => onKey(letter)}>{letter}</button>)}
    {index === 2 && <button className="is-wide" disabled={disabled} onClick={() => onKey("Backspace")} aria-label="Delete">⌫</button>}
  </div>)}</div>;
}

function DuelMode({ onHudChange, authenticated, onAccountChange, onOpenPanel, onSaveProgress, userId, currentStreak, haptic, unlockAudio }) {
  const [match, setMatch] = useState(null);
  const [status, setStatus] = useState(null);
  const [invite, setInvite] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState("lobby");
  const [now, setNow] = useState(Date.now());
  const activityRef = useRef(activity);
  const lastPresenceRef = useRef("");
  const consumedSyncRef = useRef({ matchId: "", values: new Set() });

  const applySnapshot = useCallback((data) => {
    if (!data) { setStatus(null); setMatch(null); return; }
    setStatus(data);
    setMatch(data.match);
  }, []);
  const refresh = useCallback(async (matchId) => {
    try { applySnapshot(await worldApi.duelStatus(matchId)); }
    catch (error) {
      console.warn("[Duel] Result synchronization failed", { matchId, message: error.message, code: error.code, status: error.status });
      setMessage(error.message);
    }
  }, [applySnapshot]);
  useEffect(() => { activityRef.current = activity; }, [activity]);
  useEffect(() => {
    let active = true;
    worldApi.currentDuel().then((data) => active && applySnapshot(data)).catch((error) => active && setMessage(error.message));
    return () => { active = false; };
  }, [applySnapshot]);
  useEffect(() => {
    const detail = match?.status === "waiting" ? "Searching for rival"
      : match?.status === "lobby" ? "Private lobby"
        : match?.status === "countdown" ? "Battle starting" : match?.status === "complete" ? "Battle complete" : "Live battle";
    onHudChange(detail);
  }, [match?.status, onHudChange]);
  useEffect(() => {
    if (!match?.id) return undefined;
    const subscriptions = [];
    try {
      subscriptions.push(worldEntities.DuelMatch.subscribe((event) => {
        if (event.id !== match.id) return;
        if (event.type === "delete") { setMatch(null); setStatus(null); return; }
        if (!event.data) return;
        setMatch((current) => ({ ...current, ...event.data }));
        setStatus((current) => {
          if (!current) return current;
          const nextMatch = { ...current.match, ...event.data };
          const sessionId = userId === nextMatch.player_one_id ? nextMatch.session_one_id : nextMatch.session_two_id;
          return {
            ...current, match: nextMatch, sessionId: current.self?.controller === "bot" ? "" : sessionId || current.sessionId || "",
            fallbackAt: nextMatch.fallback_at || current.fallbackAt,
            countdownEndsAt: nextMatch.countdown_ends_at || current.countdownEndsAt,
          };
        });
      }));
    } catch { /* manual refresh remains available */ }
    try {
      subscriptions.push(worldEntities.DuelParticipant.subscribe((event) => {
        setStatus((current) => {
          if (!current) return current;
          const previous = current.participants.find((participant) => participant.id === event.id);
          if (event.data?.match_id !== match.id && previous?.match_id !== match.id) return current;
          const participants = applyCollectionEvent(current.participants, event).map((participant) => ({
            ...participant,
            connection_state: participant.controller === "bot" ? "connected"
              : event.id === participant.id && event.data?.live_state === "reconnecting" ? "reconnecting"
                : event.id === participant.id && event.data?.last_seen_at ? "connected" : participant.connection_state || "connected",
          }));
          const self = participants.find((participant) => participant.user_id === userId || participant.departed_user_id === userId) || null;
          const opponent = participants.find((participant) => participant.id !== self?.id) || null;
          if (self?.user_id === userId && self.live_state) lastPresenceRef.current = self.live_state;
          return { ...current, participants, self, opponent, nextSyncAt: opponent?.next_update_at || current.nextSyncAt };
        });
        if (event.data?.match_id === match.id && ["won", "lost", "forfeit"].includes(event.data.status)) {
          window.setTimeout(() => refresh(match.id), 0);
        }
      }));
    } catch { /* deadline reconciliation remains available */ }
    return () => subscriptions.forEach((unsubscribe) => unsubscribe?.());
  }, [match?.id, refresh, userId]);
  useEffect(() => {
    if (!match?.id || match.status === "complete") return undefined;
    if (consumedSyncRef.current.matchId !== match.id) consumedSyncRef.current = { matchId: match.id, values: new Set() };
    const candidate = nextDuelSync(status, consumedSyncRef.current.values);
    if (!candidate) return undefined;
    const delay = Math.max(20, candidate.at - Date.now() + 80);
    const timer = window.setTimeout(() => {
      consumedSyncRef.current.values.add(candidate.key);
      refresh(match.id);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [match?.deadline, match?.id, match?.status, refresh, status?.countdownEndsAt, status?.fallbackAt, status?.nextSyncAt]);
  useEffect(() => {
    if (!match?.id || match.status === "complete") return undefined;
    let active = true;
    const send = () => {
      const nextActivity = match.status === "lobby" ? "lobby" : activityRef.current;
      lastPresenceRef.current = nextActivity;
      worldApi.duelPresence(match.id, nextActivity).then((data) => active && applySnapshot(data)).catch(() => {});
    };
    send();
    const markAway = () => worldApi.duelPresence(match.id, "away").catch(() => {});
    const onVisible = () => { if (document.visibilityState === "visible") send(); else markAway(); };
    window.addEventListener("focus", send);
    window.addEventListener("pagehide", markAway);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.removeEventListener("focus", send);
      window.removeEventListener("pagehide", markAway);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [applySnapshot, match?.id, match?.status]);
  useEffect(() => {
    if (!match?.id || match.status !== "active" || activity !== "typing" || lastPresenceRef.current === "typing") return;
    lastPresenceRef.current = "typing";
    worldApi.duelPresence(match.id, "typing").then(applySnapshot).catch(() => {});
  }, [activity, applySnapshot, match?.id, match?.status]);
  useEffect(() => {
    if (!["waiting", "lobby", "countdown"].includes(match?.status)) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [match?.status]);

  const action = async (fn) => {
    setBusy(true); setMessage("");
    try {
      const data = await fn();
      applySnapshot(data);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };

  const playAgain = useCallback(async () => {
    setMatch(null); setStatus(null); setMessage(""); setActivity("lobby");
    await action(match?.kind === "private" ? worldApi.createPrivateDuel : worldApi.queueDuel);
  }, [match?.kind]);
  const sessionId = status?.sessionId || (userId === match?.player_one_id ? match?.session_one_id : match?.session_two_id);
  if (sessionId && ["active", "complete"].includes(match?.status)) return <GameMode mode="duel" sessionId={sessionId} battle={status} onBattleRefresh={() => refresh(match.id)} onActivityChange={setActivity} onDuelAgain={playAgain} onHudChange={onHudChange} authenticated={authenticated} onAccountChange={onAccountChange} onOpenPanel={onOpenPanel} onSaveProgress={onSaveProgress} currentStreak={currentStreak} haptic={haptic} unlockAudio={unlockAudio} />;

  if (status && ["lobby", "countdown"].includes(match?.status)) return <section className="duel-workspace duel-lobby-workspace">
    <BattleHeader snapshot={status} now={now} />
    <div className={`duel-lobby-stage is-${match.status}`}>
      {match.status === "countdown" ? <><Swords /><strong>Battle starts in {Math.max(1, Math.ceil((new Date(status.countdownEndsAt).getTime() - now) / 1000))}</strong><span>Both players connected</span></> : <><Radio /><strong>Waiting for your friend</strong><span>The match starts automatically when both players are online.</span></>}
      {match.invite_code && <code>{match.invite_code}</code>}
    </div>
    {message && <p className="workspace-message" role="status">{message}</p>}
  </section>;

  if (status && match?.status === "active" && !sessionId) return <section className="duel-workspace duel-lobby-workspace">
    <BattleHeader snapshot={status} now={now} />
    <div className="duel-lobby-stage"><WifiOff /><strong>Your seat is no longer active</strong><span>Your opponent is finishing this ranked battle.</span></div>
  </section>;

  return <section className="duel-workspace">
    <div className="arena-heading"><div><span>Versus</span><h1>Ranked Duel</h1></div><Swords /></div>
    {match?.status === "waiting" ? <div className="matchmaking-state"><div className="matchmaking-radar"><Swords /></div><strong>Searching for rival</strong><span>Finding an available opponent. The match starts automatically.</span><button className="secondary-world-command" onClick={() => refresh(match.id)}><RefreshCw />Refresh</button></div> : <div className="duel-actions">
      <button type="button" className="duel-action" disabled={busy} onClick={() => action(worldApi.queueDuel)}><Gauge /><strong>Find rival</strong><span>Enter ranked matchmaking</span><ChevronRight /></button>
      <button type="button" className="duel-action" disabled={busy} onClick={() => action(worldApi.createPrivateDuel)}><Swords /><strong>Create private duel</strong><span>Share a six-letter code</span><ChevronRight /></button>
      <div className="invite-entry"><input value={invite} onChange={(event) => setInvite(event.target.value.toUpperCase().slice(0, 6))} placeholder="INVITE" aria-label="Invite code" /><button disabled={busy || invite.length !== 6} onClick={() => action(() => worldApi.joinPrivateDuel(invite))}>Join</button></div>
    </div>}
    {message && <p className="workspace-message" role="status">{message}</p>}
  </section>;
}

function BattleHeader({ snapshot, now = Date.now() }) {
  const match = snapshot?.match || {};
  const self = snapshot?.self;
  const opponent = snapshot?.opponent;
  const countdown = match.status === "countdown" && snapshot.countdownEndsAt ? Math.max(0, new Date(snapshot.countdownEndsAt).getTime() - now) : 0;
  const remaining = match.status === "active" && match.deadline ? Math.max(0, new Date(match.deadline).getTime() - now) : 0;
  return <header className={`battle-header ${remaining > 0 && remaining <= 20000 ? "is-pressure" : ""}`}>
    <BattlePlayer participant={self} label="You" />
    <div className="battle-center" aria-label="Battle status">
      <Swords />
      <strong>{countdown ? String(Math.max(1, Math.ceil(countdown / 1000))) : remaining ? formatDuration(remaining) : match.status === "complete" ? "Final" : "VS"}</strong>
      <span>{battleLead(self, opponent)}</span>
    </div>
    <BattlePlayer participant={opponent} label="Rival" opponent />
    <div className="battle-callout" role="status" aria-live="polite"><Activity />{opponentCallout(opponent)}</div>
  </header>;
}

function BattlePlayer({ participant, label, opponent = false }) {
  const initials = (participant?.handle || "Waiting").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <section className={`battle-player ${opponent ? "is-opponent" : "is-self"}`} aria-label={`${label}: ${participant?.handle || "waiting"}`}>
    <div className="battle-identity">
      <span className="battle-avatar" data-seed={participant?.avatar_seed || "waiting"}>{participant?.avatar_url ? <img src={participant.avatar_url} alt="" /> : initials}</span>
      <span><small>{label}</small><strong>{participant?.handle || "Waiting..."}</strong><em>{capitalize(participant?.division || "unranked")} · {participant?.rating_before || 1000}</em></span>
    </div>
    <div className="battle-progress" aria-label={`${participant?.guesses_used || 0} of 6 guesses used`}>{Array.from({ length: 6 }, (_, index) => <i key={index} className={index < (participant?.guesses_used || 0) ? "is-used" : ""} />)}</div>
    <div className={`battle-live is-${participant?.connection_state || "offline"}`}><span />{liveStateLabel(participant)}</div>
  </section>;
}

function liveStateLabel(participant) {
  if (!participant) return "Waiting";
  if (participant.connection_state === "reconnecting") return "Reconnecting";
  if (participant.connection_state === "expired") return "Connection lost";
  return ({ lobby: "Online", ready: "Ready", thinking: "Thinking", typing: "Typing", checking: "Checking", locked_in: "Locked in", solved: "Solved", finished: "Finished" })[participant.live_state] || "Online";
}

function opponentCallout(opponent) {
  if (!opponent) return "Waiting for an opponent";
  const state = liveStateLabel(opponent);
  if (opponent.status === "won") return `${opponent.handle} solved in ${opponent.guesses_used} guesses`;
  if (opponent.status === "forfeit") return `${opponent.handle} forfeited`;
  return `${opponent.handle} · ${state}`;
}

function battleLead(self, opponent) {
  if (!self || !opponent) return "Waiting";
  if (self.status === "won" && opponent.status !== "won") return "You lead";
  if (opponent.status === "won" && self.status !== "won") return "Rival ahead";
  if (self.guesses_used === opponent.guesses_used) return "Neck and neck";
  return self.guesses_used < opponent.guesses_used ? "You lead" : "Rival ahead";
}

function LeagueMode({ onHudChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [seasonInfoOpen, setSeasonInfoOpen] = useState(false);
  useEffect(() => {
    let active = true;
    worldApi.tournamentStatus().then((result) => active && setData(result)).catch((next) => active && setError(next.message));
    const subscriptions = [];
    try {
      subscriptions.push(worldEntities.LeaderboardEntry.subscribe((event) => setData((current) => {
        if (!current) return current;
        const inCohort = (entry) => entry.season_id === current.season.id
          && entry.division === current.membership.division
          && entry.cohort === current.membership.cohort;
        return { ...current, leaderboard: rankLeaderboard(applyCollectionEvent(current.leaderboard, event, inCohort)) };
      })));
    } catch { /* initial load remains */ }
    try {
      subscriptions.push(worldEntities.PlayerProfile.subscribe((event) => setData((current) => {
        if (!current || !event.data?.user_id) return current;
        const identity = event.type === "delete" ? { avatar_url: undefined, avatar_seed: undefined } : {};
        for (const key of ["handle", "avatar_url", "avatar_seed"]) {
          if (event.data[key] !== undefined) identity[key] = event.data[key];
        }
        const relevant = current.membership.user_id === event.data.user_id
          || current.leaderboard.some((entry) => entry.user_id === event.data.user_id);
        if (!relevant) return current;
        const leaderboard = current.leaderboard.map((entry) => entry.user_id === event.data.user_id ? { ...entry, ...identity } : entry);
        const membership = current.membership.user_id === event.data.user_id ? { ...current.membership, ...identity } : current.membership;
        return { ...current, leaderboard, membership };
      })));
    } catch { /* hydrated identities remain available from initial load */ }
    try {
      subscriptions.push(worldEntities.LeagueMembership.subscribe((event) => setData((current) => {
        if (!current || event.type === "delete" || event.data?.user_id !== current.membership.user_id || event.data.season_id !== current.season.id) return current;
        return { ...current, membership: { ...current.membership, ...event.data } };
      })));
    } catch { /* initial load remains */ }
    try {
      subscriptions.push(worldEntities.CupBracket.subscribe((event) => setData((current) => {
        if (!current) return current;
        const inCohort = (bracket) => bracket.season_id === current.season.id
          && bracket.division === current.membership.division
          && bracket.cohort === current.membership.cohort;
        return { ...current, brackets: applyCollectionEvent(current.brackets, event, inCohort).sort((left, right) => left.round - right.round || left.slot - right.slot) };
      })));
    } catch { /* initial load remains */ }
    try {
      subscriptions.push(worldEntities.Season.subscribe((event) => setData((current) => {
        if (!current || event.id !== current.season.id || event.type === "delete" || !event.data) return current;
        return { ...current, season: { ...current.season, ...event.data } };
      })));
    } catch { /* initial load remains */ }
    return () => { active = false; subscriptions.forEach((unsubscribe) => unsubscribe?.()); };
  }, []);
  useEffect(() => { onHudChange(data ? `${capitalize(data.membership.division)} - Rank ${data.membership.rank || "-"}` : "Loading standings"); }, [data, onHudChange]);
  if (!data) return <section className="league-workspace">{error ? <InlineError message={error} /> : <ArenaLoader />}</section>;
  const checkIn = async (bracketId) => {
    try {
      await worldApi.checkIn(bracketId);
      setData((current) => current ? {
        ...current,
        brackets: current.brackets.map((bracket) => bracket.id !== bracketId ? bracket : {
          ...bracket,
          [bracket.player_one_id === current.membership.user_id ? "player_one_checked_in" : "player_two_checked_in"]: true,
        }),
      } : current);
    }
    catch (nextError) { setError(nextError.message); }
  };
  const seasonDays = Math.max(1, Math.round((new Date(data.season.ends_at).getTime() - new Date(data.season.starts_at).getTime()) / 86400000));
  return <section className="league-workspace">
    <div className="arena-heading league-heading"><div><span>Season League</span><h1>{data.season.name}</h1><small>{capitalize(data.membership.division)} division - Cohort {data.membership.cohort}</small><button className="league-season-guide" onClick={() => setSeasonInfoOpen(true)} aria-label={`Season length and rewards. ${seasonDays} day season`}><CalendarDays /><strong>{seasonDays}-day season</strong><Info /></button></div><div className="league-points"><strong>{data.membership.league_points}</strong><span>points</span></div></div>
    <div className="leaderboard" role="table" aria-label="Season leaderboard">
      {data.leaderboard.map((entry) => <div className={entry.user_id === data.membership.user_id ? "is-me" : ""} role="row" key={entry.id}><span>{entry.rank}</span><div className="leaderboard-player"><span className="leaderboard-avatar"><CircleUserRound />{entry.avatar_url && <img src={entry.avatar_url} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}</span><strong>{entry.handle}</strong></div><span>{entry.points}</span></div>)}
      {!data.leaderboard.length && <div className="empty-row">No ranks yet. Win a match to enter.</div>}
    </div>
    <div className={`cup-strip ${data.membership.cup_qualified ? "is-qualified" : ""}`}><Crown /><div><strong>{data.membership.cup_qualified ? "Cup qualified" : "Season Cup"}</strong><span>{data.brackets.length ? `${data.brackets.length} bracket matches` : "Top eight qualify"}</span></div></div>
    {data.brackets.length > 0 && <div className="bracket-list">{data.brackets.map((bracket) => {
      const mine = [bracket.player_one_id, bracket.player_two_id].includes(data.membership.user_id);
      const checked = bracket.player_one_id === data.membership.user_id ? bracket.player_one_checked_in : bracket.player_two_checked_in;
      return <div key={bracket.id}><span>R{bracket.round} - M{bracket.slot}</span><strong>{bracket.status.replace("_", " ")}</strong>{mine && bracket.status === "check_in" && <button disabled={checked} onClick={() => checkIn(bracket.id)}>{checked ? <Check /> : "Check in"}</button>}</div>;
    })}</div>}
    {error && <p className="workspace-message" role="status">{error}</p>}
    <SeasonLeagueInfoDialog season={seasonInfoOpen ? data.season : null} onClose={() => setSeasonInfoOpen(false)} />
  </section>;
}

function QuestPanel({ quests }) {
  const [busy, setBusy] = useState("");
  const [claimEffect, setClaimEffect] = useState(null);
  const claimEffectTimer = useRef(null);
  useEffect(() => () => window.clearTimeout(claimEffectTimer.current), []);
  const run = async (id, action) => { setBusy(id); try { await action(); } finally { setBusy(""); } };
  const claimReward = async (quest) => {
    setBusy(quest.id);
    try {
      await worldApi.claimQuest(quest.id);
      setClaimEffect({ id: quest.id, tokens: quest.reward_tokens });
      window.clearTimeout(claimEffectTimer.current);
      claimEffectTimer.current = window.setTimeout(() => setClaimEffect(null), 1600);
    } finally {
      setBusy("");
    }
  };
  if (!quests.length) return <EmptyPanel icon={Crown} title="No missions yet" text="New missions will appear here." />;
  return <div className="quest-list">{quests.map((quest) => {
    const complete = quest.progress >= quest.target;
    const celebrating = claimEffect?.id === quest.id;
    return <article className={`quest-item ${complete && !quest.claimed ? "is-claimable" : ""} ${celebrating ? "is-reward-claimed" : ""}`} key={quest.id}>
      <div className="quest-progress" style={/** @type {import("react").CSSProperties} */ ({ "--quest-progress": `${Math.min(100, (quest.progress / quest.target) * 100)}%` })}><span>{Math.min(quest.progress, quest.target)}/{quest.target}</span></div>
      <div><strong>{quest.title}</strong><span><Coins />{quest.reward_tokens} tokens</span></div>
      {complete ? <button className={`claim-reward-button ${quest.claimed ? "is-claimed" : ""}`} disabled={busy === quest.id || quest.claimed} onClick={() => claimReward(quest)}>{busy === quest.id ? "Claiming..." : quest.claimed ? <><Check />Claimed</> : <><Coins />Claim reward</>}</button> : <button className="icon-command" disabled={busy === quest.id || quest.rerolled} title="Reroll quest" onClick={() => run(quest.id, () => worldApi.rerollQuest(quest.id))}><RotateCcw /></button>}
      {celebrating && <div className="reward-claim-feedback" role="status" aria-live="polite"><Coins />+{claimEffect.tokens} tokens claimed</div>}
    </article>;
  })}</div>;
}

export function ShopPanel({ data, onMissions }) {
  const [busy, setBusy] = useState("");
  const [infoItem, setInfoItem] = useState(null);
  const [error, setError] = useState("");
  const owned = new Set((data?.inventory || []).map((item) => item.item_key));
  const buy = async (item) => { setBusy(item.id); setError(""); try { await worldApi.purchase(item.id); } catch (nextError) { setError(nextError.message); } finally { setBusy(""); } };
  const shieldCount = data?.account?.streak_shields || 0;
  const balance = data?.account?.token_balance || 0;
  const hasLockedItems = SHOP.some((item) => !owned.has(item.id) && !(item.id === "streak-shield" && shieldCount >= 2) && balance < item.price);
  return <><div className="drawer-balance"><Coins /><span><strong>{balance}</strong> tokens available</span></div>{hasLockedItems && <div className="earn-tokens-callout"><Target /><span><strong>Power up your wallet</strong><small>Complete missions and claim token rewards.</small></span><button onClick={onMissions}>Missions<ChevronRight /></button></div>}{error && <p className="shop-error" role="alert">{error}</p>}<div className="shop-list">{SHOP.map((item) => {
    const Icon = item.icon;
    const isOwned = owned.has(item.id);
    const atShieldLimit = item.id === "streak-shield" && shieldCount >= 2;
    const shortBy = Math.max(0, item.price - balance);
    const needsTokens = !isOwned && !atShieldLimit && shortBy > 0;
    return <article className={`shop-item ${needsTokens ? "is-token-short" : ""}`} key={item.id} style={/** @type {import("react").CSSProperties} */ ({ "--item-accent": item.accent })}>
      <span className="shop-swatch"><Icon /></span>
      <div className="shop-item-copy"><div className="shop-item-title"><strong>{item.name}</strong><button type="button" className="shop-info-button" onClick={() => setInfoItem(item)} aria-label={`About ${item.name}`} title={`About ${item.name}`}><Info /></button></div><span><Coins />{item.price}</span>{needsTokens && <small className="shop-shortfall"><LockKeyhole />{shortBy} tokens short</small>}</div>
      <button className={`shop-buy-button ${needsTokens ? "is-earn" : ""}`} disabled={busy === item.id || isOwned || atShieldLimit} onClick={needsTokens ? onMissions : () => buy(item)} aria-label={needsTokens ? `Earn ${shortBy} more tokens in Missions` : undefined}>{isOwned ? <Check /> : atShieldLimit ? "2/2" : needsTokens ? <><Target />Earn</> : "Buy"}</button>
    </article>;
  })}</div><ShopItemInfoDialog item={infoItem} owned={infoItem ? owned.has(infoItem.id) : false} shieldCount={shieldCount} balance={balance} onEarn={() => { setInfoItem(null); onMissions(); }} onClose={() => setInfoItem(null)} /></>;
}

function ProfilePanel({ data, onLogout }) {
  const profile = data?.profile;
  const account = data?.account;
  const avatarInput = useRef(null);
  const [editingNickname, setEditingNickname] = useState(false);
  const [nickname, setNickname] = useState(profile?.handle || "");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState(null);
  const [infoTopic, setInfoTopic] = useState(null);
  const renameCost = (profile?.rename_count || 0) === 0 ? 0 : 500;
  const normalizedNickname = nickname.trim().replace(/\s+/g, " ");
  const nicknameValid = /^[a-zA-Z0-9 _-]{3,20}$/.test(normalizedNickname);
  const canAffordRename = renameCost === 0 || (account?.token_balance || 0) >= renameCost;

  useEffect(() => { setNickname(profile?.handle || ""); }, [profile?.handle]);

  const startNicknameEdit = () => {
    setNickname(profile?.handle || "");
    setMessage(null);
    setEditingNickname(true);
  };

  const saveNickname = async (event) => {
    event.preventDefault();
    if (!nicknameValid || normalizedNickname === profile?.handle || !canAffordRename) return;
    setBusy("nickname");
    setMessage(null);
    try {
      await worldApi.updateProfile({ nickname: normalizedNickname });
      setEditingNickname(false);
      setMessage({ type: "success", text: renameCost ? "Nickname updated. 500 coins spent." : "Nickname updated. Your free rename was used." });
    } catch (nextError) {
      setMessage({ type: "error", text: nextError.message });
    } finally {
      setBusy("");
    }
  };

  const updateAvatar = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage({ type: "error", text: "Choose a JPG, PNG, or WebP image." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: "error", text: "Choose an image smaller than 5 MB." });
      return;
    }
    setBusy("avatar");
    setMessage(null);
    try {
      const avatarUrl = await worldApi.uploadAvatar(file);
      await worldApi.updateProfile({ avatarUrl });
      setMessage({ type: "success", text: "Avatar updated." });
    } catch (nextError) {
      setMessage({ type: "error", text: nextError.message });
    } finally {
      setBusy("");
    }
  };

  const deleteAccount = async () => {
    setBusy("delete");
    setMessage(null);
    try {
      await worldApi.deleteAccount();
      window.localStorage.removeItem("wordle-world-guest-daily");
      onLogout();
    } catch (nextError) {
      setMessage({ type: "error", text: nextError.message });
      throw nextError;
    } finally {
      setBusy("");
    }
  };

  return <><div className="profile-panel">
    <div className={`profile-emblem profile-avatar ${busy === "avatar" ? "is-busy" : ""}`}>
      <CircleUserRound />
      {profile?.avatar_url && <img key={profile.avatar_url} src={profile.avatar_url} alt={`${profile.handle}'s avatar`} onError={(event) => { event.currentTarget.hidden = true; }} />}
      <button type="button" className="profile-avatar-action" disabled={Boolean(busy)} onClick={() => avatarInput.current?.click()} aria-label="Change avatar" title="Change avatar">{busy === "avatar" ? <Loader2 /> : <Camera />}</button>
      <input ref={avatarInput} className="profile-avatar-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={updateAvatar} />
    </div>
    {editingNickname ? <form className="profile-nickname-form" onSubmit={saveNickname}>
      <label htmlFor="profile-nickname">Nickname</label>
      <div><input id="profile-nickname" value={nickname} maxLength={20} autoComplete="nickname" autoFocus onChange={(event) => setNickname(event.target.value)} /><button type="submit" className={busy === "nickname" ? "is-loading" : ""} disabled={Boolean(busy) || !nicknameValid || normalizedNickname === profile?.handle || !canAffordRename} aria-label={renameCost ? "Rename for 500 coins" : "Save free rename"}>{busy === "nickname" ? <Loader2 /> : <Check />}</button><button type="button" onClick={() => setEditingNickname(false)} aria-label="Cancel nickname edit"><X /></button></div>
      <small className={!canAffordRename ? "has-error" : ""}>{renameCost === 0 ? "Your first rename is free." : `Rename cost: 500 coins. Balance: ${account?.token_balance || 0}.`}</small>
      {!nicknameValid && nickname.length > 0 && <small className="has-error">Use 3-20 letters, numbers, spaces, underscores, or hyphens.</small>}
    </form> : <div className="profile-identity"><h2>{profile?.handle}</h2><button type="button" disabled={Boolean(busy)} onClick={startNicknameEdit} aria-label="Edit nickname" title="Edit nickname"><Pencil /></button></div>}
    <span className="profile-level-label"><Zap />Level {profile?.level || 1}<button type="button" className="profile-info-button" onClick={() => setInfoTopic("level")} aria-label="How levels work" title="How levels work"><Info /></button></span>
    {message && <p className={`profile-update-message is-${message.type}`} role={message.type === "error" ? "alert" : "status"}>{message.text}</p>}
    <dl><div><dt><Zap />XP</dt><dd>{account?.xp_total || 0}</dd></div><div><dt><Flame />Streak</dt><dd>{account?.current_streak || 0}</dd></div><div><dt>Peak <button type="button" className="profile-info-button" onClick={() => setInfoTopic("peak")} aria-label="How peak division works" title="How peak division works"><Info /></button></dt><dd>{profile?.peak_division || "bronze"}</dd></div><div><dt>Wins</dt><dd>{profile?.games_won || 0}</dd></div></dl>
    <button className="secondary-world-command" onClick={onLogout}>Log out</button>
    <DeleteAccountDialog onConfirm={deleteAccount} className="secondary-world-command danger-command" />
  </div><ProgressionInfoDialog topic={infoTopic} account={account} profile={profile} onClose={() => setInfoTopic(null)} /></>;
}

function SignedOutPanel({ onLogin }) { return <div className="signed-out-panel"><div className="profile-emblem"><CircleUserRound /></div><strong>Playing as guest</strong><span>Your Daily progress stays on this device.</span><button className="primary-world-command" onClick={onLogin}><LogIn />Save progress</button></div>; }
function EmptyPanel({ icon: Icon, title, text }) { return <div className="empty-panel"><Icon /><strong>{title}</strong><span>{text}</span></div>; }
function InlineError({ message, onRetry = null }) { return <div className="inline-error" role="alert"><span>{message}</span>{onRetry && <button onClick={onRetry}><RefreshCw />Retry</button>}</div>; }
function ArenaLoader() { return <div className="arena-loader" role="status" aria-label="Loading arena"><span /><span /><span /><span /><span /></div>; }
function resultFrom(session, attempts, rewards) { return { status: session.status, solved: session.solved, answer: session.answer, attempts, rewards: rewards || null, extraChanceAvailable: session.extraChanceAvailable }; }
function phaseLabel(phase) { return ({ loading: "Loading arena", input: "Your move", submitting: "Checking word", revealing: "Reading tiles", won: "Victory", lost: "Round complete", transitioning: "Next round" })[phase] || phase; }
function formatDuration(ms) { const seconds = Math.ceil(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function capitalize(value = "") { return `${value.charAt(0).toUpperCase()}${value.slice(1)}`; }
function reduceMotion() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
