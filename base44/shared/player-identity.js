export async function hydratePlayerIdentities(admin, records) {
  if (!records.length) return [];
  const userIds = [...new Set(records.map((record) => record.user_id).filter(Boolean))];
  if (!userIds.length) return records;
  const profiles = await admin.PlayerProfile.filter(
    { user_id: { $in: userIds } },
    "-created_date",
    userIds.length,
  );
  const profilesByUser = new Map(profiles.map((profile) => [profile.user_id, profile]));
  return records.map((record) => {
    const profile = profilesByUser.get(record.user_id);
    if (!profile) return record;
    return {
      ...record,
      handle: profile.handle,
      avatar_url: profile.avatar_url || "",
      avatar_seed: profile.avatar_seed,
    };
  });
}
