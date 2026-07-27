import { applyEntityOperation, clientFor, findPendingWalletOperation, getOrCreatePlayer, handleFunctionError, mutateWallet, requireUser, runWalletDelivery } from "../../../shared/platform.js";
import { nicknameValidationError, normalizeNickname, renameCostFor } from "../../../shared/profile-rules.js";

function validateNickname(value: string) {
  const error = nicknameValidationError(value);
  if (error) throw Object.assign(new Error(error), { status: 400, code: "invalid_nickname" });
}

function validateAvatarUrl(value: string) {
  if (value.length > 2048) throw Object.assign(new Error("Avatar URL is too long"), { status: 400, code: "invalid_avatar" });
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error("Upload a valid avatar image"), { status: 400, code: "invalid_avatar" }); }
  if (url.protocol !== "https:") throw Object.assign(new Error("Upload a valid avatar image"), { status: 400, code: "invalid_avatar" });
}

Deno.serve(async (req) => {
  try {
    const base44 = clientFor(req);
    const user = await requireUser(base44);
    const body = await req.json();
    const hasNickname = typeof body.nickname === "string";
    const hasAvatar = typeof body.avatarUrl === "string";
    if (!hasNickname && !hasAvatar) {
      throw Object.assign(new Error("Choose a nickname or avatar to update"), { status: 400, code: "invalid_request" });
    }

    const admin = base44.asServiceRole.entities;
    const { account, profile } = await getOrCreatePlayer(base44, user);
    const patch: Record<string, string | number> = {};
    let wallet = null;
    let operationKey = "";
    let renameCost = 0;
    const pendingRename = hasNickname
      ? await findPendingWalletOperation(admin, user.id, "profile_rename", profile.id)
      : null;

    if (hasNickname) {
      const nickname = normalizeNickname(body.nickname);
      validateNickname(nickname);
      if (nickname !== profile.handle) {
        const renameCount = Math.max(0, profile.rename_count || 0);
        renameCost = pendingRename ? Math.abs(pendingRename.delta) : renameCostFor(renameCount);
        if (renameCost) {
          if (!pendingRename && account.token_balance < renameCost) {
            throw Object.assign(new Error("You need 500 coins to rename"), { status: 409, code: "insufficient_tokens" });
          }
          operationKey = pendingRename?.operation_key || `profile-rename:${user.id}:${renameCount + 1}`;
          wallet = await mutateWallet(base44, account, {
            operationKey,
            delta: -renameCost,
            reason: "profile_rename",
            referenceId: profile.id,
          });
        }
        patch.handle = nickname;
        patch.rename_count = renameCount + 1;
      }
    }

    if (hasAvatar) {
      const avatarUrl = body.avatarUrl.trim();
      validateAvatarUrl(avatarUrl);
      if (avatarUrl !== profile.avatar_url) patch.avatar_url = avatarUrl;
    }

    if (wallet) {
      await runWalletDelivery(admin, account.id, operationKey, wallet, async () => {
        if (Object.keys(patch).length) await applyEntityOperation(admin.PlayerProfile, profile.id, operationKey, { $set: patch });
      });
    } else if (Object.keys(patch).length) {
      await admin.PlayerProfile.update(profile.id, patch);
    }
    const updatedProfile = Object.keys(patch).length ? await admin.PlayerProfile.get(profile.id) : profile;
    console.log(JSON.stringify({ event: "profile_updated", user_id: user.id, renamed: Boolean(patch.handle), avatar_updated: Boolean(patch.avatar_url), rename_cost: renameCost }));
    return Response.json({ profile: updatedProfile, tokenBalance: wallet?.tokenBalance ?? account.token_balance, renameCost });
  } catch (error) { return handleFunctionError(error); }
});
