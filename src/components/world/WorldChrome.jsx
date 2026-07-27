// @ts-nocheck
import {
  CalendarDays, Check, ChevronRight, CircleUserRound, Coins, Crown, Flame,
  Infinity, Info, LogIn, Menu, Moon, Settings, ShoppingBag, Sparkles, Swords,
  Timer, Trophy, Volume2, VolumeX, Zap,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export const MODES = [
  { id: "daily", label: "Daily", title: "Daily Challenge", icon: Sparkles },
  { id: "endless", label: "Endless", title: "Endless Run", icon: Infinity },
  { id: "rush", label: "Rush", title: "Time Rush", icon: Timer },
  { id: "duel", label: "Duels", title: "Ranked Duel", icon: Swords },
  { id: "league", label: "League", title: "Season League", icon: Trophy },
];

export function GameHud({ mode, detail, account, profile, authenticated, missionRewardCount, soundEnabled, onToggleSound, onOpen }) {
  const modeInfo = MODES.find((item) => item.id === mode) || MODES[0];
  const ModeIcon = modeInfo.icon;
  return (
    <header className="game-hud">
      <div className="hud-leading">
        <button className="hud-icon-button" onClick={() => onOpen("modes")} aria-label="Open game modes" title="Game modes"><Menu /></button>
        <div className="world-brand" aria-label="Wordle World"><img className="world-brand-icon" src="/icons/wordle-world-192.png" alt="" aria-hidden="true" /><span>Wordle World</span></div>
      </div>
      <button className="hud-mode" onClick={() => onOpen("modes")} aria-label={`Current mode: ${modeInfo.title}. Open game modes`}>
        <ModeIcon />
        <span><strong>{modeInfo.title}</strong><small>{detail || "Preparing arena"}</small></span>
        <ChevronRight />
      </button>
      <div className="hud-actions">
        {authenticated && <>
          <button className={`hud-stat hud-missions ${missionRewardCount > 0 ? "has-rewards" : ""}`} onClick={() => onOpen("missions")} aria-label={`Level ${profile?.level || 1}, ${account?.current_streak || 0} day streak${missionRewardCount > 0 ? `, ${missionRewardCount} ${missionRewardCount === 1 ? "reward" : "rewards"} ready to claim` : ""}`} title={missionRewardCount > 0 ? `Missions - ${missionRewardCount} ${missionRewardCount === 1 ? "reward" : "rewards"} ready` : "Missions"}>
            <Trophy className="hud-mission-icon" /><Zap /><span>LV {profile?.level || 1}</span><Flame /><span>{account?.current_streak || 0}</span>
            {missionRewardCount > 0 && <RewardCount count={missionRewardCount} />}
          </button>
          <button className="hud-stat hud-coins" onClick={() => onOpen("shop")} aria-label={`${account?.token_balance || 0} tokens`} title="Shop"><Coins /><span>{account?.token_balance || 0}</span></button>
        </>}
        <button className="hud-icon-button" onClick={onToggleSound} aria-label={soundEnabled ? "Mute sound effects" : "Enable sound effects"} title={soundEnabled ? "Mute sound" : "Enable sound"}>{soundEnabled ? <Volume2 /> : <VolumeX />}</button>
        <button className="hud-icon-button hud-settings-button" onClick={() => onOpen("settings")} aria-label="Open game settings" title="Settings"><Settings /></button>
        <button className="hud-icon-button" onClick={() => onOpen(authenticated ? "profile" : "login")} aria-label={authenticated ? "Open player profile" : "Save progress"} title={authenticated ? "Profile" : "Save progress"}>{authenticated ? <CircleUserRound /> : <LogIn />}</button>
      </div>
    </header>
  );
}

export function ModeDrawer({ open, mode, onClose, onSelect }) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="left" className="world-drawer mode-drawer">
        <SheetHeader><SheetTitle>Choose your arena</SheetTitle><SheetDescription>Switch game mode</SheetDescription></SheetHeader>
        <nav className="mode-menu" aria-label="Game modes">
          {MODES.map(({ id, title, icon: Icon }) => <button key={id} className={mode === id ? "is-active" : ""} onClick={() => onSelect(id)} aria-current={mode === id ? "page" : undefined}>
            <Icon /><span><strong>{title}</strong><small>{modeDescription(id)}</small></span>{mode === id ? <Check /> : <ChevronRight />}
          </button>)}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

export function PlayerDrawer({ open, view, rewardCount, account, profile, onView, onClose, children }) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="world-drawer player-drawer">
        <SheetHeader><SheetTitle>{drawerTitle(view)}</SheetTitle><SheetDescription>Player progression and settings</SheetDescription></SheetHeader>
        {account && profile && <PlayerProgressSummary account={account} profile={profile} />}
        <div className="player-drawer-tabs" role="tablist" aria-label="Player menu">
          <DrawerTab id="missions" view={view} onView={onView} icon={Trophy} label="Missions" badgeCount={rewardCount} />
          <DrawerTab id="shop" view={view} onView={onView} icon={ShoppingBag} label="Shop" />
          <DrawerTab id="profile" view={view} onView={onView} icon={CircleUserRound} label="Profile" />
          <DrawerTab id="settings" view={view} onView={onView} icon={Settings} label="Settings" />
        </div>
        <div className="player-drawer-content">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

function PlayerProgressSummary({ account, profile }) {
  const xp = Math.max(0, account?.xp_total || 0);
  const level = profile?.level || 1;
  const levelStart = 100 * ((level - 1) ** 2);
  const nextLevel = 100 * (level ** 2);
  const levelRange = Math.max(1, nextLevel - levelStart);
  const levelXp = Math.min(levelRange, Math.max(0, xp - levelStart));
  const progress = (levelXp / levelRange) * 100;
  const remaining = Math.max(0, nextLevel - xp);

  return <section className="drawer-player-progress" aria-label="Player level and streak">
    <div className="drawer-progress-stats">
      <div><Zap /><span><small>Level</small><strong>{level}</strong></span></div>
      <div><Flame /><span><small>Streak</small><strong>{account?.current_streak || 0} days</strong></span></div>
      <b>{remaining} XP to level {level + 1}</b>
    </div>
    <div className="drawer-xp-track" role="progressbar" aria-label={`Level ${level} XP progress`} aria-valuemin={0} aria-valuemax={levelRange} aria-valuenow={levelXp}><span style={{ width: `${progress}%` }} /></div>
    <p>Earn XP from Daily and Endless wins, Time Rush words, and completed Ranked Duels. Each level needs more XP.</p>
  </section>;
}

function DrawerTab({ id, view, onView, icon: Icon, label, badgeCount = 0 }) {
  const rewardLabel = badgeCount > 0 ? `, ${badgeCount} ${badgeCount === 1 ? "reward" : "rewards"} ready to claim` : "";
  return <button role="tab" aria-selected={view === id} aria-label={`${label}${rewardLabel}`} className={view === id ? "is-active" : ""} onClick={() => onView(id)} title={`${label}${rewardLabel}`}><Icon /><span>{label}</span>{badgeCount > 0 && <RewardCount count={badgeCount} />}</button>;
}

function RewardCount({ count }) { return <span className="reward-count-badge" aria-hidden="true">{count > 99 ? "99+" : count}</span>; }

export function SettingsPanel({ preferences, onChange }) {
  return <div className="settings-panel">
    <SettingRow icon={preferences.soundEnabled ? Volume2 : VolumeX} title="Sound effects" description="Keys, reveals, and round results"><button className={`game-toggle ${preferences.soundEnabled ? "is-on" : ""}`} role="switch" aria-checked={preferences.soundEnabled} onClick={() => onChange("soundEnabled", !preferences.soundEnabled)}><span /></button></SettingRow>
    <SettingRow icon={Zap} title="Haptics" description="Short feedback on supported devices"><button className={`game-toggle ${preferences.hapticsEnabled ? "is-on" : ""}`} role="switch" aria-checked={preferences.hapticsEnabled} onClick={() => onChange("hapticsEnabled", !preferences.hapticsEnabled)}><span /></button></SettingRow>
    <SettingRow icon={Moon} title="Theme" description="Match your arena to the room"><div className="theme-control" aria-label="Theme">{["system", "light", "dark"].map((theme) => <button key={theme} className={preferences.theme === theme ? "is-active" : ""} onClick={() => onChange("theme", theme)}>{theme}</button>)}</div></SettingRow>
  </div>;
}

function SettingRow({ icon: Icon, title, description, children }) {
  return <div className="setting-row"><Icon /><span><strong>{title}</strong><small>{description}</small></span>{children}</div>;
}

export function ResultSheet({ open, result, streak, onClose, onPrimary, primaryLabel, onSecondary, secondaryLabel }) {
  if (!result) return null;
  const won = result.status === "won" || result.solved;
  return <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
    <DialogContent className={`result-sheet ${won ? "is-win" : "is-loss"}`}>
      <div className="result-emblem" aria-hidden="true">{won ? <Crown /> : <span>{result.answer?.slice(0, 1) || "?"}</span>}</div>
      <DialogTitle>{result.extraChanceAvailable ? "One chance left" : won ? "Victory" : result.status === "expired" ? "Time is up" : "Run over"}</DialogTitle>
      <DialogDescription>{result.extraChanceAvailable ? "Unlock one final guess to keep the streak alive." : won ? `Victory in ${result.attempts} ${result.attempts === 1 ? "guess" : "guesses"}.` : result.answer ? `The answer was ${result.answer.toUpperCase()}.` : "The round is complete."}</DialogDescription>
      <div className="result-scoreline">
        <ResultStat label="Answer" value={result.answer?.toUpperCase() || "-"} />
        <ResultStat label="Attempts" value={result.attempts} />
        <ResultStat label="XP" value={result.rewards?.xp || 0} prefix="+" />
        <ResultStat label="Tokens" value={result.rewards?.tokens || 0} prefix="+" />
        <ResultStat label="League" value={result.rewards?.leaguePoints || 0} prefix="+" />
        <ResultStat label="Streak" value={streak || 0} />
      </div>
      <div className="result-actions">
        {onPrimary && <button className="primary-world-command" onClick={onPrimary}>{primaryLabel}</button>}
        {onSecondary && <button className="secondary-world-command" onClick={onSecondary}>{secondaryLabel}</button>}
      </div>
    </DialogContent>
  </Dialog>;
}

export function DuelResultSheet({ snapshot, onAgain, onClose }) {
  if (!snapshot || snapshot.match?.status !== "complete") return null;
  const self = snapshot.self;
  const opponent = snapshot.opponent;
  const won = self?.status === "won" && snapshot.match.winner_user_id === self.user_id;
  const draw = !snapshot.match.winner_user_id;
  const title = draw ? "Dead heat" : won ? "Battle won" : "Rival wins";
  return <Dialog open onOpenChange={(next) => !next && onClose?.()}>
    <DialogContent className={`result-sheet duel-result-sheet ${won ? "is-win" : "is-loss"}`}>
      <div className="result-emblem" aria-hidden="true">{won ? <Crown /> : <Swords />}</div>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{draw ? "Neither player broke the tie." : won ? `${self.handle} takes the battle.` : `${opponent?.handle || "Your rival"} takes the battle.`}</DialogDescription>
      <div className="duel-result-scoreline" aria-label="Battle result">
        <ResultCombatant participant={self} label="You" winner={won} />
        <strong>VS</strong>
        <ResultCombatant participant={opponent} label="Rival" winner={!draw && !won} />
      </div>
      <div className="result-scoreline">
        <ResultStat label="Rating" value={Math.abs(self?.rating_change || 0)} prefix={(self?.rating_change || 0) >= 0 ? "+" : "-"} />
        <ResultStat label="XP" value={self?.reward_xp || 0} prefix="+" />
        <ResultStat label="Tokens" value={self?.reward_tokens || 0} prefix="+" />
        <ResultStat label="League" value={self?.league_points || 0} prefix="+" />
      </div>
      <div className="result-actions"><button className="primary-world-command" onClick={onAgain}>Play again</button></div>
    </DialogContent>
  </Dialog>;
}

function ResultCombatant({ participant, label, winner }) {
  return <div className={winner ? "is-winner" : ""}><small>{label}</small><strong>{participant?.handle || "-"}</strong><span>{participant?.status === "won" ? `${participant.guesses_used} guesses` : participant?.status || "finished"}</span></div>;
}

export function ProgressionInfoDialog({ topic, account, profile, onClose }) {
  const level = Math.max(1, profile?.level || 1);
  const xp = Math.max(0, account?.xp_total || 0);
  const firstLevel = Math.max(1, level - 2);
  const nearbyLevels = Array.from({ length: 5 }, (_, index) => firstLevel + index);
  const divisions = ["bronze", "silver", "gold", "platinum", "diamond"];
  const peak = profile?.peak_division || "bronze";

  return <Dialog open={Boolean(topic)} onOpenChange={(next) => !next && onClose()}>
    <DialogContent className="progression-info-dialog">
      <div className="progression-info-emblem" aria-hidden="true">{topic === "level" ? <Zap /> : <Trophy />}</div>
      <DialogTitle>{topic === "level" ? "Level structure" : "Peak division"}</DialogTitle>
      <DialogDescription>{topic === "level" ? "Your permanent XP progression." : "Your highest Season League division."}</DialogDescription>
      {topic === "level" ? <>
        <section className="progression-rule"><Info /><span><strong>XP never resets</strong><small>Level N starts at 100 x (N - 1)^2 total XP.</small></span></section>
        <div className="progression-list level-list" aria-label="Nearby level thresholds">
          {nearbyLevels.map((entry) => <div key={entry} className={entry === level ? "is-current" : xp >= 100 * ((entry - 1) ** 2) ? "is-reached" : ""}><span>Level {entry}</span><strong>{(100 * ((entry - 1) ** 2)).toLocaleString()} XP</strong>{entry === level && <b>Current</b>}</div>)}
        </div>
        <p className="progression-footnote">Earn XP from Daily and Endless wins, Time Rush words, and completed Ranked Duels.</p>
      </> : <>
        <div className="progression-list division-list" aria-label="League division order">
          {divisions.map((division, index) => <div key={division} className={`division-${division} ${division === peak ? "is-current" : ""}`}><span>{index + 1}</span><strong>{division}</strong>{division === peak && <b>Your peak</b>}</div>)}
        </div>
        <section className="progression-rule season-rule"><Trophy /><span><strong>Next-season placement</strong><small>Ranks 1-5 move up, 6-25 stay, and 26-30 move down one division.</small></span></section>
        <p className="progression-footnote">Peak always records your highest division, even if a later season starts lower.</p>
      </>}
    </DialogContent>
  </Dialog>;
}

export function ShopItemInfoDialog({ item, owned, shieldCount, balance, onEarn, onClose }) {
  if (!item) return null;
  const Icon = item.icon;
  const isShield = item.id === "streak-shield";
  const atShieldLimit = isShield && shieldCount >= 2;
  const shortBy = Math.max(0, item.price - (balance || 0));
  const needsTokens = !owned && !atShieldLimit && shortBy > 0;
  const status = owned ? "Owned" : atShieldLimit ? "2 of 2 carried" : needsTokens ? `${shortBy} short` : isShield ? `${Math.min(2, shieldCount || 0)} of 2 carried` : "Ready to buy";

  return <Dialog open={Boolean(item)} onOpenChange={(next) => !next && onClose()}>
    <DialogContent className="progression-info-dialog shop-info-dialog" style={/** @type {import("react").CSSProperties} */ ({ "--item-accent": item.accent })}>
      <div className="shop-info-emblem" aria-hidden="true"><Icon /></div>
      <DialogTitle>{item.name}</DialogTitle>
      <DialogDescription>{item.summary}</DialogDescription>
      <div className="shop-info-meta">
        <div><span>Type</span><strong>{item.type}</strong></div>
        <div><span>Price</span><strong><Coins />{item.price}</strong></div>
        <div><span>Status</span><strong>{status}</strong></div>
      </div>
      <section className="shop-info-detail"><Info /><span><strong>How it works</strong><p>{item.detail}</p></span></section>
      <p className="progression-footnote">{isShield ? "Streak Shields are consumed automatically when eligible." : "Cosmetics stay permanently in your inventory and can only be purchased once."}</p>
      {needsTokens && <button className="shop-info-earn-button" onClick={onEarn}>Complete missions for tokens<ChevronRight /></button>}
    </DialogContent>
  </Dialog>;
}

export function SeasonLeagueInfoDialog({ season, onClose }) {
  if (!season) return null;
  const starts = new Date(season.starts_at);
  const leagueEnds = new Date(season.league_ends_at);
  const ends = new Date(season.ends_at);
  const seasonDays = Math.max(1, Math.round((ends.getTime() - starts.getTime()) / 86400000));
  const leagueDays = Math.max(1, Math.round((leagueEnds.getTime() - starts.getTime()) / 86400000));
  const cupDays = Math.max(1, seasonDays - leagueDays);
  const dateRange = `${starts.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${ends.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  return <Dialog open={Boolean(season)} onOpenChange={(next) => !next && onClose()}>
    <DialogContent className="progression-info-dialog season-info-dialog">
      <div className="progression-info-emblem" aria-hidden="true"><CalendarDays /></div>
      <DialogTitle>Season League</DialogTitle>
      <DialogDescription>{season.name} runs {dateRange}.</DialogDescription>
      <div className="season-timeline" aria-label={`${seasonDays} day season`}><div style={{ flex: leagueDays }}><strong>League</strong><span>{leagueDays} days</span></div><div style={{ flex: cupDays }}><strong>Cup</strong><span>{cupDays} days</span></div></div>
      <section className="progression-rule season-qualification"><Trophy /><span><strong>Top eight qualify</strong><small>Finish in the top eight of your 30-player division cohort to enter the knockout Season Cup.</small></span></section>
      <div className="season-reward-list" aria-label="Season Cup rewards">
        <div className="is-champion"><Crown /><span><strong>Champion</strong><small>Season Cup Crown badge</small></span><b><Coins />250</b></div>
        <div><Trophy /><span><strong>Runner-up</strong><small>Finalist reward</small></span><b><Coins />150</b></div>
        <div><Sparkles /><span><strong>Semifinalist</strong><small>For losing in the semifinal</small></span><b><Coins />75</b></div>
      </div>
      <p className="progression-footnote">League rank determines Cup qualification and next-season placement. There is no separate end-of-season token payout for standings alone.</p>
    </DialogContent>
  </Dialog>;
}

function ResultStat({ label, value, prefix = "" }) { return <div><span>{label}</span><strong>{prefix}{value}</strong></div>; }
function drawerTitle(view) { return ({ missions: "Missions", shop: "Token shop", profile: "Player card", settings: "Game settings" })[view] || "Player"; }
function modeDescription(mode) { return ({ daily: "One shared puzzle. One shot today.", endless: "Keep solving. Keep earning.", rush: "Three minutes. Maximum score.", duel: "A matched rival is always ready.", league: "Climb your seasonal division." })[mode]; }
