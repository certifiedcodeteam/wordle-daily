import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import confetti from "canvas-confetti";
import {
  Delete as BackspaceIcon,
  BarChart3,
  CircleHelp,
  Cloud,
  CloudOff,
  LogIn,
  LogOut,
  Menu,
  Settings,
  Share2,
  UserCircle,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  calculateStats,
  COLS,
  createGame,
  evaluateGuess,
  getPuzzle,
  isValidGuess,
  keyboardStatuses,
  mergeStates,
  millisecondsToMidnight,
  normalizeState,
  ROWS,
  shareText,
  validateHardMode,
} from "@/lib/wordle/game";
import { loadLocalState, saveLocalState } from "@/lib/wordle/storage";
import DeleteAccountDialog from "@/components/wordle/DeleteAccountDialog";

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

function initialState() {
  const state = loadLocalState();
  const puzzle = getPuzzle();
  if (!state.games[puzzle.date]) state.games[puzzle.date] = createGame(puzzle);
  return state;
}

export default function WordleGame() {
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuth();
  const [state, setState] = useState(initialState);
  const [clock, setClock] = useState(() => new Date());
  const [searchParams, setSearchParams] = useSearchParams();
  const [welcomeOpen, setWelcomeOpen] = useState(() => !loadLocalState().seenWelcome);
  const modal = searchParams.get("modal");
  const menuOpen = modal === "menu";
  const [toast, setToast] = useState(null);
  const [shakeRow, setShakeRow] = useState(null);
  const [revealingRow, setRevealingRow] = useState(null);
  const [syncStatus, setSyncStatus] = useState("local");
  const cloudRecordRef = useRef(null);
  const hydratedUserRef = useRef(null);
  const toastTimerRef = useRef(null);

  const puzzle = useMemo(() => getPuzzle(clock), [clock.toDateString()]);
  const game = state.games[puzzle.date] || createGame(puzzle);
  const settings = state.settings;
  const stats = useMemo(() => calculateStats(state.games, clock), [state.games, clock.toDateString()]);
  const keyboard = useMemo(() => keyboardStatuses(game.guesses, puzzle.answer), [game.guesses, puzzle.answer]);
  const isFinished = game.status !== "playing";

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (state.games[puzzle.date]) return;
    setState((current) => touchState(current, {
      games: { ...current.games, [puzzle.date]: createGame(puzzle) },
    }));
  }, [puzzle.date]);

  useEffect(() => saveLocalState(state), [state]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event) => {
      setState((current) => {
        if (current.settings.darkModeUserSet) return current;
        return touchState(current, { settings: { ...current.settings, darkMode: event.matches } });
      });
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("wordle-dark", settings.darkMode);
    document.documentElement.classList.toggle("wordle-contrast", settings.highContrast);
    return () => {
      document.documentElement.classList.remove("wordle-dark", "wordle-contrast");
    };
  }, [settings.darkMode, settings.highContrast]);

  useEffect(() => {
    if (!isAuthenticated || !user || hydratedUserRef.current === user.id) return;
    let cancelled = false;
    setSyncStatus("syncing");
    base44.entities.WordlePlayerState.list("-updated_date", 20)
      .then(async (records) => {
        if (cancelled) return;
        let merged = state;
        records.forEach((record) => { merged = mergeStates(merged, record.payload); });
        cloudRecordRef.current = records[0] || null;
        hydratedUserRef.current = user.id;
        setState(merged);
        if (records[0]) {
          await base44.entities.WordlePlayerState.update(records[0].id, { state_version: 1, payload: merged });
        } else {
          cloudRecordRef.current = await base44.entities.WordlePlayerState.create({ state_version: 1, payload: merged });
        }
        if (!cancelled) setSyncStatus("synced");
      })
      .catch(() => { if (!cancelled) setSyncStatus("offline"); });
    return () => { cancelled = true; };
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    if (!isAuthenticated || !user || hydratedUserRef.current !== user.id || !cloudRecordRef.current) return;
    setSyncStatus("syncing");
    const timer = window.setTimeout(() => {
      base44.entities.WordlePlayerState.update(cloudRecordRef.current.id, { state_version: 1, payload: state })
        .then(() => setSyncStatus("synced"))
        .catch(() => setSyncStatus("offline"));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [state, isAuthenticated, user?.id]);

  const showToast = useCallback((message, duration = 1800) => {
    window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => setToast(null), duration);
  }, []);

  const openModal = useCallback((name) => {
    setSearchParams({ modal: name });
  }, [setSearchParams]);

  const closeModal = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const updateState = useCallback((transform) => {
    setState((current) => touchState(current, transform(current)));
  }, []);

  const updateGame = useCallback((nextGame) => {
    updateState((current) => ({ games: { ...current.games, [puzzle.date]: nextGame } }));
  }, [puzzle.date, updateState]);

  const shake = useCallback(() => {
    setShakeRow(game.guesses.length);
    window.setTimeout(() => setShakeRow(null), 520);
  }, [game.guesses.length]);

  const submitGuess = useCallback(() => {
    if (isFinished || revealingRow !== null) return;
    const guess = game.draft.toLowerCase();
    if (guess.length < COLS) {
      showToast("Not enough letters");
      shake();
      return;
    }
    if (!isValidGuess(guess)) {
      showToast("Not in word list");
      shake();
      return;
    }
    if (settings.hardMode) {
      const hardModeError = validateHardMode(guess, game.guesses, puzzle.answer);
      if (hardModeError) {
        showToast(hardModeError);
        shake();
        return;
      }
    }

    const guesses = [...game.guesses, guess];
    const won = guess === puzzle.answer;
    const lost = !won && guesses.length === ROWS;
    const nextGame = {
      ...game,
      guesses,
      draft: "",
      status: won ? "won" : lost ? "lost" : "playing",
      hardMode: settings.hardMode,
      completedAt: won || lost ? new Date().toISOString() : undefined,
      updatedAt: new Date().toISOString(),
    };
    updateGame(nextGame);
    setRevealingRow(guesses.length - 1);
    window.setTimeout(() => {
      setRevealingRow(null);
      if (won) {
        showToast(winMessage(guesses.length), 1300);
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          confetti({ particleCount: 110, spread: 68, origin: { y: 0.62 }, colors: ["#4f8f63", "#d4a853", "#f7f6f1"] });
        }
        window.setTimeout(() => openModal("stats"), 900);
      } else if (lost) {
        showToast(puzzle.answer.toUpperCase(), 2200);
        window.setTimeout(() => openModal("stats"), 1000);
      }
    }, 1500);
  }, [game, isFinished, puzzle.answer, revealingRow, settings.hardMode, shake, showToast, updateGame, openModal]);

  const handleKey = useCallback((key, physical = false) => {
    if (physical && settings.onscreenOnly) return;
    if (modal || welcomeOpen || isFinished || revealingRow !== null) return;
    if (key === "Enter") {
      submitGuess();
      return;
    }
    if (key === "Backspace") {
      updateGame({ ...game, draft: game.draft.slice(0, -1), updatedAt: new Date().toISOString() });
      return;
    }
    if (/^[a-zA-Z]$/.test(key) && game.draft.length < COLS) {
      updateGame({ ...game, draft: `${game.draft}${key.toLowerCase()}`, updatedAt: new Date().toISOString() });
    }
  }, [game, isFinished, modal, welcomeOpen, revealingRow, settings.onscreenOnly, submitGuess, updateGame]);

  useEffect(() => {
    const listener = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Enter" || event.key === "Backspace" || /^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault();
        handleKey(event.key, true);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [handleKey]);

  const setSetting = (name, value) => {
    const now = new Date().toISOString();
    setState((current) => touchState(current, {
      settings: {
        ...current.settings,
        [name]: value,
        ...(name === "darkMode" ? { darkModeUserSet: true } : {}),
      },
      settingsUpdatedAt: now,
    }));
  };

  const completeWelcome = () => {
    setState((current) => touchState(current, { seenWelcome: true }));
    setWelcomeOpen(false);
    openModal("help");
  };

  const share = async () => {
    const text = shareText(game, puzzle.answer, settings.highContrast);
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: "Wordle Daily", text });
        showToast("Shared");
      } else {
        await navigator.clipboard.writeText(text);
        showToast("Results copied to clipboard");
      }
    } catch (error) {
      if (error?.name !== "AbortError") showToast("Could not share results");
    }
  };

  const openAccount = () => {
    if (isAuthenticated) openModal("account");
    else navigate("/login");
  };

  const deleteAccount = async () => {
    if (isAuthenticated && user) {
      try {
        await base44.entities.WordlePlayerState.deleteMany({ created_by_id: user.id });
      } catch {
        showToast("Could not delete account data");
        return;
      }
      try {
        // Delete the auth profile as well, where supported by the platform.
        await base44.entities.User.delete(user.id);
      } catch {
        // Self-deletion of the auth profile is not supported; game data is already removed.
      }
    }
    showToast("Account data deleted");
    window.setTimeout(() => logout(true), 1200);
  };

  const rootClass = [
    "wordle-shell",
    settings.darkMode ? "theme-dark" : "",
    settings.highContrast ? "theme-contrast" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={rootClass}>
      <a className="skip-link" href="#wordle-board">Skip to game</a>
      <Header
        onMenu={() => openModal("menu")}
        onStats={() => openModal("stats")}
        onHelp={() => openModal("help")}
        onSettings={() => openModal("settings")}
        onAccount={openAccount}
        signedIn={isAuthenticated}
      />

      <main className="game-main" aria-label={`Wordle Daily puzzle ${puzzle.number}`}>
        <Board
          game={game}
          answer={puzzle.answer}
          shakeRow={shakeRow}
          revealingRow={revealingRow}
        />
        <Keyboard
          statuses={keyboard}
          onKey={(key) => handleKey(key, false)}
          canEnter={game.draft.length === COLS && !isFinished}
          canDelete={game.draft.length > 0 && !isFinished}
          disabled={isFinished || revealingRow !== null}
        />
      </main>

      <div className={`game-toast ${toast ? "is-visible" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>

      <AppMenu
        open={menuOpen}
        onOpenChange={(open) => (open ? openModal("menu") : closeModal())}
        onSelect={(target) => openModal(target)}
        onAccount={openAccount}
        signedIn={isAuthenticated}
        syncStatus={syncStatus}
      />
      <WelcomeModal open={welcomeOpen} onClose={completeWelcome} puzzle={puzzle} />
      <HelpModal open={modal === "help"} onOpenChange={(open) => (open ? openModal("help") : closeModal())} />
      <SettingsModal
        open={modal === "settings"}
        onOpenChange={(open) => (open ? openModal("settings") : closeModal())}
        settings={settings}
        setSetting={setSetting}
        hardModeLocked={game.guesses.length > 0}
        puzzleNumber={puzzle.number}
      />
      <StatsModal
        open={modal === "stats"}
        onOpenChange={(open) => (open ? openModal("stats") : closeModal())}
        stats={stats}
        game={game}
        answer={puzzle.answer}
        onShare={share}
        now={clock}
        signedIn={isAuthenticated}
        onSignIn={() => navigate("/login")}
      />
      <AccountModal
        open={modal === "account"}
        onOpenChange={(open) => (open ? openModal("account") : closeModal())}
        user={user}
        syncStatus={syncStatus}
        onLogout={() => logout(true)}
        onDeleteAccount={deleteAccount}
      />
    </div>
  );
}

function Header({ onMenu, onStats, onHelp, onSettings, onAccount, signedIn }) {
  return (
    <header className="game-header">
      <div className="header-side header-left">
        <IconButton label="Menu" onClick={onMenu}><Menu /></IconButton>
      </div>
      <button className="wordmark" onClick={onHelp} aria-label="Wordle Daily, open help">
        <span className="wordmark-grid" aria-hidden="true"><i /><i /><i /><i /></span>
        <span>Wordle Daily</span>
      </button>
      <nav className="header-side header-actions" aria-label="Game tools">
        <IconButton label="Statistics" onClick={onStats}><BarChart3 /></IconButton>
        <IconButton label="How to play" onClick={onHelp}><CircleHelp /></IconButton>
        <IconButton label="Settings" onClick={onSettings}><Settings /></IconButton>
        <IconButton label={signedIn ? "Account" : "Log in"} onClick={onAccount} className="account-button">
          {signedIn ? <UserCircle /> : <LogIn />}
        </IconButton>
      </nav>
    </header>
  );
}

function IconButton({ label, children, className = "", ...props }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

function Board({ game, answer, shakeRow, revealingRow }) {
  return (
    <section id="wordle-board" className="board" aria-label="Wordle board">
      {Array.from({ length: ROWS }, (_, rowIndex) => {
        const submitted = game.guesses[rowIndex];
        const isDraft = rowIndex === game.guesses.length && game.status === "playing";
        const letters = submitted || (isDraft ? game.draft : "");
        const evaluation = submitted ? evaluateGuess(submitted, answer) : [];
        return (
          <div
            className={`board-row ${shakeRow === rowIndex ? "is-shaking" : ""} ${game.status === "won" && rowIndex === game.guesses.length - 1 ? "is-winning" : ""}`}
            role="group"
            aria-label={`Row ${rowIndex + 1}`}
            key={rowIndex}
          >
            {Array.from({ length: COLS }, (_, columnIndex) => {
              const letter = letters[columnIndex] || "";
              const status = evaluation[columnIndex];
              const revealing = revealingRow === rowIndex;
              return (
                <div
                  key={columnIndex}
                  className={`tile ${letter && !status ? "is-filled" : ""} ${status ? `tile-${status}` : ""} ${revealing ? "is-revealing" : ""}`}
                  style={revealing ? { animationDelay: `${columnIndex * 280}ms` } : undefined}
                  role="img"
                  aria-label={`${ordinal(columnIndex + 1)} letter${letter ? `, ${letter.toUpperCase()}` : ", empty"}${status ? `, ${status}` : ""}`}
                >
                  <span>{letter}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}

function Keyboard({ statuses, onKey, canEnter, canDelete, disabled }) {
  return (
    <section className="keyboard" aria-label="Keyboard">
      {KEY_ROWS.map((row, rowIndex) => (
        <div className="keyboard-row" key={row}>
          {rowIndex === 2 && (
            <button className="key key-wide" onClick={() => onKey("Enter")} disabled={!canEnter || disabled} aria-label="Enter">Enter</button>
          )}
          {row.split("").map((letter) => (
            <button
              key={letter}
              className={`key ${statuses[letter] ? `key-${statuses[letter]}` : ""}`}
              onClick={() => onKey(letter)}
              disabled={disabled}
              aria-label={`Add ${letter.toUpperCase()}`}
            >{letter}</button>
          ))}
          {rowIndex === 2 && (
            <button className="key key-wide" onClick={() => onKey("Backspace")} disabled={!canDelete || disabled} aria-label="Backspace"><BackspaceIcon /></button>
          )}
        </div>
      ))}
    </section>
  );
}

function AppMenu({ open, onOpenChange, onSelect, onAccount, signedIn, syncStatus }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="wordle-sheet">
        <SheetHeader>
          <SheetTitle className="sheet-wordmark">Wordle Daily</SheetTitle>
          <SheetDescription className="sr-only">Game menu</SheetDescription>
        </SheetHeader>
        <div className="menu-list">
          <button onClick={() => onSelect("help")}><CircleHelp />How to play</button>
          <button onClick={() => onSelect("stats")}><BarChart3 />Statistics</button>
          <button onClick={() => onSelect("settings")}><Settings />Settings</button>
          <button onClick={onAccount}>{signedIn ? <UserCircle /> : <LogIn />}{signedIn ? "Account" : "Log in to sync"}</button>
        </div>
        <div className="menu-sync">
          {syncStatus === "synced" ? <Cloud /> : <CloudOff />}
          <span>{syncStatus === "synced" ? "Progress synced" : signedIn ? "Saving locally" : "Guest progress is saved on this device"}</span>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ModalFrame({ open, onOpenChange, title, description, children, className = "" }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`wordle-dialog ${className}`}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? "" : "sr-only"}>{description || title}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function WelcomeModal({ open, onClose, puzzle }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="wordle-dialog welcome-dialog">
        <DialogHeader className="welcome-header">
          <div className="welcome-mark" aria-hidden="true">
            {Array.from({ length: 9 }, (_, index) => <i key={index} className={index === 4 ? "gold" : index > 5 ? "green" : ""} />)}
          </div>
          <DialogTitle>Wordle Daily</DialogTitle>
          <DialogDescription>Get 6 chances to guess a 5-letter word.</DialogDescription>
        </DialogHeader>
        <button className="primary-command" onClick={onClose}>Play</button>
        <div className="welcome-meta">
          <time>{new Date(`${puzzle.date}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</time>
          <span>Puzzle #{puzzle.number}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HelpModal({ open, onOpenChange }) {
  return (
    <ModalFrame open={open} onOpenChange={onOpenChange} title="How to play" description="Guess the word in 6 tries.">
      <div className="help-copy">
        <ul>
          <li>Each guess must be a valid 5-letter word.</li>
          <li>The tile colors show how close your guess was.</li>
        </ul>
        <h3>Examples</h3>
        <Example word="weary" statusIndex={0} status="correct" text="W is in the word and in the correct spot." />
        <Example word="light" statusIndex={1} status="present" text="I is in the word but in the wrong spot." />
        <Example word="rogue" statusIndex={3} status="absent" text="U is not in the word in any spot." />
        <p className="daily-note">A new puzzle is released every day at midnight.</p>
      </div>
    </ModalFrame>
  );
}

function Example({ word, statusIndex, status, text }) {
  return (
    <div className="help-example">
      <div className="example-row" aria-label={word}>
        {word.split("").map((letter, index) => <span key={index} className={index === statusIndex ? `tile-${status}` : ""}>{letter}</span>)}
      </div>
      <p><strong>{word[statusIndex].toUpperCase()}</strong> {text.slice(2)}</p>
    </div>
  );
}

function SettingsModal({ open, onOpenChange, settings, setSetting, hardModeLocked, puzzleNumber }) {
  const rows = [
    ["hardMode", "Hard mode", "Revealed hints must be used in later guesses."],
    ["darkMode", "Dark theme", "Use a darker palette throughout the game."],
    ["highContrast", "High contrast", "Use blue and orange tile colors."],
    ["onscreenOnly", "Onscreen keyboard only", "Ignore physical keyboard input for assistive workflows."],
  ];
  return (
    <ModalFrame open={open} onOpenChange={onOpenChange} title="Settings" className="settings-dialog">
      <div className="settings-list">
        {rows.map(([key, label, description]) => (
          <div className="setting-row" key={key}>
            <div><h3>{label}</h3><p>{description}</p></div>
            <Switch
              checked={settings[key]}
              onCheckedChange={(checked) => setSetting(key, checked)}
              disabled={key === "hardMode" && hardModeLocked}
              aria-label={label}
            />
          </div>
        ))}
      </div>
      <p className="puzzle-meta">Wordle Daily #{puzzleNumber}</p>
    </ModalFrame>
  );
}

function StatsModal({ open, onOpenChange, stats, game, answer, onShare, now, signedIn, onSignIn }) {
  const finished = game.status !== "playing";
  return (
    <ModalFrame open={open} onOpenChange={onOpenChange} title="Statistics" className="stats-dialog">
      {finished && <p className="answer-line">Today’s word: <strong>{answer.toUpperCase()}</strong></p>}
      <StatGrid stats={stats} />
      <h3 className="distribution-title">Guess distribution</h3>
      <Distribution values={stats.distribution} />
      {!signedIn && (
        <button className="sync-callout" onClick={onSignIn}>
          <Cloud />
          <span><strong>Keep your stats</strong><small>Log in to sync across devices</small></span>
        </button>
      )}
      {finished && (
        <div className="result-actions">
          <div className="countdown"><span>Next Wordle</span><strong>{formatCountdown(millisecondsToMidnight(now))}</strong></div>
          <button className="share-button" onClick={onShare}><Share2 />Share</button>
        </div>
      )}
    </ModalFrame>
  );
}

function StatGrid({ stats }) {
  const values = [
    [stats.played, "Played"],
    [stats.winPercentage, "Win %"],
    [stats.currentStreak, "Current streak"],
    [stats.maxStreak, "Max streak"],
  ];
  return <div className="stat-grid">{values.map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>;
}

function Distribution({ values }) {
  const max = Math.max(...values, 1);
  return (
    <div className="distribution">
      {values.map((value, index) => (
        <div className="distribution-row" key={index}>
          <span>{index + 1}</span>
          <div style={{ width: `${Math.max(8, (value / max) * 100)}%` }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function AccountModal({ open, onOpenChange, user, syncStatus, onLogout, onDeleteAccount }) {
  return (
    <ModalFrame open={open} onOpenChange={onOpenChange} title="Account" className="account-dialog">
      <div className="account-summary">
        <UserCircle />
        <div><strong>{user?.full_name || "Wordle player"}</strong><span>{user?.email}</span></div>
      </div>
      <div className="account-sync">{syncStatus === "synced" ? <Cloud /> : <CloudOff />}<span>{syncLabel(syncStatus)}</span></div>
      <button className="secondary-command" onClick={onLogout}><LogOut />Log out</button>
      <DeleteAccountDialog onConfirm={onDeleteAccount} />
    </ModalFrame>
  );
}

function touchState(state, patch) {
  return normalizeState({ ...state, ...patch, updatedAt: new Date().toISOString() });
}

function ordinal(value) {
  return ["1st", "2nd", "3rd", "4th", "5th"][value - 1];
}

function winMessage(guesses) {
  return ["Genius", "Magnificent", "Impressive", "Splendid", "Great", "Phew"][guesses - 1];
}

function formatCountdown(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${remainder}`;
}

function syncLabel(status) {
  if (status === "synced") return "Progress is synced";
  if (status === "syncing") return "Syncing progress";
  if (status === "offline") return "Cloud unavailable. Progress is saved locally.";
  return "Progress is saved locally";
}