export async function claimGuestDaily({ admin, user, sessionId, currentDailyKey, getPlayer, settleWonSession }) {
  let session = await admin.GameSession.get(sessionId);
  if (!session || session.mode !== "daily" || session.puzzle_key !== currentDailyKey) {
    throw Object.assign(new Error("Guest Daily session not found"), { status: 404, code: "session_not_found" });
  }

  if (!session.guest) {
    if (session.owner_user_id !== user.id) throw Object.assign(new Error("Guest Daily session not found"), { status: 404, code: "session_not_found" });
  } else {
    const transferred = await admin.GameSession.updateMany(
      { id: session.id, guest: true, owner_user_id: "" },
      { $set: { guest: false, owner_user_id: user.id } },
    );
    if (!transferred.updated) {
      session = await admin.GameSession.get(session.id);
      if (!session || session.guest || session.owner_user_id !== user.id) {
        throw Object.assign(new Error("Guest Daily session was already claimed"), { status: 409, code: "session_claimed" });
      }
    } else {
      session = { ...session, guest: false, owner_user_id: user.id };
      await admin.GuessAttempt.updateMany(
        { session_id: session.id, owner_user_id: "" },
        { $set: { owner_user_id: user.id } },
      );
    }
  }

  const { account } = await getPlayer();
  await admin.PlayerAccount.update(account.id, {
    daily_session_key: currentDailyKey,
    daily_session_id: session.id,
  });

  const rewards = session.status === "won" ? await settleWonSession(session) : undefined;
  return { claimed: true, sessionId: session.id, status: session.status, rewards };
}
