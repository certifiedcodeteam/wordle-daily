import { worldApi } from "@/api/worldClient";

export const AUTH_INTENT_KEY = "wordle-world-auth-intent";
export const GUEST_DAILY_KEY = "wordle-world-guest-daily";
const AUTH_INTENT_MAX_AGE_MS = 30 * 60 * 1000;

const PROTECTED_MODES = new Set(["endless", "rush", "duel", "league"]);

export const AUTH_PRESENTATIONS = {
  daily: {
    kicker: "Save your Daily",
    title: "Protect today's run",
    subtitle: "Keep this board and continue on any device.",
    action: "Save my run",
  },
  endless: {
    kicker: "Mode unlocked",
    title: "Unlock Endless Run",
    subtitle: "Keep solving, earning XP, and building your player record.",
    action: "Unlock Endless",
  },
  rush: {
    kicker: "Mode unlocked",
    title: "Enter Time Rush",
    subtitle: "Sign in for three-minute runs, scores, and rewards.",
    action: "Start Time Rush",
  },
  duel: {
    kicker: "Arena access",
    title: "Enter Ranked Duels",
    subtitle: "Race live rivals and climb the competitive ladder.",
    action: "Enter the arena",
  },
  league: {
    kicker: "Season access",
    title: "Join the Season League",
    subtitle: "Earn points, rise through divisions, and qualify for the Cup.",
    action: "Join the league",
  },
  default: {
    kicker: "Player access",
    title: "Welcome back, player",
    subtitle: "Continue your streak, missions, and unlocked modes.",
    action: "Continue playing",
  },
};

function readJson(storage, key) {
  try { return JSON.parse(storage?.getItem(key) || "null"); }
  catch { return null; }
}

export function buildAuthIntent({ mode = "daily", reason = "account" } = {}, storage = globalThis.localStorage) {
  const guest = readJson(storage, GUEST_DAILY_KEY);
  return {
    mode: PROTECTED_MODES.has(mode) ? mode : "daily",
    reason,
    guestSessionId: guest?.sessionId || "",
    guestDayKey: guest?.dayKey || "",
    createdAt: Date.now(),
  };
}

export function saveAuthIntent(input, storage = globalThis.localStorage) {
  const intent = buildAuthIntent(input, storage);
  storage?.setItem(AUTH_INTENT_KEY, JSON.stringify(intent));
  return intent;
}

export function readAuthIntent(storage = globalThis.localStorage) {
  const intent = readJson(storage, AUTH_INTENT_KEY);
  if (!intent?.createdAt || Date.now() - intent.createdAt > AUTH_INTENT_MAX_AGE_MS) return buildAuthIntent({}, storage);
  return intent;
}

export function clearAuthIntent(storage = globalThis.localStorage) {
  storage?.removeItem(AUTH_INTENT_KEY);
}

export function authDestination(intent = {}) {
  return PROTECTED_MODES.has(intent.mode) ? `/?mode=${intent.mode}` : "/";
}

export function authPresentation(intent = {}) {
  if (intent.reason === "save") return AUTH_PRESENTATIONS.daily;
  return AUTH_PRESENTATIONS[intent.mode] || AUTH_PRESENTATIONS.default;
}

export async function completeAuthFlow(checkUserAuth, storage = globalThis.localStorage) {
  await checkUserAuth();
  const intent = readAuthIntent(storage);
  let claim = null;
  if (intent.guestSessionId) {
    claim = await worldApi.claimGuestSession(intent.guestSessionId);
    storage?.removeItem(GUEST_DAILY_KEY);
  }
  const player = await worldApi.bootstrap();
  clearAuthIntent(storage);
  return { intent, claim, player, destination: authDestination(intent) };
}
