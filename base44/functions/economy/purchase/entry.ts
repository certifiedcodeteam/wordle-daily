import { applyEntityOperation, clientFor, findPendingWalletOperation, getOrCreatePlayer, handleFunctionError, mutateWallet, requireUser, runWalletDelivery } from "../../../shared/platform.js";

const CATALOG: Record<string, { price: number; type: "utility" | "cosmetic" }> = {
  "streak-shield": { price: 50, type: "utility" },
  "keycaps-forest": { price: 100, type: "cosmetic" },
  "keycaps-sunset": { price: 140, type: "cosmetic" },
  "board-midnight": { price: 220, type: "cosmetic" },
  "victory-crown": { price: 400, type: "cosmetic" },
};

Deno.serve(async (req) => {
  try {
    const base44 = clientFor(req);
    const user = await requireUser(base44);
    const { itemId, requestId } = await req.json();
    const item = CATALOG[itemId];
    if (!item || !requestId) throw Object.assign(new Error("Unknown shop item"), { status: 404 });
    const admin = base44.asServiceRole.entities;
    const { account } = await getOrCreatePlayer(base44, user);
    const pending = await findPendingWalletOperation(admin, user.id, "shop_purchase", itemId);
    if (item.type === "utility" && account.streak_shields >= 2 && !pending) throw Object.assign(new Error("You can carry at most two streak shields"), { status: 409 });
    const owned = await admin.PlayerInventory.filter({ user_id: user.id, item_key: itemId }, "-created_date", 1);
    if (item.type === "cosmetic" && owned[0] && !pending) throw Object.assign(new Error("You already own this cosmetic"), { status: 409 });
    const operationKey = pending?.operation_key || `purchase:${requestId}`;
    const wallet = await mutateWallet(base44, account, { operationKey, delta: -item.price, reason: "shop_purchase", referenceId: itemId });
    await runWalletDelivery(admin, account.id, operationKey, wallet, async () => {
      if (item.type === "utility") {
        const fresh = await admin.PlayerAccount.get(account.id);
        await applyEntityOperation(admin.PlayerAccount, account.id, operationKey, {
          $set: { streak_shields: Math.min(2, fresh.streak_shields + 1), last_utility_operation: operationKey },
        });
      } else {
        const current = await admin.PlayerInventory.filter({ user_id: user.id, item_key: itemId }, "-created_date", 1);
        if (!current[0]) await admin.PlayerInventory.create({ user_id: user.id, item_key: itemId, item_type: "cosmetic", quantity: 1, acquired_at: new Date().toISOString() });
      }
    });
    console.log(JSON.stringify({ event: "shop_purchase", item_id: itemId, user_id: user.id }));
    return Response.json({ itemId, tokenBalance: wallet.tokenBalance, owned: true });
  } catch (error) { return handleFunctionError(error); }
});
