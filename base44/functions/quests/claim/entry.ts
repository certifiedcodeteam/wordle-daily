import { clientFor, getOrCreatePlayer, handleFunctionError, mutateWallet, requireUser } from "../../../shared/platform.js";

Deno.serve(async (req) => {
  try {
    const base44 = clientFor(req);
    const user = await requireUser(base44);
    const { questId, requestId } = await req.json();
    const admin = base44.asServiceRole.entities;
    const quest = await admin.PlayerQuest.get(questId);
    if (!quest || quest.user_id !== user.id) throw Object.assign(new Error("Quest not found"), { status: 404 });
    if (quest.progress < quest.target) throw Object.assign(new Error("Quest is not complete"), { status: 409 });
    const { account } = await getOrCreatePlayer(base44, user);
    const wallet = await mutateWallet(base44, account, { operationKey: `quest:${quest.id}:${requestId}`, delta: quest.claimed ? 0 : quest.reward_tokens, reason: "quest_claim", referenceId: quest.id });
    if (!quest.claimed) await admin.PlayerQuest.update(quest.id, { claimed: true });
    console.log(JSON.stringify({ event: "quest_claimed", quest_key: quest.quest_key, user_id: user.id }));
    return Response.json({ questId: quest.id, claimed: true, tokenBalance: wallet.tokenBalance });
  } catch (error) { return handleFunctionError(error); }
});
