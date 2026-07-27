export async function findPendingWalletOperation(admin, userId, reason, referenceId) {
  const pending = await admin.WalletTransaction.filter({
    user_id: userId,
    reason,
    reference_id: referenceId,
    delivery_status: { $ne: "complete" },
  }, "created_date", 1);
  return pending[0] || null;
}

export async function completeWalletOperation(admin, accountId, operationKey, transactionId) {
  if (transactionId) await admin.WalletTransaction.update(transactionId, { delivery_status: "complete" });
  await admin.PlayerAccount.updateMany(
    { id: accountId, last_operation_key: operationKey },
    { $set: { last_operation_delivered: true } },
  );
}

export async function runWalletDelivery(admin, accountId, operationKey, wallet, deliver) {
  let transaction = await admin.WalletTransaction.get(wallet.transactionId);
  if (transaction.delivery_status === "complete") return false;
  if (transaction.delivery_status === "delivering") {
    const age = Date.now() - new Date(transaction.updated_date || transaction.created_date).getTime();
    if (age < 30000) throw Object.assign(new Error("This operation is still being completed"), { status: 409, code: "operation_in_progress" });
    await admin.WalletTransaction.update(transaction.id, { delivery_status: "pending" });
    transaction = await admin.WalletTransaction.get(transaction.id);
  }
  const claimed = await admin.WalletTransaction.updateMany(
    { id: transaction.id, delivery_status: "pending" },
    { $set: { delivery_status: "delivering" } },
  );
  if (!claimed.updated) throw Object.assign(new Error("This operation is still being completed"), { status: 409, code: "operation_in_progress" });
  try {
    await deliver();
    await completeWalletOperation(admin, accountId, operationKey, transaction.id);
    return true;
  } catch (error) {
    await admin.WalletTransaction.update(transaction.id, { delivery_status: "pending" });
    throw error;
  }
}

export async function applyEntityOperation(entity, id, operationKey, operators) {
  const update = {
    ...operators,
    $addToSet: {
      ...(operators.$addToSet || {}),
      applied_operation_keys: operationKey,
    },
  };
  return await entity.updateMany(
    { id, applied_operation_keys: { $nin: [operationKey] } },
    update,
  );
}
