import { applyEntityOperation, clientFor, getOrCreatePlayer, handleFunctionError, mutateWallet, requireUser, runWalletDelivery } from "../../../shared/platform.js";

Deno.serve(async (req) => {
  try {
    const base44 = clientFor(req);
    const user = await requireUser(base44);
    const { questId } = await req.json();
    const admin = base44.asServiceRole.entities;
    const quest = await admin.PlayerQuest.get(questId);
    if (!quest || quest.user_id !== user.id) throw Object.assign(new Error("Quest not found"), { status: 404 });
    if (quest.progress < quest.target) throw Object.assign(new Error("Quest is not complete"), { status: 409 });
    const { account } = await getOrCreatePlayer(base44, user);
    const operationKey = `quest:${quest.id}`;
    const wallet = await mutateWallet(base44, account, { operationKey, delta: quest.claimed ? 0 : quest.reward_tokens, reason: "quest_claim", referenceId: quest.id });
    await runWalletDelivery(admin, account.id, operationKey, wallet, async () => {
      await applyEntityOperation(admin.PlayerQuest, quest.id, operationKey, { $set: { claimed: true } });
    });
    console.log(JSON.stringify({ event: "quest_claimed", quest_key: quest.quest_key, user_id: user.id }));
    return Response.json({ questId: quest.id, claimed: true, tokenBalance: wallet.tokenBalance });
  } catch (error) { return handleFunctionError(error); }
});
