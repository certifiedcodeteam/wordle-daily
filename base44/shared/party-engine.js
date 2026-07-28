export const PARTY_ROUNDS = 3;
export const PARTY_ROUND_MS = 90000;
export const PARTY_COUNTDOWN_MS = 5000;
export const PARTY_TRANSITION_MS = 5000;
export const PARTY_MAX_PLAYERS = 8;

export function partyRoundScore({ solved, guessesUsed, elapsedMs }) {
  if (!solved) return 0;
  const guessPenalty = Math.max(0, guessesUsed - 1) * 100;
  const timePenalty = Math.min(300, Math.floor(Math.max(0, elapsedMs) / 1000) * 3);
  return Math.max(100, 1000 - guessPenalty - timePenalty);
}

export function comparePartyParticipants(left, right) {
  return (right.total_score || 0) - (left.total_score || 0)
    || (right.rounds_solved || 0) - (left.rounds_solved || 0)
    || (left.total_guesses || 0) - (right.total_guesses || 0)
    || (left.total_elapsed_ms || 0) - (right.total_elapsed_ms || 0)
    || String(left.handle || "").localeCompare(String(right.handle || ""));
}

export function rankPartyParticipants(participants) {
  return [...participants].sort(comparePartyParticipants).map((participant, index) => ({ ...participant, rank: index + 1 }));
}

export function partyProgressMask(evaluation = []) {
  const symbols = { correct: "c", present: "p", absent: "a" };
  return evaluation.map((value) => symbols[value] || "a").join("");
}

export function validPartyCode(value) {
  return /^[A-HJ-NP-Z2-9]{6}$/.test(String(value || "").toUpperCase());
}

export function partyCodeFromBytes(bytes) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(bytes).slice(0, 6).map((value) => alphabet[value % alphabet.length]).join("");
}

export function deterministicPartySeed(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function fallbackPartyRecap(participants) {
  const ranked = rankPartyParticipants(participants);
  const winner = ranked[0]?.handle || "The room";
  const solved = ranked.reduce((sum, item) => sum + (item.rounds_solved || 0), 0);
  return {
    headline: `${winner} takes the room`,
    summary: `${solved} words were solved across three fast rounds. The final table rewarded accurate guesses and quick finishes.`,
    mvp: winner,
    coachingTip: "Open with a balanced word, then use every revealed position before chasing uncommon letters.",
  };
}
