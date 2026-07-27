export function nextDuelSync(snapshot, consumed = new Set()) {
  const candidates = [
    snapshot?.nextSyncAt,
    snapshot?.fallbackAt,
    snapshot?.countdownEndsAt,
    snapshot?.match?.deadline,
  ]
    .filter(Boolean)
    .map((value) => ({ key: String(value), at: new Date(value).getTime() }))
    .filter((candidate) => Number.isFinite(candidate.at) && !consumed.has(candidate.key))
    .sort((left, right) => left.at - right.at);

  return candidates[0] || null;
}
