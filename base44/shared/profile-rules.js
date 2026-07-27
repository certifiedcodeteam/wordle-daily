export const RENAME_COST = 500;
const NICKNAME_PATTERN = /^[a-zA-Z0-9 _-]+$/;

export function normalizeNickname(value) {
  return value.trim().replace(/\s+/g, " ");
}

export function nicknameValidationError(value) {
  if (value.length < 3 || value.length > 20) return "Nickname must be 3 to 20 characters";
  if (!NICKNAME_PATTERN.test(value)) return "Use only letters, numbers, spaces, underscores, or hyphens";
  return "";
}

export function renameCostFor(renameCount) {
  return Math.max(0, renameCount || 0) === 0 ? 0 : RENAME_COST;
}
