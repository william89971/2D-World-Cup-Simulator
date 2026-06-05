import { GROUPS as FALLBACK_GROUPS, TEAMS as FALLBACK_TEAMS } from "./teams.js";

function normalizeTeam(team) {
  const roster = team.roster ?? team.players ?? [];
  const normalizedRoster = roster.map((player) => ({ ...player, ego: player.ego ?? 50, skillMoves: player.skillMoves ?? 2 }));
  const starters = normalizedRoster.filter((player) => player.isStarter).slice(0, 11);
  const players = starters.length === 11 ? starters : (team.players ?? []).slice(0, 11).map((player) => ({ ...player, skillMoves: player.skillMoves ?? 2 }));
  return {
    ...team,
    name: team.name ?? team.countryName,
    countryName: team.countryName ?? team.name,
    primary: team.primary ?? team.primaryColor,
    secondary: team.secondary ?? team.secondaryColor,
    primaryColor: team.primaryColor ?? team.primary,
    secondaryColor: team.secondaryColor ?? team.secondary,
    roster: normalizedRoster,
    players
  };
}

export function buildGroups(teams) {
  return Array.from(new Set(teams.map((team) => team.group))).map((group) => ({
    id: group,
    name: `Group ${group}`,
    teamIds: teams
      .filter((team) => team.group === group)
      .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0) || a.name.localeCompare(b.name))
      .map((team) => team.id)
  }));
}

export function flagUrl(team) {
  if (!team?.iso2) return "";
  // FlagCDN serves UK subdivision flags with ids like gb-eng and gb-sct at the same path shape.
  return `https://flagcdn.com/w40/${team.iso2}.png`;
}

export async function loadWorldCupData() {
  try {
    const response = await fetch("teams.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const teams = (await response.json()).map(normalizeTeam);
    return {
      teams,
      groups: buildGroups(teams),
      teamMap: new Map(teams.map((team) => [team.id, team])),
      source: "teams.json"
    };
  } catch (error) {
    const teams = FALLBACK_TEAMS.map((team) =>
      normalizeTeam({
        ...team,
        countryName: team.name,
        roster: team.players.map((player) => ({ ...player, isStarter: true, ego: player.ego ?? 50, skillMoves: player.skillMoves ?? 2 }))
      })
    );
    return {
      teams,
      groups: FALLBACK_GROUPS,
      teamMap: new Map(teams.map((team) => [team.id, team])),
      source: "fallback",
      error
    };
  }
}
