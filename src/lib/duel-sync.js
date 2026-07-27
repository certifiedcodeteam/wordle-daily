export function nextDuelSync(snapshot, consumed = new Set()) {
  const status = snapshot?.match?.status;
  const values = status === "waiting"
    ? [snapshot?.fallbackAt]
    : status === "countdown"
      ? [snapshot?.countdownEndsAt]
      : status === "active"
        ? [snapshot?.nextSyncAt, snapshot?.match?.deadline]
        : [];
  const candidates = values
    .filter(Boolean)
    .map((value) => ({ key: String(value), at: new Date(value).getTime() }))
    .filter((candidate) => Number.isFinite(candidate.at) && !consumed.has(candidate.key))
    .sort((left, right) => left.at - right.at);

  return candidates[0] || null;
}
