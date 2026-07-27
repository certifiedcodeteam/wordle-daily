import { clientFor, getOrCreatePlayer, handleFunctionError, requireUser } from "../../../shared/platform.js";

Deno.serve(async (req) => {
  try {
    const base44 = clientFor(req);
    const user = await requireUser(base44);
    const { payload } = await req.json();
    if (!payload || typeof payload !== "object") throw Object.assign(new Error("Legacy payload required"), { status: 400 });
    const admin = base44.asServiceRole.entities;
    const existing = await admin.WordlePlayerState.filter({ created_by_id: user.id }, "-created_date", 1);
    if (!existing[0]) await admin.WordlePlayerState.create({ user_id: user.id, state_version: 1, payload: { ...payload, imported_unverified: true } });
    const { account } = await getOrCreatePlayer(base44, user);
    if (payload.settings) await admin.PlayerAccount.update(account.id, { settings: payload.settings });
    return Response.json({ imported: true, verifiedRewards: false });
  } catch (error) { return handleFunctionError(error); }
});
