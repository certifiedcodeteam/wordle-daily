import { canAccessSession } from "./session-access.js";

export const WORD_INSIGHT_FIELDS = [
  "partOfSpeech", "pronunciation", "definition", "example", "origin", "usageNote",
];

export function assertWordInsightAccess(session, user) {
  if (!session || !canAccessSession(session, user)) {
    throw Object.assign(new Error("Session not found"), { status: 404, code: "not_found" });
  }
  if (session.status === "playing") {
    throw Object.assign(new Error("Word details unlock when the round is complete"), { status: 409, code: "round_incomplete" });
  }
  const extraChanceAvailable = Boolean(
    user && session.mode === "daily" && session.status === "lost" && session.guesses_used === 6 && session.max_guesses === 6,
  );
  if (extraChanceAvailable) {
    throw Object.assign(new Error("Use or decline the final guess before viewing the answer"), { status: 409, code: "extra_guess_available" });
  }
}

export function isWordInsight(value) {
  return Boolean(value && typeof value === "object" && WORD_INSIGHT_FIELDS
    .every((field) => typeof value[field] === "string" && value[field].trim().length > 0));
}

export function publicWordInsight(record) {
  return {
    word: record.word,
    partOfSpeech: record.part_of_speech,
    pronunciation: record.pronunciation,
    definition: record.definition,
    example: record.example,
    origin: record.origin,
    usageNote: record.usage_note,
    generatedBy: "base44-ai",
  };
}

