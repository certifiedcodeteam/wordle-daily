import { normalizeState, STORAGE_KEY } from "./game.js";

export function loadLocalState() {
  if (typeof window === "undefined") return normalizeState(null);
  try {
    return normalizeState(JSON.parse(window.localStorage.getItem(STORAGE_KEY)));
  } catch {
    return normalizeState(null);
  }
}

export function saveLocalState(state) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
