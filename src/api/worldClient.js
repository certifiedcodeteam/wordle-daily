import { base44 } from "@/api/base44Client";

const wordDetailsCache = new Map();

const WORD_DETAILS_SCHEMA = {
  type: "object",
  properties: {
    partOfSpeech: { type: "string", description: "The word's most common part of speech" },
    pronunciation: { type: "string", description: "A simple English phonetic respelling" },
    definition: { type: "string", description: "A concise, learner-friendly definition" },
    example: { type: "string", description: "One natural sentence using the word" },
    origin: { type: "string", description: "A brief, plain-language word origin" },
    usageNote: { type: "string", description: "A useful nuance, common collocation, or usage tip" },
  },
  required: ["partOfSpeech", "pronunciation", "definition", "example", "origin", "usageNote"],
  additionalProperties: false,
};

/**
 * @param {unknown} value
 * @returns {value is { partOfSpeech: string, pronunciation: string, definition: string, example: string, origin: string, usageNote: string }}
 */
function isWordDetails(value) {
  if (!value || typeof value !== "object") return false;
  const candidate = /** @type {Record<string, unknown>} */ (value);
  return ["partOfSpeech", "pronunciation", "definition", "example", "origin", "usageNote"]
    .every((field) => typeof candidate[field] === "string" && candidate[field].trim().length > 0);
}

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
  wordDetails: async (word) => {
    const normalizedWord = String(word || "").trim().toLowerCase();
    if (!/^[a-z]{5}$/.test(normalizedWord)) throw new Error("Word details require a five-letter answer");
    if (wordDetailsCache.has(normalizedWord)) return wordDetailsCache.get(normalizedWord);

    const request = base44.integrations.Core.InvokeLLM({
      prompt: `You are a careful dictionary editor. Explain the English word "${normalizedWord}" for a general audience. Use its most common modern meaning. Keep every field concise and factual. The example must use the word naturally. If the origin is uncertain, say so plainly. Return only the requested structured data.`,
      response_json_schema: WORD_DETAILS_SCHEMA,
    }).then((result) => {
      if (!isWordDetails(result)) throw new Error("Invalid word details response");
      return { word: normalizedWord, ...result };
    });
    wordDetailsCache.set(normalizedWord, request);

    try {
      const details = await request;
      wordDetailsCache.set(normalizedWord, details);
      return details;
    } catch {
      wordDetailsCache.delete(normalizedWord);
      throw new Error("Word details are unavailable right now. Please try again.");
    }
  },
  claimQuest: (questId) => invoke("quests/claim", { questId, requestId: crypto.randomUUID() }),
  rerollQuest: (questId) => invoke("quests/reroll", { questId, requestId: crypto.randomUUID() }),
  queueDuel: () => invoke("duel/queue"),
  currentDuel: () => invoke("duel/current"),
  createPrivateDuel: () => invoke("duel/create-private"),
  joinPrivateDuel: (inviteCode) => invoke("duel/join-private", { inviteCode }),
  duelStatus: (matchId) => invoke("duel/status", { matchId }),
  duelPresence: (matchId, activity) => invoke("duel/presence", { matchId, activity }),
  forfeitDuel: (matchId) => invoke("duel/forfeit", { matchId }),
  tournamentStatus: () => invoke("tournament/status"),
  checkIn: (bracketId) => invoke("tournament/check-in", { bracketId }),
  importLegacy: (payload) => invoke("legacy/import", { payload }),
  resetDemo: () => invoke("admin/reset-demo", { confirmation: "clear-and-seed-demo" }),
};

export function trackWorld(eventName, properties = {}) {
  base44.analytics?.track?.({ eventName, properties });
}
