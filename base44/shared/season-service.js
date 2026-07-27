import { requireUser, getOrCreatePlayer } from "./platform.js";
import { hydratePlayerIdentities } from "./player-identity.js";

const SEASON_EPOCH = Date.UTC(2026, 0, 1);
const SEASON_DAYS = 28;

export function seasonWindow(now = new Date()) {
  const elapsed = Math.floor((now.getTime() - SEASON_EPOCH) / 86400000);
  const index = Math.max(0, Math.floor(elapsed / SEASON_DAYS));
  const starts = new Date(SEASON_EPOCH + index * SEASON_DAYS * 86400000);
  const ends = new Date(starts.getTime() + SEASON_DAYS * 86400000);
  const leagueEnds = new Date(ends.getTime() - 2 * 86400000);
  return { key: `S${String(index + 1).padStart(2, "0")}`, index, starts, leagueEnds, ends };
}

export async function ensureSeason(base44, user) {
  const admin = base44.asServiceRole.entities;
  const window = seasonWindow();
  let season = (await admin.Season.filter({ key: window.key }, "-created_date", 1))[0];
  if (!season) season = await admin.Season.create({
    key: window.key, name: `Season ${window.index + 1}`, status: new Date() >= window.leagueEnds ? "cup" : "active",
    starts_at: window.starts.toISOString(), league_ends_at: window.leagueEnds.toISOString(), ends_at: window.ends.toISOString(),
  });
  let membership = (await admin.LeagueMembership.filter({ season_id: season.id, user_id: user.id }, "-created_date", 1))[0];
  if (!membership) {
    const { profile } = await getOrCreatePlayer(base44, user);
    const priorMemberships = await admin.LeagueMembership.filter({ user_id: user.id }, "-created_date", 10);
    const prior = priorMemberships.find((entry) => entry.season_id !== season.id);
    const division = prior ? nextDivision(prior.division, prior.rank) : "bronze";
    const seededRating = prior ? 1000 + Math.round((prior.duel_rating - 1000) * 0.5) : 1000;
    const cohortMembers = await admin.LeagueMembership.filter({ season_id: season.id, division }, "created_date", 5000);
    const cohort = Math.floor(cohortMembers.length / 30) + 1;
    membership = await admin.LeagueMembership.create({ season_id: season.id, user_id: user.id, handle: profile.handle, division, cohort, league_points: 0, duel_rating: seededRating, rank: cohortMembers.length % 30 + 1, cup_qualified: false, applied_operation_keys: [] });
    await admin.LeaderboardEntry.create({ season_id: season.id, user_id: user.id, handle: profile.handle, division, cohort, points: 0, wins: 0, rank: membership.rank, updated_at: new Date().toISOString(), applied_operation_keys: [] });
    if (divisionRank(division) > divisionRank(profile.peak_division)) await admin.PlayerProfile.update(profile.id, { peak_division: division });
  }
  return { season, membership };
}

const DIVISIONS = ["bronze", "silver", "gold", "platinum", "diamond"];
function divisionRank(division) { return Math.max(0, DIVISIONS.indexOf(division)); }
function nextDivision(division, rank) {
  const current = divisionRank(division);
  if (rank > 0 && rank <= 5) return DIVISIONS[Math.min(DIVISIONS.length - 1, current + 1)];
  if (rank >= 26) return DIVISIONS[Math.max(0, current - 1)];
  return DIVISIONS[current];
}

export async function tournamentStatus(base44) {
  const user = await requireUser(base44);
  const competition = await ensureSeason(base44, user);
  const season = competition.season;
  let membership = competition.membership;
  const admin = base44.asServiceRole.entities;
  const leaderboard = await admin.LeaderboardEntry.filter({ season_id: season.id, division: membership.division, cohort: membership.cohort }, "-points", 30);
  for (let index = 0; index < leaderboard.length; index += 1) {
    if (leaderboard[index].rank !== index + 1) await admin.LeaderboardEntry.update(leaderboard[index].id, { rank: index + 1 });
  }
  const ownRank = leaderboard.findIndex((entry) => entry.user_id === user.id) + 1;
  if (ownRank > 0 && membership.rank !== ownRank) {
    membership = await admin.LeagueMembership.update(membership.id, { rank: ownRank });
  }
  let brackets = await admin.CupBracket.filter({ season_id: season.id, division: membership.division, cohort: membership.cohort }, "round", 20);
  if (season.status === "cup" && leaderboard.length >= 8 && !brackets.length) {
    const checkInAt = new Date(Math.max(Date.now(), new Date(season.league_ends_at).getTime()) + 3600000).toISOString();
    const seeds = [[0, 7], [3, 4], [1, 6], [2, 5]];
    brackets = await admin.CupBracket.bulkCreate(seeds.map(([left, right], slot) => ({
      season_id: season.id, division: membership.division, cohort: membership.cohort, round: 1, slot: slot + 1,
      player_one_id: leaderboard[left].user_id, player_two_id: leaderboard[right].user_id,
      status: "check_in", check_in_at: checkInAt, player_one_checked_in: false, player_two_checked_in: false,
      activation_status: "pending", advancement_status: "pending",
    })));
    for (const entry of leaderboard.slice(0, 8)) {
      const member = (await admin.LeagueMembership.filter({ season_id: season.id, user_id: entry.user_id }, "-created_date", 1))[0];
      if (member) await admin.LeagueMembership.update(member.id, { cup_qualified: true });
    }
  }
  const hydrated = await hydratePlayerIdentities(admin, [membership, ...leaderboard]);
  const currentMembership = hydrated[0];
  const currentLeaderboard = hydrated.slice(1).map((entry, index) => ({ ...entry, rank: index + 1 }));
  return { season, membership: currentMembership, leaderboard: currentLeaderboard, brackets };
}
