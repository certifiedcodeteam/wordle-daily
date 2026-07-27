import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check, ChevronRight, CircleUserRound, Coins, Crown, Gauge,
  Infinity, Loader2, LogIn, Menu, RefreshCw, RotateCcw, Shield,
  ShoppingBag, Sparkles, Swords, Timer, Trophy, X,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { worldApi, trackWorld } from "@/api/worldClient";
import { useAuth } from "@/lib/AuthContext";

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const MODES = [
  { id: "daily", label: "Daily", icon: Sparkles },
  { id: "endless", label: "Endless", icon: Infinity },
  { id: "rush", label: "Rush", icon: Timer },
  { id: "duel", label: "Duels", icon: Swords },
  { id: "league", label: "League", icon: Trophy },
];
const SHOP = [
  { id: "streak-shield", name: "Streak shield", price: 50, icon: Shield },
  { id: "keycaps-forest", name: "Forest keys", price: 100, swatch: "#568f67" },
  { id: "keycaps-sunset", name: "Sunset keys", price: 140, swatch: "#d36b42" },
  { id: "board-midnight", name: "Midnight board", price: 220, swatch: "#302d3c" },
  { id: "victory-crown", name: "Victory crown", price: 400, icon: Crown },
];

/** @type {any} */
const worldEntities = base44.entities;

export default function WordleWorld() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuth();
  const [mode, setMode] = useState("daily");
  const [bootstrap, setBootstrap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sideView, setSideView] = useState("missions");
  const [mobileMenu, setMobileMenu] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await worldApi.bootstrap();
      setBootstrap(data);
      setError("");
      base44.appLogs?.logUserInApp?.("wordle-world").catch(() => {});
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !user) return undefined;
    const subscriptions = [];
    try { subscriptions.push(worldEntities.PlayerAccount.subscribe(load)); } catch { /* bootstrap polling remains available */ }
    try { subscriptions.push(worldEntities.PlayerQuest.subscribe(load)); } catch { /* bootstrap polling remains available */ }
    try { subscriptions.push(worldEntities.PlayerInventory.subscribe(load)); } catch { /* bootstrap polling remains available */ }
    return () => subscriptions.forEach((unsubscribe) => unsubscribe?.());
  }, [isAuthenticated, user?.id, load]);

  const selectMode = (nextMode) => {
    if (!isAuthenticated && nextMode !== "daily") {
      navigate("/login");
      return;
    }
    setMode(nextMode);
    setMobileMenu(false);
    trackWorld("mode_selected", { mode: nextMode });
  };

  if (loading && !bootstrap) return <WorldLoading />;

  return (
    <div className="world-shell">
      <a className="skip-link" href="#world-main">Skip to game</a>
      <WorldHeader
        profile={bootstrap?.profile}
        account={bootstrap?.account}
        authenticated={isAuthenticated}
        onMenu={() => setMobileMenu(true)}
        onProfile={() => {
          if (!isAuthenticated) { navigate("/login"); return; }
          setSideView("profile");
          setMobileMenu(true);
        }}
      />
      <div className="world-layout">
        <ModeRail mode={mode} onSelect={selectMode} />
        <main id="world-main" className="world-main">
          {error && <InlineError message={error} onRetry={load} />}
          {mode === "daily" && <GameMode key="daily" mode="daily" authenticated={isAuthenticated} onAccountChange={load} />}
          {mode === "endless" && <GameMode key="endless" mode="endless" authenticated={isAuthenticated} onAccountChange={load} />}
          {mode === "rush" && <GameMode key="rush" mode="rush" authenticated={isAuthenticated} onAccountChange={load} />}
          {mode === "duel" && <DuelMode onAccountChange={load} />}
          {mode === "league" && <LeagueMode />}
        </main>
        <WorldSidebar
          view={sideView}
          onView={setSideView}
          data={bootstrap}
          authenticated={isAuthenticated}
          onLogin={() => navigate("/login")}
          onRefresh={load}
          onLogout={() => logout(true)}
        />
      </div>
      <MobileNav mode={mode} onSelect={selectMode} />
      {mobileMenu && <MobileSheet onClose={() => setMobileMenu(false)}>
        <ModeRail mode={mode} onSelect={selectMode} mobile />
        <WorldSidebar
          view={sideView}
          onView={setSideView}
          data={bootstrap}
          authenticated={isAuthenticated}
          onLogin={() => navigate("/login")}
          onRefresh={load}
          onLogout={() => logout(true)}
        />
      </MobileSheet>}
    </div>
  );
}

