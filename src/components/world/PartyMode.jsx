import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot, Check, Clipboard, Copy, Crown, DoorOpen, Loader2, Play, Radio,
  RefreshCw, Share2, Sparkles, Trophy, UserPlus, Users, WifiOff,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { worldApi, trackWorld } from "@/api/worldClient";
import "./party.css";

const ROOM_STORAGE_KEY = "wordle-world-active-party";
const COMPLETE_STATES = new Set(["complete", "cancelled"]);
/** @type {any} */
const partyEntities = base44.entities;

export default function PartyMode({ GameComponent, gameProps, locationSearch, onHudChange }) {
  const [snapshot, setSnapshot] = useState(null);
  const [code, setCode] = useState(() => new URLSearchParams(locationSearch).get("room")?.toUpperCase() || "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [recapLoading, setRecapLoading] = useState(false);
  const [standingsOpen, setStandingsOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const autoJoined = useRef(false);
  const lastPresence = useRef({ activity: "", at: 0 });
  const room = snapshot?.room;
  const self = snapshot?.self;

  const loadRoom = useCallback(async (roomId, silent = false) => {
    if (!roomId) return;
    if (!silent) setBusy("loading");
    try {
      const next = await worldApi.partyStatus(roomId);
      setSnapshot(next);
      setError("");
      if (!COMPLETE_STATES.has(next.room.status)) window.localStorage.setItem(ROOM_STORAGE_KEY, next.room.id);
      else window.localStorage.removeItem(ROOM_STORAGE_KEY);
    } catch (nextError) {
      if (!silent) setError(nextError.message);
      if (nextError.code === "room_not_found") window.localStorage.removeItem(ROOM_STORAGE_KEY);
    } finally { if (!silent) setBusy(""); }
  }, []);

  const action = useCallback(async (name, request) => {
    setBusy(name);
    setError("");
    try {
      const next = await request();
      if (next?.room) {
        setSnapshot(next);
        window.localStorage.setItem(ROOM_STORAGE_KEY, next.room.id);
        trackWorld(`party_${name}`, { demo: Boolean(next.room.demo) });
      }
      return next;
    } catch (nextError) {
      setError(nextError.message);
      return null;
    } finally { setBusy(""); }
  }, []);

  useEffect(() => {
    if (autoJoined.current) return;
    autoJoined.current = true;
    const invite = new URLSearchParams(locationSearch).get("room")?.toUpperCase();
    if (invite) action("join", () => worldApi.joinParty(invite));
    else {
      const savedRoom = window.localStorage.getItem(ROOM_STORAGE_KEY);
      if (savedRoom) loadRoom(savedRoom);
    }
  }, [action, loadRoom, locationSearch]);

  useEffect(() => {
    if (!room?.id || room.status === "cancelled") return undefined;
    const interval = window.setInterval(() => {
      setNow(Date.now());
      loadRoom(room.id, true);
    }, room.status === "active" ? 4000 : 1800);
    const subscriptions = [];
    const refresh = (event) => {
      const eventRoomId = event.data?.room_id || (event.id === room.id ? room.id : "");
      if (eventRoomId === room.id) loadRoom(room.id, true);
    };
    try { subscriptions.push(partyEntities.PartyRoom.subscribe(refresh)); } catch { /* polling remains authoritative */ }
    try { subscriptions.push(partyEntities.PartyParticipant.subscribe(refresh)); } catch { /* polling remains authoritative */ }
    return () => {
      window.clearInterval(interval);
      subscriptions.forEach((unsubscribe) => unsubscribe?.());
    };
  }, [loadRoom, room?.id, room?.status]);

  const sendPresence = useCallback((activity) => {
    if (!room?.id) return;
    const timestamp = Date.now();
    if (timestamp - lastPresence.current.at < 1600 || (lastPresence.current.activity === activity && timestamp - lastPresence.current.at < 5000)) return;
    lastPresence.current = { activity, at: timestamp };
    worldApi.partyPresence(room.id, activity).catch(() => {});
  }, [room?.id]);

  useEffect(() => {
    if (!room?.id || room.status !== "active") return undefined;
    const updatePresence = () => sendPresence(document.hidden ? "away" : "thinking");
    document.addEventListener("visibilitychange", updatePresence);
    return () => document.removeEventListener("visibilitychange", updatePresence);
  }, [room?.id, room?.status, sendPresence]);

  useEffect(() => {
    if (!room) { onHudChange("Create or join a room"); return; }
    const detail = room.status === "lobby" ? `${snapshot.participants.length}/8 players`
      : room.status === "complete" ? "Final standings"
        : `Round ${Math.max(1, room.round_number)}/${room.round_count}`;
    onHudChange(detail);
  }, [onHudChange, room, snapshot?.participants?.length]);

  useEffect(() => {
    if (room?.status !== "complete" || snapshot?.recap || recapLoading) return;
    setRecapLoading(true);
    worldApi.partyRecap(room.id)
      .then((recap) => setSnapshot((current) => ({ ...current, recap })))
      .catch(() => {})
      .finally(() => setRecapLoading(false));
  }, [recapLoading, room?.id, room?.status, snapshot?.recap]);

  const copyInvite = async () => {
    const url = `${window.location.origin}/play/party?room=${room.invite_code}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const leave = async () => {
    if (!room) return;
    await action("leave", () => worldApi.leaveParty(room.id));
    window.localStorage.removeItem(ROOM_STORAGE_KEY);
    setSnapshot(null);
  };

  if (!room) return <PartyEntry code={code} setCode={setCode} busy={busy} error={error} onCreate={() => action("create", () => worldApi.createParty(false))} onDemo={() => action("demo", () => worldApi.createParty(true))} onJoin={() => action("join", () => worldApi.joinParty(code))} />;
  if (room.status === "cancelled") return <PartyMessage icon={WifiOff} title="Room expired" text="This room was inactive for 30 minutes." action="Create a new room" onAction={() => setSnapshot(null)} />;
  if (room.status === "complete") return <PartyFinal snapshot={snapshot} recapLoading={recapLoading} onAgain={() => { setSnapshot(null); setCode(""); }} />;
  if (room.status === "lobby") return <PartyLobby snapshot={snapshot} busy={busy} error={error} copied={copied} onCopy={copyInvite} onReady={(ready) => action("ready", () => worldApi.partyReady(room.id, ready))} onStart={() => action("start", () => worldApi.startParty(room.id))} onLeave={leave} />;
  if (["countdown", "between_rounds"].includes(room.status)) {
    const target = new Date(room.status === "countdown" ? room.countdown_ends_at : room.transition_ends_at).getTime();
    return <PartyTransition snapshot={snapshot} seconds={Math.max(0, Math.ceil((target - now) / 1000))} />;
  }

  return <section className="party-live" aria-label="Party Room live match">
    <PartyScoreRail participants={snapshot.participants} selfId={self?.user_id} round={room.round_number} open={standingsOpen} />
    <div className="party-board-stage">
      <div className="party-live-strip"><span><Radio />{room.demo ? "Demo broadcast" : "Live room"}</span><strong>Round {room.round_number} of {room.round_count}</strong><button aria-expanded={standingsOpen} onClick={() => setStandingsOpen((value) => !value)}><Users />Standings</button><b>{formatClock(new Date(room.deadline).getTime() - now)}</b></div>
      {self?.current_session_id ? <GameComponent key={self.current_session_id} mode="party" sessionId={self.current_session_id} {...gameProps} onHudChange={() => {}} onBattleRefresh={() => {}} onActivityChange={sendPresence} /> : <PartyMessage icon={Loader2} title="Preparing your board" text="The shared word is being sealed on the server." />}
    </div>
  </section>;
}

function PartyEntry({ code, setCode, busy, error, onCreate, onDemo, onJoin }) {
  return <section className="party-entry" aria-labelledby="party-title">
    <div className="party-entry-copy"><span><Radio />Live multiplayer</span><h1 id="party-title">Three words.<br />One room.</h1><p>Race up to seven friends across three server-authoritative rounds. Accuracy and speed build the final table.</p></div>
    <div className="party-entry-actions">
      <button className="party-primary" disabled={Boolean(busy)} onClick={onDemo}>{busy === "demo" ? <Loader2 /> : <Bot />}<span><strong>Start demo room</strong><small>Race three simulated rivals</small></span></button>
      <button className="party-secondary" disabled={Boolean(busy)} onClick={onCreate}>{busy === "create" ? <Loader2 /> : <Users />}<span><strong>Create private room</strong><small>Invite 2–8 players</small></span></button>
      <form className="party-code-form" onSubmit={(event) => { event.preventDefault(); onJoin(); }}>
        <label htmlFor="party-code">Join with a room code</label><div><input id="party-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6))} placeholder="ABC234" maxLength={6} /><button disabled={Boolean(busy) || code.length !== 6}>{busy === "join" ? <Loader2 /> : <UserPlus />}Join</button></div>
      </form>
      {error && <p className="party-error" role="alert">{error}</p>}
    </div>
  </section>;
}

function PartyLobby({ snapshot, busy, error, copied, onCopy, onReady, onStart, onLeave }) {
  const { room, participants, self } = snapshot;
  const host = room.host_user_id === self.user_id;
  const allReady = participants.length >= 2 && participants.every((item) => item.ready);
  return <section className="party-lobby" aria-labelledby="party-lobby-title">
    <header><span>Private room</span><h1 id="party-lobby-title">Build the starting grid</h1><p>Everyone must be ready before the host begins the three-round sprint.</p></header>
    <div className="party-room-code"><span>Room code</span><strong>{room.invite_code}</strong><button onClick={onCopy}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy invite"}</button></div>
    <div className="party-lobby-grid">{Array.from({ length: 8 }, (_, index) => <PartyLobbySeat key={index} participant={participants[index]} hostId={room.host_user_id} index={index} />)}</div>
    <div className="party-lobby-actions">
      <button className={self.ready ? "party-secondary is-ready" : "party-primary"} disabled={Boolean(busy)} onClick={() => onReady(!self.ready)}>{self.ready ? <Check /> : <Clipboard />}{self.ready ? "Ready" : "Mark ready"}</button>
      {host && <button className="party-primary" disabled={Boolean(busy) || !allReady} onClick={onStart}><Play />Start three rounds</button>}
      <button className="party-text-button" onClick={onLeave}><DoorOpen />Leave room</button>
    </div>
    {error && <p className="party-error" role="alert">{error}</p>}
  </section>;
}

function PartyLobbySeat({ participant, hostId, index }) {
  if (!participant) return <div className="party-seat is-empty"><span>{index + 1}</span><small>Open seat</small></div>;
  return <div className={`party-seat ${participant.ready ? "is-ready" : ""}`}><Avatar participant={participant} /><span><strong>{participant.handle}</strong><small>{participant.controller === "bot" ? "Demo rival" : participant.user_id === hostId ? "Host" : participant.ready ? "Ready" : "Not ready"}</small></span>{participant.ready && <Check />}</div>;
}

function PartyTransition({ snapshot, seconds }) {
  const between = snapshot.room.status === "between_rounds";
  return <section className="party-transition"><span>{snapshot.room.demo ? "Demo room · no progression" : between ? `Round ${snapshot.room.round_number} complete` : "Room locked"}</span><strong>{seconds || <Loader2 />}</strong><h1>{between ? `The word was ${snapshot.answer?.toUpperCase() || "sealed"}` : "Get ready"}</h1><p>{between ? "Scores are set. The next shared word is being prepared." : "Every player receives the same protected word."}</p><PartyScoreRail participants={snapshot.participants} selfId={snapshot.self?.user_id} round={snapshot.room.round_number} compact /></section>;
}

function PartyScoreRail({ participants, selfId, round, compact = false, open = false }) {
  return <aside className={`party-score-rail ${compact ? "is-compact" : ""} ${open ? "is-open" : ""}`} aria-label="Live standings"><header><span>Round {round}</span><strong>Live table</strong></header>{participants.map((participant, index) => <article key={participant.id} className={participant.user_id === selfId ? "is-self" : ""}><b>{participant.rank || index + 1}</b><Avatar participant={participant} /><div><strong>{participant.handle}</strong><MiniGrid rows={participant.progress_rows} /><small>{stateLabel(participant)}</small></div><em>{participant.total_score + (["playing", "solved"].includes(participant.status) ? participant.round_score : 0)}</em></article>)}</aside>;
}

function PartyFinal({ snapshot, recapLoading, onAgain }) {
  const podium = snapshot.participants.slice(0, 3);
  const share = async () => {
    const winner = snapshot.participants[0];
    const text = `Wordle World · ${snapshot.room.invite_code}\n${snapshot.participants.map((participant) => `${participant.rank}. ${participant.handle} — ${participant.total_score}`).join("\n")}\nWinner: ${winner.handle}`;
    if (navigator.share) await navigator.share({ title: "Wordle World results", text }).catch(() => {});
    else await navigator.clipboard.writeText(text);
  };
  return <section className="party-final" aria-labelledby="party-final-title"><header><span>Room complete</span><h1 id="party-final-title">Final standings</h1><p>Three shared words, ranked by accuracy and speed.</p></header><div className="party-podium">{podium.map((participant) => <div key={participant.id} className={`place-${participant.rank}`}><span>{participant.rank === 1 ? <Crown /> : <Trophy />}</span><Avatar participant={participant} /><strong>{participant.handle}</strong><b>{participant.total_score}</b><small>{participant.rounds_solved}/3 solved</small></div>)}</div><div className="party-final-table">{snapshot.participants.map((participant) => <div key={participant.id}><b>{participant.rank}</b><strong>{participant.handle}</strong><span>{participant.rounds_solved} solved · {participant.total_guesses} guesses</span><em>{participant.total_score}</em></div>)}</div><section className="party-round-breakdown" aria-label="Per-round score breakdown"><header><strong>Player</strong>{Array.from({ length: snapshot.room.round_count }, (_, index) => <strong key={index}>R{index + 1}</strong>)}<strong>Total</strong></header>{snapshot.participants.map((participant) => <div key={participant.id}><span>{participant.handle}</span>{Array.from({ length: snapshot.room.round_count }, (_, index) => <span key={index}>{participant.round_results[index]?.score || 0}</span>)}<b>{participant.total_score}</b></div>)}</section><section className="party-recap"><span><Sparkles />Base44 AI match desk</span>{recapLoading && <div className="party-recap-loading"><Loader2 />Writing the room report</div>}{snapshot.recap && <><h2>{snapshot.recap.headline}</h2><p>{snapshot.recap.summary}</p><div><strong>MVP · {snapshot.recap.mvp}</strong><span>{snapshot.recap.coachingTip}</span></div><small>{snapshot.recap.aiGenerated ? "Generated from verified match statistics" : "Verified fallback recap"}</small></>}</section><div className="party-final-actions"><button className="party-secondary" onClick={share}><Share2 />Share results</button><button className="party-primary" onClick={onAgain}><RefreshCw />Create another room</button></div></section>;
}

function PartyMessage({ icon: Icon, title, text, action = "", onAction = () => {} }) { return <section className="party-message"><Icon /><h1>{title}</h1><p>{text}</p>{action && <button className="party-primary" onClick={onAction}>{action}</button>}</section>; }
function Avatar({ participant }) { return <span className="party-avatar" aria-hidden="true">{participant.controller === "bot" ? <Bot /> : participant.handle?.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span>; }
function MiniGrid({ rows = [] }) { return <span className="party-mini-grid" aria-label={`${rows.length} guesses`}>{Array.from({ length: 6 }, (_, row) => <i key={row}>{Array.from({ length: 5 }, (_, column) => <b key={column} className={rows[row]?.[column] ? `is-${rows[row][column]}` : ""} />)}</i>)}</span>; }
function stateLabel(participant) { return participant.status === "solved" ? `Solved in ${participant.guesses_used}` : participant.live_state === "reconnecting" ? "Reconnecting" : participant.status === "finished" ? "Round finished" : participant.live_state === "typing" ? "Typing" : "Solving"; }
function formatClock(ms) { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
