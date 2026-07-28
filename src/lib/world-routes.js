export const WORLD_MODES = Object.freeze(["daily", "endless", "rush", "duel", "party", "league"]);
export const PLAYER_PANELS = Object.freeze(["missions", "shop", "profile", "settings"]);
export const DEFAULT_WORLD_PATH = "/play/daily";

const WORLD_MODE_SET = new Set(WORLD_MODES);
const PLAYER_PANEL_SET = new Set(PLAYER_PANELS);
const PUBLIC_WORLD_PATHS = new Set([DEFAULT_WORLD_PATH, "/player/settings"]);

export function buildPlayPath(mode) {
  return WORLD_MODE_SET.has(mode) ? `/play/${mode}` : DEFAULT_WORLD_PATH;
}

export function buildPlayerPath(panel) {
  return PLAYER_PANEL_SET.has(panel) ? `/player/${panel}` : null;
}

export function parseWorldPath(pathname) {
  if (typeof pathname !== "string") return null;
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length !== 2) return null;

  if (parts[0] === "play" && WORLD_MODE_SET.has(parts[1])) {
    const path = buildPlayPath(parts[1]);
    return { kind: "play", mode: parts[1], path, requiresAuth: !PUBLIC_WORLD_PATHS.has(path) };
  }

  if (parts[0] === "player" && PLAYER_PANEL_SET.has(parts[1])) {
    const path = buildPlayerPath(parts[1]);
    return { kind: "player", panel: parts[1], path, requiresAuth: !PUBLIC_WORLD_PATHS.has(path) };
  }

  return null;
}

export function safeWorldDestination(destination, fallback = DEFAULT_WORLD_PATH) {
  if (typeof destination !== "string" || !destination.startsWith("/") || destination.startsWith("//")) return fallback;
  const [pathname, query = ""] = destination.split("?", 2);
  const route = parseWorldPath(pathname);
  if (!route) return fallback;
  if (route.mode !== "party") return route.path;
  const code = new URLSearchParams(query).get("room")?.toUpperCase() || "";
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? `${route.path}?room=${code}` : route.path;
}

export function legacyWorldDestination(search = "") {
  const mode = new URLSearchParams(search).get("mode");
  return buildPlayPath(mode);
}

export function worldTransitionKey(pathname) {
  return parseWorldPath(pathname) ? "world" : pathname;
}
