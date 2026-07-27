import { optionalUser } from "./platform.js";
import { answerFor } from "./session-service.js";
import { assertWordInsightAccess, isWordInsight, publicWordInsight } from "./word-insight-rules.js";

const SCHEMA_VERSION = 1;
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    partOfSpeech: { type: "string", description: "The word's most common part of speech" },
    pronunciation: { type: "string", description: "A simple English phonetic respelling" },
    definition: { type: "string", description: "A concise learner-friendly definition" },
    example: { type: "string", description: "One natural sentence using the word" },
    origin: { type: "string", description: "A brief plain-language word origin" },
    usageNote: { type: "string", description: "A useful nuance, collocation, or usage tip" },
  },
  required: ["partOfSpeech", "pronunciation", "definition", "example", "origin", "usageNote"],
  additionalProperties: false,
};

export async function wordInsightForSession(base44, input = {}) {
  const sessionId = String(input.sessionId || "");
  if (!sessionId) throw Object.assign(new Error("Completed session is required"), { status: 400, code: "session_required" });
  const admin = base44.asServiceRole.entities;
  const user = await optionalUser(base44);
  const session = await admin.GameSession.get(sessionId);
  assertWordInsightAccess(session, user);

  const word = (await answerFor(admin, session)).toLowerCase();
  const cached = await admin.WordInsight.filter({ word, schema_version: SCHEMA_VERSION }, "-generated_at", 1);
  if (cached[0]) return publicWordInsight(cached[0]);

  const generated = await base44.integrations.Core.InvokeLLM({
    prompt: `You are a careful dictionary editor. Explain the English word "${word}" for a general audience. Use its most common modern meaning. Keep every field concise and factual. The example must use the word naturally. If the origin is uncertain, say so plainly. Return only the requested structured data.`,
    response_json_schema: RESPONSE_SCHEMA,
  });
  if (!isWordInsight(generated)) throw Object.assign(new Error("Word details could not be verified"), { status: 502, code: "invalid_ai_response" });

  const concurrent = await admin.WordInsight.filter({ word, schema_version: SCHEMA_VERSION }, "-generated_at", 1);
  const record = concurrent[0] || await admin.WordInsight.create({
    word,
    part_of_speech: generated.partOfSpeech.trim(),
    pronunciation: generated.pronunciation.trim(),
    definition: generated.definition.trim(),
    example: generated.example.trim(),
    origin: generated.origin.trim(),
    usage_note: generated.usageNote.trim(),
    generated_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  });
  return publicWordInsight(record);
}

export const WORD_INSIGHT_SCHEMA_VERSION = SCHEMA_VERSION;
