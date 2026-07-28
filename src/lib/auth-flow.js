import { worldApi } from "@/api/worldClient";
import { buildPlayPath, parseWorldPath, safeWorldDestination } from "@/lib/world-routes";

export const AUTH_INTENT_KEY = "wordle-world-auth-intent";
export const GUEST_DAILY_KEY = "wordle-world-guest-daily";
const AUTH_INTENT_MAX_AGE_MS = 30 * 60 * 1000;

const PROTECTED_MODES = new Set(["endless", "rush", "duel", "party", "league"]);

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
    subtitle: "Race a matched rival and climb the competitive ladder.",
    action: "Enter the arena",
  },
  party: {
    kicker: "Room access",
    title: "Join the Party Room",
    subtitle: "Sign in to race the same three words with friends or demo rivals.",
    action: "Enter the room",
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

/** @param {{ mode?: string, reason?: string, destination?: string }} [input] */
export function buildAuthIntent(input = {}, storage = globalThis.localStorage) {
  const { mode = "daily", reason = "account", destination } = input;
  const guest = readJson(storage, GUEST_DAILY_KEY);
  const safeMode = PROTECTED_MODES.has(mode) ? mode : "daily";
  return {
    mode: safeMode,
    reason,
    destination: safeWorldDestination(destination, buildPlayPath(safeMode)),
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
  const safeMode = PROTECTED_MODES.has(intent.mode) ? intent.mode : "daily";
  return {
    ...intent,
    mode: safeMode,
    destination: safeWorldDestination(intent.destination, buildPlayPath(safeMode)),
    guestSessionId: typeof intent.guestSessionId === "string" ? intent.guestSessionId : "",
    guestDayKey: typeof intent.guestDayKey === "string" ? intent.guestDayKey : "",
  };
}

export function clearAuthIntent(storage = globalThis.localStorage) {
  storage?.removeItem(AUTH_INTENT_KEY);
}

export function authDestination(intent = {}) {
  const mode = PROTECTED_MODES.has(intent.mode) ? intent.mode : "daily";
  return safeWorldDestination(intent.destination, buildPlayPath(mode));
}

export function authPresentation(intent = {}) {
  if (intent.reason === "save") return AUTH_PRESENTATIONS.daily;
  if (parseWorldPath(authDestination(intent))?.kind === "player") return AUTH_PRESENTATIONS.default;
  return AUTH_PRESENTATIONS[intent.mode] || AUTH_PRESENTATIONS.default;
}

export async function completeAuthFlow(checkUserAuth, storage = globalThis.localStorage, timeoutMs = 10000) {
  const flow = async () => {
    const user = await checkUserAuth({ blocking: false });
    if (!user) throw new Error("Your session could not be verified. Try signing in again.");
    const intent = readAuthIntent(storage);
    let claim = null;
    if (intent.guestSessionId) {
      claim = await worldApi.claimGuestSession(intent.guestSessionId);
      storage?.removeItem(GUEST_DAILY_KEY);
    }
    const player = await worldApi.bootstrap();
    clearAuthIntent(storage);
    return { intent, claim, player, destination: authDestination(intent) };
  };
  let timer;
  try {
    return await Promise.race([
      flow(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Player setup took too long. Check your connection and retry.")), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
