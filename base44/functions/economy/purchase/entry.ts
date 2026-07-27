import { clientFor, getOrCreatePlayer, handleFunctionError, mutateWallet, requireUser } from "../../../shared/platform.js";

const CATALOG = {
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
    if (item.type === "utility" && account.streak_shields >= 2) throw Object.assign(new Error("You can carry at most two streak shields"), { status: 409 });
    const owned = await admin.PlayerInventory.filter({ user_id: user.id, item_key: itemId }, "-created_date", 1);
    if (item.type === "cosmetic" && owned[0]) throw Object.assign(new Error("You already own this cosmetic"), { status: 409 });
    const operationKey = `purchase:${requestId}`;
    const wallet = await mutateWallet(base44, account, { operationKey, delta: -item.price, reason: "shop_purchase", referenceId: itemId });
    if (item.type === "utility") {
      const fresh = await admin.PlayerAccount.get(account.id);
      if (fresh.last_utility_operation !== operationKey) await admin.PlayerAccount.update(account.id, { streak_shields: Math.min(2, fresh.streak_shields + 1), last_utility_operation: operationKey });
    } else if (!owned[0]) {
      await admin.PlayerInventory.create({ user_id: user.id, item_key: itemId, item_type: "cosmetic", quantity: 1, acquired_at: new Date().toISOString() });
    }
    console.log(JSON.stringify({ event: "shop_purchase", item_id: itemId, user_id: user.id }));
    return Response.json({ itemId, tokenBalance: wallet.tokenBalance, owned: true });
  } catch (error) { return handleFunctionError(error); }
});
