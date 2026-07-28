import { useLayoutEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import {
  ArrowDownToLine, CalendarDays, Check, Clock3, Coins, Crown, Flame,
  Infinity, Medal, ShieldCheck, Sparkles, Swords, Timer, Trophy, Users, Zap,
} from "lucide-react";
import "./promo-capture.css";

const BOARD = [
  ["C", "R", "A", "N", "E"],
  ["S", "T", "O", "R", "M"],
  ["W", "O", "R", "L", "D"],
  ["", "", "", "", ""],
  ["", "", "", "", ""],
  ["", "", "", "", ""],
];

const TILE_STATES = [
  ["absent", "present", "absent", "absent", "correct"],
  ["absent", "absent", "correct", "present", "absent"],
  ["correct", "correct", "correct", "correct", "correct"],
];

const MODES = [
  { icon: Sparkles, label: "Daily" },
  { icon: Infinity, label: "Endless" },
  { icon: Timer, label: "Time Rush" },
  { icon: Swords, label: "Duels" },
  { icon: Users, label: "Party" },
  { icon: Trophy, label: "League" },
];

const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

function Brand({ light = false }) {
  return (
    <div className={`promo-brand ${light ? "is-light" : ""}`}>
      <img src="/icons/wordle-world-192.png" alt="" />
      <span>Wordle World</span>
    </div>
  );
}

function WordBoard({ compact = false }) {
  return (
    <div className={`promo-board ${compact ? "is-compact" : ""}`} aria-label="Solved Wordle board">
      {BOARD.map((row, rowIndex) => (
        <div className="promo-board-row" key={`row-${rowIndex}`}>
          {row.map((letter, columnIndex) => {
            const state = TILE_STATES[rowIndex]?.[columnIndex];
            return <span className={state ? `is-${state}` : ""} key={`${rowIndex}-${columnIndex}`}>{letter}</span>;
          })}
        </div>
      ))}
    </div>
  );
}

function Keyboard() {
  return (
    <div className="promo-keyboard" aria-hidden="true">
      {KEY_ROWS.map((row, index) => (
        <div key={row}>
          {index === 2 && <span className="is-wide">ENTER</span>}
          {[...row].map((key) => <span className={key === "W" || key === "O" || key === "R" || key === "L" || key === "D" ? "is-correct" : ""} key={key}>{key}</span>)}
          {index === 2 && <span className="is-wide">DEL</span>}
        </div>
      ))}
    </div>
  );
}

function ModeStack() {
  return (
    <div className="promo-mode-stack">
      {MODES.map(({ icon: Icon, label }, index) => (
        <div className={index === 0 ? "is-active" : ""} key={label}>
          <Icon />
          <span>{label}</span>
          {index === 0 && <Check className="mode-check" />}
        </div>
      ))}
    </div>
  );
}

function GameShell({ children, mode = "Daily Challenge", detail = "Puzzle #439" }) {
  return (
    <div className="promo-game-shell">
      <header>
        <Brand />
        <div className="promo-current-mode"><Sparkles /><span><strong>{mode}</strong><small>{detail}</small></span></div>
        <div className="promo-hud"><span><Zap />LV 8</span><span><Flame />24</span><span><Coins />280</span></div>
      </header>
      {children}
    </div>
  );
}

function DailyScene() {
  return (
    <div className="promo-artboard scene-daily" data-capture-name="wordle-world-daily">
      <div className="daily-copy">
        <Brand light />
        <span className="promo-kicker">REALTIME WORD RACES FOR 2–8 PLAYERS</span>
        <h1>Three words.<br />One room.</h1>
        <p>Shared rounds, live masked mini-grids, final podiums, and an AI match recap.</p>
        <div className="daily-mode-line"><Users /> Party rooms <Trophy /> Live placement <Sparkles /> AI recap</div>
      </div>
      <div className="daily-product">
        <GameShell>
          <div className="daily-game-layout">
            <ModeStack />
            <div className="daily-board-area">
              <div className="daily-board-heading"><span>DAILY CHALLENGE</span><strong>3 / 6</strong></div>
              <WordBoard />
              <Keyboard />
            </div>
          </div>
        </GameShell>
      </div>
    </div>
  );
}

function DuelScene() {
  return (
    <div className="promo-artboard scene-duel" data-capture-name="wordle-world-duel">
      <div className="duel-topline"><Brand /><span><Users /> LIVE 1V1</span></div>
      <div className="duel-copy">
        <span className="promo-kicker">RANKED AND PRIVATE DUELS</span>
        <h2>Same word.<br />First solve wins.</h2>
        <p>Challenge a friend or enter ranked matchmaking. Every guess changes the race.</p>
      </div>
      <div className="duel-arena">
        <div className="duel-player is-leading">
          <div><span className="duel-avatar">WC</span><span><strong>WordChamp</strong><small>Gold III</small></span></div>
          <b><Clock3 /> 00:18</b>
        </div>
        <div className="duel-board-wrap"><WordBoard compact /></div>
        <div className="duel-player">
          <div><span className="duel-avatar is-alt">LX</span><span><strong>Lexicon</strong><small>Gold II</small></span></div>
          <b><Clock3 /> 00:24</b>
        </div>
        <div className="duel-status"><Zap /> You solved it in 3 guesses</div>
      </div>
      <div className="duel-rank"><Medal /><span><small>RATING</small><strong>1,284</strong></span><b>+18</b></div>
    </div>
  );
}

function ProgressionScene() {
  const divisions = [
    { name: "Diamond", icon: Crown, active: false },
    { name: "Platinum", icon: ShieldCheck, active: false },
    { name: "Gold", icon: Medal, active: true },
    { name: "Silver", icon: Medal, active: false },
    { name: "Bronze", icon: Medal, active: false },
  ];
  return (
    <div className="promo-artboard scene-progression" data-capture-name="wordle-world-progression">
      <div className="progression-header"><Brand /><span>SEASON 8</span></div>
      <div className="progression-copy">
        <span className="promo-kicker">EVERY SOLVE MOVES YOU FORWARD</span>
        <h2>Play daily.<br />Rise all season.</h2>
        <p>Earn XP, complete missions, collect rewards, and qualify for the Season Cup.</p>
        <div className="progression-stats">
          <div><Zap /><strong>LV 8</strong><span>PLAYER LEVEL</span></div>
          <div><Flame /><strong>24</strong><span>DAY STREAK</span></div>
          <div><Coins /><strong>280</strong><span>TOKENS</span></div>
        </div>
      </div>
      <div className="league-panel">
        <div className="league-panel-title"><span><Trophy /> Season League</span><strong>1,284 PTS</strong></div>
        <div className="division-ladder">
          {divisions.map(({ name, icon: Icon, active }) => (
            <div className={active ? "is-active" : ""} key={name}><Icon /><span>{name}</span>{active && <b>YOU</b>}</div>
          ))}
        </div>
        <div className="cup-callout"><Crown /><span><strong>Season Cup</strong><small>Top eight players qualify</small></span><b>#3</b></div>
      </div>
      <div className="mission-panel">
        <span><CalendarDays /> TODAY'S MISSIONS</span>
        <div><Check /><p><strong>Win a Daily Challenge</strong><small>Completed</small></p><b>+20</b></div>
        <div><Swords /><p><strong>Play 2 ranked duels</strong><small>1 of 2</small></p><b>+35</b></div>
      </div>
    </div>
  );
}

function SocialScene() {
  return (
    <div className="promo-artboard promo-social-artboard scene-social" data-capture-name="wordle-world-social">
      <div className="social-copy">
        <Brand light />
        <span className="promo-kicker">REALTIME WORD RACES FOR 2–8 PLAYERS</span>
        <h1>Three words.<br />One room.</h1>
        <p>Live Party Rooms, protected answers, final podiums, and AI match recaps.</p>
        <div className="social-modes">
          <span><Users />Party</span><span><Sparkles />Daily</span><span><Swords />Duels</span><span><Trophy />Leagues</span>
        </div>
      </div>
      <div className="social-board-stack">
        <div className="social-streak"><Flame /><span><strong>24</strong><small>DAY STREAK</small></span></div>
        <div className="social-board-card"><WordBoard compact /><div className="social-solved"><Check /> SOLVED IN 3</div></div>
        <div className="social-rating"><Trophy /><span><strong>1,284</strong><small>RATING</small></span><b>+18</b></div>
      </div>
    </div>
  );
}

function CaptureCard({ title, description, fileName, width = 1200, height = 675, children }) {
  const shellRef = useRef(null);
  const artboardRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [isSaving, setIsSaving] = useState(false);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return undefined;
    const updateScale = () => setScale(Math.min(1, shell.clientWidth / width));
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [width]);

  const download = async () => {
    if (!artboardRef.current || isSaving) return;
    setIsSaving(true);
    try {
      const downloadName = `${fileName}.png`;
      const canvas = await html2canvas(artboardRef.current, {
        backgroundColor: null,
        scale: 1,
        useCORS: true,
        width,
        height,
        onclone: (documentClone) => {
          /** @type {HTMLElement | null} */
          const clone = documentClone.querySelector(`[data-export-name="${fileName}"]`);
          if (clone instanceof HTMLElement) clone.style.transform = "none";
        },
      });
      const link = document.createElement("a");
      link.download = downloadName;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="capture-card">
      <div className="capture-card-heading">
        <div><h2>{title}</h2><p>{description}</p></div>
        <button type="button" onClick={download} disabled={isSaving}><ArrowDownToLine />{isSaving ? "Rendering" : "Download PNG"}</button>
      </div>
      <div className="capture-shell" ref={shellRef} style={{ height: `${height * scale}px` }}>
        <div ref={artboardRef} data-export-name={fileName} style={{ width, height, transform: `scale(${scale})` }}>{children}</div>
      </div>
      <small>{width} × {height}px</small>
    </section>
  );
}

export default function PromoCapture() {
  return (
    <main className="promo-studio">
      <header className="promo-studio-header">
        <div><span>WORDLE WORLD</span><h1>Capture studio</h1><p>Export ready-made promotional artwork for the contest submission and social sharing.</p></div>
        <a href="/">Back to game</a>
      </header>
      <CaptureCard title="Party Arena" description="Best lead image for the submission. The realtime premise and full mode range read at a glance." fileName="wordle-world-daily"><DailyScene /></CaptureCard>
      <CaptureCard title="Live Duel" description="Use as a second attachment to highlight competitive multiplayer." fileName="wordle-world-duel"><DuelScene /></CaptureCard>
      <CaptureCard title="Season Journey" description="Use as a third attachment to show progression, leagues, missions, and rewards." fileName="wordle-world-progression"><ProgressionScene /></CaptureCard>
      <CaptureCard title="Social Share Card" description="This exact 1.91:1 composition powers link previews on Discord, X, LinkedIn, and other platforms." fileName="wordle-world-social" height={630}><SocialScene /></CaptureCard>
    </main>
  );
}
