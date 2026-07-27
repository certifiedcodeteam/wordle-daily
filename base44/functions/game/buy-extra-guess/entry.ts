import { clientFor, getOrCreatePlayer, handleFunctionError, mutateWallet, requireUser, runWalletDelivery } from "../../../shared/platform.js";

Deno.serve(async (req) => {
  try {
    const base44 = clientFor(req);
    const user = await requireUser(base44);
    const { sessionId } = await req.json();
    const admin = base44.asServiceRole.entities;
    const session = await admin.GameSession.get(sessionId);
    if (!session || session.owner_user_id !== user.id || session.mode !== "daily") throw Object.assign(new Error("Daily session not found"), { status: 404 });
    const alreadyUnlocked = session.max_guesses === 7 && session.status === "playing";
    if (!alreadyUnlocked && (session.max_guesses !== 6 || session.guesses_used !== 6 || session.status !== "lost")) throw Object.assign(new Error("Extra chance is not available"), { status: 409 });
    const { account } = await getOrCreatePlayer(base44, user);
    const operationKey = `extra:${session.id}`;
    const wallet = await mutateWallet(base44, account, { operationKey, delta: -30, reason: "extra_guess", referenceId: session.id });
    await runWalletDelivery(admin, account.id, operationKey, wallet, async () => {
      if (!alreadyUnlocked) await admin.GameSession.update(session.id, { max_guesses: 7, status: "playing", completed_at: "", version: session.version + 1 });
    });
    const updated = await admin.GameSession.get(session.id);
    console.log(JSON.stringify({ event: "extra_guess_purchased", user_id: user.id, session_id: session.id }));
    return Response.json({ sessionId: updated.id, maxGuesses: 7, status: "playing", version: updated.version, tokenBalance: wallet.tokenBalance });
  } catch (error) { return handleFunctionError(error); }
});