function WorldHeader({ profile, account, authenticated, onMenu, onProfile }) {
  return (
    <header className="world-header">
      <button className="world-menu-button" onClick={onMenu} aria-label="Open modes"><Menu /></button>
      <div className="world-brand"><span className="world-brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>Wordle World</span></div>
      <div className="world-account-strip">
        {authenticated && <><span className="world-level">LV {profile?.level || 1}</span><span className="world-token"><Coins />{account?.token_balance || 0}</span></>}
        <button className="world-profile-button" onClick={onProfile} aria-label={authenticated ? "Open profile" : "Log in"}>
          {authenticated ? <CircleUserRound /> : <LogIn />}
        </button>
      </div>
    </header>
  );
}

function ModeRail({ mode, onSelect, mobile = false }) {
  return (
    <nav className={mobile ? "mode-rail is-mobile" : "mode-rail"} aria-label="Game modes">
      {MODES.map(({ id, label, icon: Icon }) => (
        <button key={id} className={mode === id ? "is-active" : ""} onClick={() => onSelect(id)} aria-current={mode === id ? "page" : undefined}>
          <Icon /><span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function GameMode({ mode, authenticated, onAccountChange, sessionId = "" }) {
  const [session, setSession] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [reward, setReward] = useState(null);
  const [clock, setClock] = useState(Date.now());
  const inputLocked = busy || !session || session.status !== "playing";
  const modeName = mode === "daily" ? "Global Daily" : mode === "endless" ? "Endless" : mode === "rush" ? "Rush" : "Ranked Duel";

  const start = useCallback(async () => {
    setBusy(true);
    setMessage("");
    setAttempts([]);
    setDraft("");
    setReward(null);
    try {
      const guestKey = "wordle-world-guest-daily";
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
      trackWorld("mode_started", { mode });
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }, [mode, sessionId]);

  useEffect(() => { start(); }, [start]);
  useEffect(() => {
    if (!session?.deadline || session.status !== "playing") return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [session?.deadline, session?.status]);
  useEffect(() => {
    if (mode !== "rush" || !session?.deadline || session.status !== "playing" || clock < new Date(session.deadline).getTime()) return;
    worldApi.status(session.sessionId).then((data) => { setSession(data); setReward(data.rewards); onAccountChange(); }).catch((error) => setMessage(error.message));
  }, [clock, mode, session, onAccountChange]);

  const submit = useCallback(async () => {
    if (inputLocked) return;
    if (draft.length !== 5) { setMessage("Not enough letters"); return; }
    setBusy(true);
    try {
      const result = await worldApi.guess(session.sessionId, draft, session.version);
      const attempt = { word: draft, evaluation: result.evaluation, sequence: attempts.length + 1 };
      setAttempts((current) => [...current, attempt]);
      setDraft("");
      setSession(result);
      setReward(result.rewards || null);
      setMessage(result.solved ? "Solved" : result.roundComplete ? "Next word" : "");
      if (result.rewards) onAccountChange();
      if (mode === "rush" && result.roundComplete) window.setTimeout(() => setAttempts([]), 650);
    } catch (error) {
      setMessage(error.message);
      if (error.code === "version_conflict") start();
    } finally { setBusy(false); }
  }, [attempts.length, draft, inputLocked, mode, onAccountChange, session, start]);

  const onKey = useCallback((key) => {
    if (inputLocked) return;
    if (key === "Enter") return submit();
    if (key === "Backspace") return setDraft((value) => value.slice(0, -1));
    if (/^[a-z]$/i.test(key)) setDraft((value) => value.length < 5 ? value + key.toLowerCase() : value);
  }, [inputLocked, submit]);

  useEffect(() => {
    const listener = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Enter" || event.key === "Backspace" || /^[a-z]$/i.test(event.key)) { event.preventDefault(); onKey(event.key); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onKey]);

  const buyExtra = async () => {
    setBusy(true);
    try {
      const data = await worldApi.buyExtraGuess(session.sessionId);
      setSession((current) => ({ ...current, ...data }));
      setMessage("Seventh guess unlocked");
      onAccountChange();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };

  const remaining = session?.deadline ? Math.max(0, new Date(session.deadline).getTime() - clock) : 0;
  const canBuyExtra = mode === "daily" && authenticated && session?.status === "lost" && session?.maxGuesses === 6;

  return (
    <section className="game-workspace" aria-label={modeName}>
      <div className="game-title-row">
        <div><h1>{modeName}</h1><span>{mode === "daily" ? `Puzzle #${session?.puzzleNumber || ""}` : mode === "rush" ? `${session?.solvedWords || 0} solved` : session?.status || "Loading"}</span></div>
        {session?.deadline && <div className="mode-timer"><Timer />{formatDuration(remaining)}</div>}
        {mode === "endless" && session?.status !== "playing" && <button className="icon-command" onClick={start} title="Next word"><RefreshCw /></button>}
      </div>
      <div className="game-board-wrap">
        {busy && !session ? <Loader2 className="world-spinner" /> : <WorldBoard attempts={attempts} draft={draft} rows={session?.maxGuesses || 6} />}
      </div>
      <WorldKeyboard attempts={attempts} onKey={onKey} disabled={inputLocked} />
      <div className="game-status" role="status" aria-live="polite">
        {busy && <Loader2 className="world-inline-spinner" />}
        <span>{message || (reward ? `+${reward.xp} XP · +${reward.tokens} tokens` : "")}</span>
      </div>
      {canBuyExtra && <button className="extra-command" onClick={buyExtra}><Coins />Use 30 tokens for guess 7</button>}
      {session?.status !== "playing" && mode === "endless" && <button className="primary-world-command" onClick={start}><RotateCcw />Play another</button>}
    </section>
  );
}

function WorldBoard({ attempts, draft, rows }) {
  return (
    <div className="world-board" style={/** @type {import("react").CSSProperties} */ ({ "--world-rows": rows })} role="grid" aria-label="Word grid">
      {Array.from({ length: rows }, (_, row) => {
        const attempt = attempts[row];
        const letters = attempt?.word || (row === attempts.length ? draft : "");
        return <div className="world-board-row" role="row" key={row}>{Array.from({ length: 5 }, (_, column) => {
          const status = attempt?.evaluation?.[column];
          return <div role="gridcell" key={column} className={`world-tile ${letters[column] ? "is-filled" : ""} ${status ? `tile-${status}` : ""}`}>{letters[column] || ""}</div>;
        })}</div>;
      })}
    </div>
  );
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
  return <div className="world-keyboard">{KEY_ROWS.map((row, index) => <div className="world-keyboard-row" key={row}>
    {index === 2 && <button className="is-wide" disabled={disabled} onClick={() => onKey("Enter")}>Enter</button>}
    {row.split("").map((letter) => <button key={letter} disabled={disabled} className={statuses[letter] ? `key-${statuses[letter]}` : ""} onClick={() => onKey(letter)}>{letter}</button>)}
    {index === 2 && <button className="is-wide" disabled={disabled} onClick={() => onKey("Backspace")} aria-label="Delete">⌫</button>}
  </div>)}</div>;
}

function DuelMode({ onAccountChange }) {
  const [match, setMatch] = useState(null);
  const [status, setStatus] = useState(null);
  const [invite, setInvite] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (matchId) => {
    try { const data = await worldApi.duelStatus(matchId); setStatus(data); setMatch(data.match); }
    catch (error) { setMessage(error.message); }
  }, []);

  useEffect(() => {
    if (!match?.id) return undefined;
    const timer = window.setInterval(() => refresh(match.id), 2500);
    let unsubscribe;
    try { unsubscribe = worldEntities.DuelMatch.subscribe((event) => { if (event.id === match.id) refresh(match.id); }); } catch { /* polling remains active */ }
    return () => { window.clearInterval(timer); unsubscribe?.(); };
  }, [match?.id, refresh]);

  const action = async (fn) => {
    setBusy(true); setMessage("");
    try {
      const data = await fn();
      const nextMatch = data.match || data;
      setMatch(nextMatch);
      if (nextMatch.id) await refresh(nextMatch.id);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };

  if (status?.sessionId && match?.status === "active") return <GameMode mode="duel" authenticated sessionId={status.sessionId} onAccountChange={onAccountChange} />;
  return <section className="duel-workspace">
    <div className="game-title-row"><div><h1>Duels</h1><span>{match?.status === "waiting" ? "Finding opponent" : "Season rating match"}</span></div><Swords /></div>
    {match?.status === "waiting" ? <div className="matchmaking-state"><Loader2 className="world-spinner" /><strong>Queue open</strong>{match.invite_code && <code>{match.invite_code}</code>}<button className="secondary-world-command" onClick={() => refresh(match.id)}><RefreshCw />Refresh</button></div> : <div className="duel-actions">
      <button className="duel-action" disabled={busy} onClick={() => action(worldApi.queueDuel)}><Gauge /><strong>Ranked</strong><span>Quick match</span><ChevronRight /></button>
      <button className="duel-action" disabled={busy} onClick={() => action(worldApi.createPrivateDuel)}><Swords /><strong>Private</strong><span>Create code</span><ChevronRight /></button>
      <div className="invite-entry"><input value={invite} onChange={(event) => setInvite(event.target.value.toUpperCase().slice(0, 6))} placeholder="INVITE" aria-label="Invite code" /><button disabled={busy || invite.length !== 6} onClick={() => action(() => worldApi.joinPrivateDuel(invite))}>Join</button></div>
    </div>}
    {message && <p className="workspace-message">{message}</p>}
  </section>;
}

function LeagueMode() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    worldApi.tournamentStatus().then((result) => active && setData(result)).catch((next) => active && setError(next.message));
    let unsubscribe;
    try { unsubscribe = worldEntities.LeaderboardEntry.subscribe(() => worldApi.tournamentStatus().then((result) => active && setData(result))); } catch { /* initial load remains */ }
    return () => { active = false; unsubscribe?.(); };
  }, []);
  if (!data) return <section className="league-workspace">{error ? <InlineError message={error} /> : <Loader2 className="world-spinner" />}</section>;
  const checkIn = async (bracketId) => {
    try { await worldApi.checkIn(bracketId); setData(await worldApi.tournamentStatus()); }
    catch (nextError) { setError(nextError.message); }
  };
  return <section className="league-workspace">
    <div className="league-heading"><div><h1>{data.season.name}</h1><span>{data.membership.division} · Cohort {data.membership.cohort}</span></div><div className="league-points"><strong>{data.membership.league_points}</strong><span>points</span></div></div>
    <div className="leaderboard" role="table" aria-label="Season leaderboard">
      {data.leaderboard.map((entry) => <div className={entry.user_id === data.membership.user_id ? "is-me" : ""} role="row" key={entry.id}><span>{entry.rank}</span><strong>{entry.handle}</strong><span>{entry.points}</span></div>)}
      {!data.leaderboard.length && <div className="empty-row">No scores yet</div>}
    </div>
    <div className="cup-strip"><Crown /><div><strong>Season Cup</strong><span>{data.brackets.length ? `${data.brackets.length} bracket matches` : "Top eight qualify"}</span></div></div>
    {data.brackets.length > 0 && <div className="bracket-list">{data.brackets.map((bracket) => {
      const mine = [bracket.player_one_id, bracket.player_two_id].includes(data.membership.user_id);
      const checked = bracket.player_one_id === data.membership.user_id ? bracket.player_one_checked_in : bracket.player_two_checked_in;
      return <div key={bracket.id}><span>R{bracket.round} · M{bracket.slot}</span><strong>{bracket.status.replace("_", " ")}</strong>{mine && bracket.status === "check_in" && <button disabled={checked} onClick={() => checkIn(bracket.id)}>{checked ? <Check /> : "Check in"}</button>}</div>;
    })}</div>}
    {error && <p className="workspace-message">{error}</p>}
  </section>;
}

function WorldSidebar({ view, onView, data, authenticated, onLogin, onRefresh, onLogout }) {
  return <aside className="world-sidebar">
    <div className="sidebar-tabs"><button className={view === "missions" ? "is-active" : ""} onClick={() => onView("missions")}><Check />Missions</button><button className={view === "shop" ? "is-active" : ""} onClick={() => onView("shop")}><ShoppingBag />Shop</button></div>
    {!authenticated ? <div className="signed-out-panel"><CircleUserRound /><strong>Guest play</strong><button className="primary-world-command" onClick={onLogin}><LogIn />Log in</button></div> : view === "shop" ? <ShopPanel data={data} onRefresh={onRefresh} /> : view === "profile" ? <ProfilePanel data={data} onLogout={onLogout} /> : <QuestPanel quests={data?.quests || []} onRefresh={onRefresh} />}
  </aside>;
}

function QuestPanel({ quests, onRefresh }) {
  const [busy, setBusy] = useState("");
  const run = async (id, action) => { setBusy(id); try { await action(); await onRefresh(); } finally { setBusy(""); } };
  return <div className="quest-list">{quests.map((quest) => <article className="quest-item" key={quest.id}>
    <div className="quest-ring"><span>{Math.min(quest.progress, quest.target)}/{quest.target}</span></div>
    <div><strong>{quest.title}</strong><span><Coins />{quest.reward_tokens}</span></div>
    {quest.progress >= quest.target ? <button disabled={busy === quest.id || quest.claimed} onClick={() => run(quest.id, () => worldApi.claimQuest(quest.id))}>{quest.claimed ? <Check /> : "Claim"}</button> : <button className="icon-command" disabled={busy === quest.id || quest.rerolled} title="Reroll quest" onClick={() => run(quest.id, () => worldApi.rerollQuest(quest.id))}><RotateCcw /></button>}
  </article>)}</div>;
}

function ShopPanel({ data, onRefresh }) {
  const [busy, setBusy] = useState("");
  const owned = new Set((data?.inventory || []).map((item) => item.item_key));
  const buy = async (item) => { setBusy(item.id); try { await worldApi.purchase(item.id); await onRefresh(); } finally { setBusy(""); } };
  return <div className="shop-list">{SHOP.map((item) => { const Icon = item.icon; return <article className="shop-item" key={item.id}><span className="shop-swatch" style={item.swatch ? { background: item.swatch } : undefined}>{Icon && <Icon />}</span><div><strong>{item.name}</strong><span><Coins />{item.price}</span></div><button disabled={busy === item.id || owned.has(item.id)} onClick={() => buy(item)}>{owned.has(item.id) ? <Check /> : "Buy"}</button></article>; })}</div>;
}

function ProfilePanel({ data, onLogout }) {
  const profile = data?.profile;
  const account = data?.account;
  return <div className="profile-panel"><CircleUserRound /><h2>{profile?.handle}</h2><span>Level {profile?.level || 1}</span><dl><div><dt>XP</dt><dd>{account?.xp_total || 0}</dd></div><div><dt>Streak</dt><dd>{account?.current_streak || 0}</dd></div><div><dt>Peak</dt><dd>{profile?.peak_division || "bronze"}</dd></div><div><dt>Wins</dt><dd>{profile?.games_won || 0}</dd></div></dl><button className="secondary-world-command" onClick={onLogout}>Log out</button></div>;
}

function MobileNav({ mode, onSelect }) {
  return <nav className="mobile-nav" aria-label="Game modes">{MODES.slice(0, 4).map(({ id, label, icon: Icon }) => <button key={id} className={mode === id ? "is-active" : ""} onClick={() => onSelect(id)}><Icon /><span>{label}</span></button>)}</nav>;
}
function MobileSheet({ children, onClose }) { return <div className="mobile-sheet-backdrop" onMouseDown={onClose}><div className="mobile-sheet" onMouseDown={(event) => event.stopPropagation()}><button className="sheet-close" onClick={onClose} aria-label="Close"><X /></button>{children}</div></div>; }
function InlineError({ message, onRetry = null }) { return <div className="inline-error"><span>{message}</span>{onRetry && <button onClick={onRetry}><RefreshCw />Retry</button>}</div>; }
function WorldLoading() { return <div className="world-loading"><span className="world-brand-mark"><i /><i /><i /><i /></span><Loader2 /></div>; }
function formatDuration(ms) { const seconds = Math.ceil(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
