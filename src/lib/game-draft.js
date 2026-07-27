export function updateGameDraft(current, key) {
  if (key === "Backspace") return current.slice(0, -1);
  if (/^[a-z]$/i.test(key) && current.length < 5) return `${current}${key.toLowerCase()}`;
  return current;
}

