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
  claimQuest: (questId) => invoke("quests/claim", { questId, requestId: crypto.randomUUID() }),
  rerollQuest: (questId) => invoke("quests/reroll", { questId, requestId: crypto.randomUUID() }),
  queueDuel: () => invoke("duel/queue"),
  createPrivateDuel: () => invoke("duel/create-private"),
  joinPrivateDuel: (inviteCode) => invoke("duel/join-private", { inviteCode }),
  duelStatus: (matchId) => invoke("duel/status", { matchId }),
  forfeitDuel: (matchId) => invoke("duel/forfeit", { matchId }),
  tournamentStatus: () => invoke("tournament/status"),
  checkIn: (bracketId) => invoke("tournament/check-in", { bracketId }),
  importLegacy: (payload) => invoke("legacy/import", { payload }),
};

export function trackWorld(eventName, properties = {}) {
  base44.analytics?.track?.({ eventName, properties });
}
