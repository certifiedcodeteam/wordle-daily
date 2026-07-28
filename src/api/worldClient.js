import { base44 } from "@/api/base44Client";

async function invoke(name, data = {}) {
  try {
    const response = await base44.functions.invoke(name, data);
    return response.data;
  } catch (error) {
    const body = error?.response?.data;
    throw Object.assign(new Error(body?.error || error?.message || "Wordle World is unavailable"), {
      code: body?.code,
      status: error?.response?.status || error?.status,
    });
  }
}

export const worldApi = {
  bootstrap: () => invoke("game/bootstrap"),
  start: (mode, hardMode = false) => invoke("game/start", { mode, hardMode }),
  status: (sessionId) => invoke("game/status", { sessionId }),
  claimGuestSession: (sessionId) => invoke("game/claim-guest", { sessionId }),
  guess: (sessionId, guess, expectedVersion) => invoke("game/guess", { sessionId, guess, expectedVersion, requestId: crypto.randomUUID() }),
  buyExtraGuess: (sessionId) => invoke("game/buy-extra-guess", { sessionId, requestId: crypto.randomUUID() }),
  purchase: (itemId) => invoke("economy/purchase", { itemId, requestId: crypto.randomUUID() }),
  updateProfile: (changes) => invoke("profile/update", changes),
  deleteAccount: () => invoke("account/delete"),
  uploadAvatar: async (file) => {
    try {
      const result = await base44.integrations.Core.UploadFile({ file });
      if (!result?.file_url) throw new Error("Upload did not return a file URL");
      return result.file_url;
    } catch {
      throw new Error("Avatar upload failed. Try another image.");
    }
  },
  wordDetails: (sessionId) => invoke("game/word-details", { sessionId }),
  claimQuest: (questId) => invoke("quests/claim", { questId, requestId: crypto.randomUUID() }),
  rerollQuest: (questId) => invoke("quests/reroll", { questId, requestId: crypto.randomUUID() }),
  queueDuel: () => invoke("duel/queue"),
  currentDuel: () => invoke("duel/current"),
  createPrivateDuel: () => invoke("duel/create-private"),
  joinPrivateDuel: (inviteCode) => invoke("duel/join-private", { inviteCode }),
  duelStatus: (matchId) => invoke("duel/status", { matchId }),
  duelPresence: (matchId, activity) => invoke("duel/presence", { matchId, activity }),
  forfeitDuel: (matchId) => invoke("duel/forfeit", { matchId }),
  createParty: (demo = false) => invoke("party/create", { demo }),
  joinParty: (code) => invoke("party/join", { code }),
  partyReady: (roomId, ready) => invoke("party/ready", { roomId, ready }),
  startParty: (roomId) => invoke("party/start", { roomId }),
  partyStatus: (roomId) => invoke("party/status", { roomId }),
  partyPresence: (roomId, activity) => invoke("party/presence", { roomId, activity }),
  leaveParty: (roomId) => invoke("party/leave", { roomId }),
  partyRecap: (roomId) => invoke("party/recap", { roomId }),
  tournamentStatus: () => invoke("tournament/status"),
  checkIn: (bracketId) => invoke("tournament/check-in", { bracketId }),
  importLegacy: (payload) => invoke("legacy/import", { payload }),
  resetDemo: () => invoke("admin/reset-demo", { confirmation: "clear-and-seed-demo" }),
};

export function trackWorld(eventName, properties = {}) {
  base44.analytics?.track?.({ eventName, properties });
}
