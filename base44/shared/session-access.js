export function canAccessSession(session, user) {
  return session.guest ? !user : Boolean(user && session.owner_user_id === user.id);
}
