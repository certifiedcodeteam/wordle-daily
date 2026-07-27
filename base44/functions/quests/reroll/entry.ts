import { clientFor, getOrCreatePlayer, handleFunctionError, mutateWallet, requireUser } from "../../../shared/platform.js";

const REPLACEMENTS = [
  { key: "endless_one", title: "Win one Endless game", target: 1, reward: 10 },
  { key: "efficient_win", title: "Solve in four guesses or fewer", target: 1, reward: 20 },
  { key: "play_three", title: "Finish three games", target: 3, reward: 20 },
];

Deno.serve(async (req) => {
  try {
    const base44 = clientFor(req);
    const user = await requireUser(base44);
    const { questId, requestId } = await req.json();
    const admin = base44.asServiceRole.entities;
    const quest = await admin.PlayerQuest.get(questId);
    if (!quest || quest.user_id !== user.id) throw Object.assign(new Error("Quest not found"), { status: 404 });
    if (quest.claimed || quest.rerolled) throw Object.assign(new Error("This quest cannot be rerolled"), { status: 409 });
    const replacement = REPLACEMENTS[Math.abs(quest.id.length + quest.quest_key.length) % REPLACEMENTS.length];
    const { account } = await getOrCreatePlayer(base44, user);
    const wallet = await mutateWallet(base44, account, { operationKey: `reroll:${requestId}`, delta: -10, reason: "quest_reroll", referenceId: quest.id });
    await admin.PlayerQuest.update(quest.id, { quest_key: replacement.key, title: replacement.title, target: replacement.target, progress: 0, reward_tokens: replacement.reward, rerolled: true });
    return Response.json({ quest: { ...quest, quest_key: replacement.key, title: replacement.title, target: replacement.target, progress: 0, reward_tokens: replacement.reward, rerolled: true }, tokenBalance: wallet.tokenBalance });
  } catch (error) { return handleFunctionError(error); }
});
