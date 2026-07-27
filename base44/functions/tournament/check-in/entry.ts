import { clientFor, handleFunctionError, requireUser } from "../../../shared/platform.js";
import { activateCupDuel } from "../../../shared/duel-service.js";

Deno.serve(async (req) => {
  try {
    const base44 = clientFor(req);
    const user = await requireUser(base44);
    const { bracketId } = await req.json();
    const admin = base44.asServiceRole.entities;
    const bracket = await admin.CupBracket.get(bracketId);
    if (!bracket || ![bracket.player_one_id, bracket.player_two_id].includes(user.id)) throw Object.assign(new Error("Cup match not found"), { status: 404 });
    const now = new Date();
    if (now < new Date(bracket.check_in_at) || now > new Date(new Date(bracket.check_in_at).getTime() + 600000)) throw Object.assign(new Error("Check-in is closed"), { status: 409 });
    const field = user.id === bracket.player_one_id ? "player_one_checked_in" : "player_two_checked_in";
    await admin.CupBracket.update(bracket.id, { [field]: true });
    const updated = await admin.CupBracket.get(bracket.id);
    const bothCheckedIn = updated.player_one_checked_in && updated.player_two_checked_in;
    const match = bothCheckedIn ? await activateCupDuel(base44, updated) : null;
    return Response.json({ bracketId: bracket.id, checkedIn: true, bothCheckedIn, matchId: match?.id, checkInExpiresAt: new Date(new Date(bracket.check_in_at).getTime() + 600000).toISOString() });
  } catch (error) { return handleFunctionError(error); }
});
