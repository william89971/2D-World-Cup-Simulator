import { KNOCKOUT_ROUNDS, STAGES } from "../core/constants.js";
import { average, clamp, createSeededRandom, pick } from "../core/utils.js";

const GROUP_PAIRINGS = [
  [
    [0, 1],
    [2, 3]
  ],
  [
    [0, 2],
    [1, 3]
  ],
  [
    [0, 3],
    [1, 2]
  ]
];

const SEEDED_R32_ORDER = [
  [1, 32],
  [16, 17],
  [8, 25],
  [9, 24],
  [4, 29],
  [13, 20],
  [5, 28],
  [12, 21],
  [2, 31],
  [15, 18],
  [7, 26],
  [10, 23],
  [3, 30],
  [14, 19],
  [6, 27],
  [11, 22]
];

const ROLE_ORDER = ["GK", "RB", "CB", "LB", "DEF", "DM", "CM", "AM", "MID", "RW", "LW", "ST", "FWD"];
const CARD_TYPES = Object.freeze({ YELLOW: "yellow", RED: "red" });
const TOURNAMENT_MODES = Object.freeze({ KNOCKOUT: "knockout", GROUPS: "groups" });

function emptyRecord(teamId, groupId) {
  return {
    teamId,
    groupId,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0
  };
}

function knockoutRoundLabel(key) {
  return KNOCKOUT_ROUNDS.find((round) => round.key === key)?.label ?? key;
}

function playerQuality(player) {
  const role = player.role ?? player.position;
  const roleBonus = ROLE_ORDER.length - Math.max(ROLE_ORDER.indexOf(role), 0);
  return (
    player.speed * 0.16 +
    player.shooting * 0.22 +
    player.passing * 0.22 +
    player.defending * 0.22 +
    (player.effectiveStaminaCap ?? player.stamina) * 0.18 +
    roleBonus * 0.06
  );
}

function teamAverages(players) {
  return {
    shooting: average(players.map((player) => player.shooting)),
    passing: average(players.map((player) => player.passing)),
    defending: average(players.map((player) => player.defending)),
    stamina: average(players.map((player) => player.effectiveStaminaCap ?? player.stamina))
  };
}

function poisson(random, lambda) {
  const limit = Math.exp(-lambda);
  let count = 0;
  let product = 1;
  do {
    count += 1;
    product *= random();
  } while (product > limit);
  return count - 1;
}

function eventMinute(random) {
  return Math.max(1, Math.min(90, Math.round(2 + random() * 86)));
}

export function selectKnockoutTeams(teams, { size = 32, includeTeamId = "SLV" } = {}) {
  const sorted = [...teams].sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name));
  const selected = sorted.slice(0, size);
  const forcedTeam = teams.find((team) => team.id === includeTeamId);
  if (forcedTeam && !selected.some((team) => team.id === forcedTeam.id)) {
    selected[selected.length - 1] = forcedTeam;
  }
  return [...selected].sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name));
}

function deterministicShuffle(items, seed) {
  const random = createSeededRandom(seed);
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export class TournamentMemory {
  constructor() {
    this.log = new Map();
  }

  recordWin(team, tacticSnapshot) {
    if (!team || !tacticSnapshot) return;
    let primary = "balanced";
    if (tacticSnapshot.defensiveLineHeight >= 70) primary = "highLine";
    else if (tacticSnapshot.passingStyle >= 75) primary = "direct";
    else if (tacticSnapshot.pressingIntensity >= 75) primary = "press";
    this.log.set(team.id, { primary, tacticSnapshot: { ...tacticSnapshot } });
  }

  coachAdjustmentForOpponent(opponentId) {
    const entry = this.log.get(opponentId);
    if (entry?.primary !== "highLine") return null;
    return { passingStyle: 85, reason: "Targeting space behind a high defensive line" };
  }
}

export class TournamentState {
  constructor({ teams, groups = [], mode = TOURNAMENT_MODES.KNOCKOUT, seedMode = "shuffle", includeTeamId = "SLV", userTeamId = null, userTeam = null } = {}) {
    const sourceTeams = Array.isArray(teams) ? teams : [];
    const effectiveTeams =
      userTeamId && userTeam
        ? sourceTeams.map((team) => (team.id === userTeamId ? userTeam : team))
        : sourceTeams;
    this.mode = mode;
    this.seedMode = seedMode;
    this.includeTeamId = includeTeamId;
    this.userTeamId = userTeamId;
    this.userTeam = userTeam;
    this.teams = mode === TOURNAMENT_MODES.KNOCKOUT ? selectKnockoutTeams(effectiveTeams, { includeTeamId }) : effectiveTeams;
    this.groups = mode === TOURNAMENT_MODES.KNOCKOUT ? [] : groups;
    this.teamMap = new Map(effectiveTeams.map((team) => [team.id, team]));
    this.memory = new TournamentMemory();
    this.playerStatus = new Map();
    this.eliminatedTeamIds = new Set();
    this.reset();
  }

  reset() {
    this.stage = STAGES.GROUP;
    this.championId = null;
    this.groupTables = new Map();
    this.matches = [];
    this.knockoutRounds = [];
    this.recentSummaries = [];
    this.eliminatedTeamIds.clear();
    this.playerStatus.clear();

    for (const team of this.teams) {
      for (const player of team.roster ?? team.players) {
        this.playerStatus.set(player.id, {
          playerId: player.id,
          teamId: team.id,
          consecutiveFullMatches: 0,
          effectiveStaminaCap: player.stamina,
          yellowCards: 0,
          suspendedMatches: 0,
          injuredMatches: 0
        });
      }
    }

    if (this.mode === TOURNAMENT_MODES.KNOCKOUT) {
      this.stage = STAGES.KNOCKOUT;
      this.createInitialKnockoutBracket();
      return;
    }

    for (const group of this.groups) {
      this.groupTables.set(group.id, group.teamIds.map((teamId) => emptyRecord(teamId, group.id)));
    }
    this.createGroupMatches();
  }

  createGroupMatches() {
    let globalIndex = 1;
    for (const group of this.groups) {
      GROUP_PAIRINGS.forEach((roundPairings, matchdayIndex) => {
        roundPairings.forEach(([homeIndex, awayIndex], index) => {
          this.matches.push({
            id: `G${group.id}-${matchdayIndex + 1}-${index + 1}`,
            stage: STAGES.GROUP,
            groupId: group.id,
            matchday: matchdayIndex + 1,
            sequence: globalIndex,
            homeTeamId: group.teamIds[homeIndex],
            awayTeamId: group.teamIds[awayIndex],
            status: "scheduled",
            result: null
          });
          globalIndex += 1;
        });
      });
    }
  }

  compareRecords = (a, b) => {
    const teamA = this.getTeam(a.teamId);
    const teamB = this.getTeam(b.teamId);
    return (
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      b.wins - a.wins ||
      teamB.strength - teamA.strength ||
      teamA.name.localeCompare(teamB.name)
    );
  };

  getGroupStandings(groupId) {
    return [...this.groupTables.get(groupId)].sort(this.compareRecords);
  }

  getAllGroupStandings() {
    return this.groups.map((group) => ({
      ...group,
      standings: this.getGroupStandings(group.id)
    }));
  }

  getCompletedMatches() {
    return this.matches.filter((match) => match.status === "completed");
  }

  getScheduledMatches() {
    return this.matches.filter((match) => match.status === "scheduled").sort((a, b) => a.sequence - b.sequence);
  }

  findMatch(matchId) {
    return this.matches.find((match) => match.id === matchId);
  }

  getNextMatchForTeam(teamId) {
    return this.getScheduledMatches().find((match) => this.matchIncludesTeam(match, teamId)) ?? null;
  }

  getNextMatch() {
    return this.getScheduledMatches()[0] ?? null;
  }

  matchIncludesTeam(match, teamId) {
    return match?.homeTeamId === teamId || match?.awayTeamId === teamId;
  }

  getTeam(id) {
    return this.teamMap.get(id);
  }

  getPlayerStatus(playerId) {
    return this.playerStatus.get(playerId);
  }

  getAvailableLineup(teamId) {
    const team = this.getTeam(teamId);
    const roster = team.roster ?? team.players;
    const available = roster
      .map((player) => {
        const status = this.getPlayerStatus(player.id);
        const effectiveStaminaCap = Math.max(45, player.stamina - (status?.consecutiveFullMatches ?? 0) * 8);
        return { ...player, effectiveStaminaCap };
      })
      .filter((player) => {
        const status = this.getPlayerStatus(player.id);
        return !status || (status.suspendedMatches <= 0 && status.injuredMatches <= 0);
      });

    const selected = available
      .filter((player) => player.isStarter)
      .sort((a, b) => (a.lineupOrder ?? 99) - (b.lineupOrder ?? 99));
    const addRole = (predicate, count) => {
      const candidates = available
        .filter((player) => !selected.some((item) => item.id === player.id) && predicate(player))
        .sort((a, b) => playerQuality(b) - playerQuality(a));
      selected.push(...candidates.slice(0, Math.max(0, count - selected.filter(predicate).length)));
    };

    if (selected.length < 11) {
      addRole((player) => player.position === "GK" || player.role === "GK", 1);
      addRole((player) => player.position === "DEF" || ["RB", "CB", "LB"].includes(player.role), 4);
      addRole((player) => player.position === "MID" || ["DM", "CM", "AM"].includes(player.role), 3);
      addRole((player) => player.position === "FWD" || ["RW", "ST", "LW"].includes(player.role), 3);
    }

    if (selected.length < 11) {
      selected.push(
        ...available
          .filter((player) => !selected.some((item) => item.id === player.id))
          .sort((a, b) => playerQuality(b) - playerQuality(a))
          .slice(0, 11 - selected.length)
      );
    }

    return selected.slice(0, 11).map((player, index) => ({ ...player, number: player.number ?? index + 1 }));
  }

  getPreparedTeam(teamId, opponentId) {
    const team = this.getTeam(teamId);
    const memoryAdjustment = this.memory.coachAdjustmentForOpponent(opponentId);
    const tactics = {
      ...team.tactics,
      ...(memoryAdjustment ? { passingStyle: Math.max(team.tactics?.passingStyle ?? 50, memoryAdjustment.passingStyle) } : {})
    };
    return {
      ...team,
      tactics,
      coachAdjustment: memoryAdjustment,
      players: this.getAvailableLineup(teamId)
    };
  }

  getMatchTeams(match) {
    return {
      homeTeam: this.getPreparedTeam(match.homeTeamId, match.awayTeamId),
      awayTeam: this.getPreparedTeam(match.awayTeamId, match.homeTeamId)
    };
  }

  simulateNextMatch() {
    const match = this.getNextMatch();
    if (!match) return null;
    return { match, result: this.simulateMatch(match.id) };
  }

  simulateToUserMatch(userTeamId) {
    let count = 0;
    while (this.getNextMatch()) {
      const next = this.getNextMatch();
      if (this.matchIncludesTeam(next, userTeamId)) break;
      this.simulateMatch(next.id);
      count += 1;
    }
    return count;
  }

  simulateUntilUserMatch(userTeamId) {
    return this.simulateToUserMatch(userTeamId);
  }

  getNextSimulatableMatch(userTeamId) {
    return this.getScheduledMatches().find((match) => !this.matchIncludesTeam(match, userTeamId)) ?? this.getNextMatch();
  }

  simulateNextOtherMatch(userTeamId) {
    const match = this.getNextSimulatableMatch(userTeamId);
    if (!match) return null;
    return { match, result: this.simulateMatch(match.id) };
  }

  simulateTournamentRemainder() {
    let count = 0;
    while (this.getNextMatch()) {
      this.simulateMatch(this.getNextMatch().id);
      count += 1;
    }
    return count;
  }

  simulateMatch(matchId) {
    const match = this.findMatch(matchId);
    if (!match || match.status === "completed") return null;
    const result = this.fastSim(match);
    this.completeMatch(match, result);
    return result;
  }

  fastSim(match) {
    const { homeTeam, awayTeam } = this.getMatchTeams(match);
    const random = createSeededRandom(`fast:${match.id}:${homeTeam.id}:${awayTeam.id}`);
    const homeAvg = teamAverages(homeTeam.players);
    const awayAvg = teamAverages(awayTeam.players);
    const expectedGoals = (attackTeam, attackAvg, defendTeam, defendAvg, bias) => {
      const creation = attackTeam.strength * 0.38 + attackAvg.shooting * 0.28 + attackAvg.passing * 0.18 + attackAvg.stamina * 0.1;
      const resistance = defendTeam.strength * 0.24 + defendAvg.defending * 0.44 + defendAvg.stamina * 0.16;
      return clamp(1.15 + (creation - resistance) * 0.026 + bias + (random() - 0.5) * 0.24, 0.18, 3.9);
    };
    const home = poisson(random, expectedGoals(homeTeam, homeAvg, awayTeam, awayAvg, 0.07));
    const away = poisson(random, expectedGoals(awayTeam, awayAvg, homeTeam, homeAvg, -0.01));
    const events = this.createFastSimEvents(random, match, homeTeam, awayTeam, home, away);
    const result = { home, away, winnerId: null, decidedBy: null, events, weather: "FastSim", participation: [], tacticSnapshot: null };

    if (home > away) result.winnerId = homeTeam.id;
    if (away > home) result.winnerId = awayTeam.id;
    if (match.stage !== STAGES.GROUP && home === away) {
      const homeExtra = poisson(random, clamp(0.18 + (homeAvg.shooting - awayAvg.defending) * 0.009, 0.05, 0.75));
      const awayExtra = poisson(random, clamp(0.18 + (awayAvg.shooting - homeAvg.defending) * 0.009, 0.05, 0.75));
      if (homeExtra !== awayExtra) {
        result.home += homeExtra;
        result.away += awayExtra;
        result.decidedBy = "extra time";
        result.winnerId = homeExtra > awayExtra ? homeTeam.id : awayTeam.id;
      } else {
        const homeChance = clamp((homeTeam.strength + homeAvg.shooting) / (homeTeam.strength + awayTeam.strength + homeAvg.shooting + awayAvg.shooting), 0.38, 0.62);
        result.decidedBy = "penalties";
        result.winnerId = random() < homeChance ? homeTeam.id : awayTeam.id;
      }
      events.push({
        minute: 120,
        type: "decision",
        teamId: result.winnerId,
        text: `${this.getTeam(result.winnerId).name} advances by ${result.decidedBy}`
      });
    }

    const winnerTeam = result.winnerId === homeTeam.id ? homeTeam : result.winnerId === awayTeam.id ? awayTeam : null;
    result.tacticSnapshot = this.tacticSnapshotForWinner(winnerTeam);
    result.participation = [...homeTeam.players, ...awayTeam.players].map((player) => ({ playerId: player.id, teamId: player.teamId, minutes: 90 }));
    result.summary = this.formatEventSummary(match, result);
    return result;
  }

  createFastSimEvents(random, match, homeTeam, awayTeam, homeGoals, awayGoals) {
    const events = [];
    const scorers = [
      ...Array.from({ length: homeGoals }, () => ({ team: homeTeam, opponent: awayTeam })),
      ...Array.from({ length: awayGoals }, () => ({ team: awayTeam, opponent: homeTeam }))
    ].sort(() => random() - 0.5);
    let homeScore = 0;
    let awayScore = 0;
    for (const item of scorers) {
      const scoringCandidates = item.team.players.filter((candidate) => candidate.position !== "GK");
      const player = pick(random, scoringCandidates.length ? scoringCandidates : item.team.players);
      if (item.team.id === homeTeam.id) homeScore += 1;
      else awayScore += 1;
      const minute = eventMinute(random);
      events.push({ minute, type: "goal", teamId: item.team.id, playerId: player.id, text: `${player.name} scores for ${item.team.name}` });
      if (homeScore !== awayScore) {
        events.push({ minute, type: "leadChange", teamId: item.team.id, text: `${item.team.name} takes the lead` });
      }
    }

    const fouls = Math.floor(6 + random() * 12);
    for (let i = 0; i < fouls; i += 1) {
      const foulingTeam = random() < 0.5 ? homeTeam : awayTeam;
      const fouledTeam = foulingTeam.id === homeTeam.id ? awayTeam : homeTeam;
      const offender = pick(random, foulingTeam.players);
      const victim = pick(random, fouledTeam.players);
      const minute = eventMinute(random);
      events.push({ minute, type: "foul", teamId: foulingTeam.id, playerId: offender.id, fouledPlayerId: victim.id, text: `${offender.name} fouls ${victim.name}` });
      if (random() < 0.18) {
        events.push({ minute, type: "card", card: CARD_TYPES.YELLOW, teamId: foulingTeam.id, playerId: offender.id, text: `${offender.name} booked` });
      }
    }
    return events.sort((a, b) => a.minute - b.minute);
  }

  applyWatchedResult(matchId, result) {
    const match = this.findMatch(matchId);
    if (!match || match.status === "completed") return;
    this.completeMatch(match, result);
  }

  completeMatch(match, result) {
    match.status = "completed";
    match.result = result;
    this.applyTournamentEffects(match, result);
    if (match.stage === STAGES.GROUP) {
      this.applyGroupResult(match, result);
      if (this.isGroupStageComplete()) this.createKnockoutBracket();
    } else {
      this.advanceKnockoutWinner(match, result.winnerId);
    }
    if (result.winnerId) this.memory.recordWin(this.getTeam(result.winnerId), result.tacticSnapshot ?? this.tacticSnapshotForWinner(this.getTeam(result.winnerId)));
    this.recentSummaries.unshift(result.summary ?? this.formatEventSummary(match, result));
    this.recentSummaries = this.recentSummaries.slice(0, 12);
  }

  applyTournamentEffects(match, result) {
    const playedIds = new Set((result.participation ?? []).filter((entry) => entry.minutes >= 45).map((entry) => entry.playerId));
    for (const team of [this.getTeam(match.homeTeamId), this.getTeam(match.awayTeamId)]) {
      for (const player of team.roster ?? team.players) {
        const status = this.getPlayerStatus(player.id);
        if (!status) continue;
        if (playedIds.has(player.id)) {
          status.consecutiveFullMatches = (status.consecutiveFullMatches ?? 0) + 1;
        } else {
          status.consecutiveFullMatches = 0;
          if (status.suspendedMatches > 0) status.suspendedMatches -= 1;
          if (status.injuredMatches > 0) status.injuredMatches -= 1;
        }
        status.effectiveStaminaCap = Math.max(45, player.stamina - status.consecutiveFullMatches * 8);
      }
    }

    const random = createSeededRandom(`effects:${match.id}`);
    for (const event of result.events ?? []) {
      if (event.type === "card") this.applyCard(event.playerId, event.card ?? event.metadata?.card ?? CARD_TYPES.YELLOW);
      const fouledPlayerId = event.fouledPlayerId ?? event.metadata?.fouledPlayerId;
      if (event.type === "foul" && fouledPlayerId && random() < 0.02) {
        const status = this.getPlayerStatus(fouledPlayerId);
        if (status) {
          status.injuredMatches = Math.max(status.injuredMatches, 2 + Math.floor(random() * 3));
          result.events.push({
            minute: event.minute,
            type: "injury",
            teamId: status.teamId,
            playerId: fouledPlayerId,
            text: `${this.findPlayer(fouledPlayerId)?.name ?? "Player"} ruled out for ${status.injuredMatches} matches`
          });
        }
      }
    }
  }

  applyCard(playerId, card) {
    const status = this.getPlayerStatus(playerId);
    if (!status) return;
    if (card === CARD_TYPES.RED) {
      status.suspendedMatches = Math.max(status.suspendedMatches, 1);
      return;
    }
    status.yellowCards += 1;
    if (status.yellowCards >= 2) {
      status.yellowCards = 0;
      status.suspendedMatches = Math.max(status.suspendedMatches, 1);
    }
  }

  findPlayer(playerId) {
    for (const team of this.teams) {
      const found = (team.roster ?? team.players).find((player) => player.id === playerId);
      if (found) return found;
    }
    return null;
  }

  tacticSnapshotForWinner(team) {
    if (!team) return null;
    return {
      pressingIntensity: team.tactics?.pressingIntensity ?? 50,
      defensiveLineHeight: team.tactics?.defensiveLineHeight ?? 50,
      passingStyle: team.tactics?.passingStyle ?? 50
    };
  }

  formatEventSummary(match, result) {
    const home = this.getTeam(match.homeTeamId);
    const away = this.getTeam(match.awayTeamId);
    const headline = `${home.name} ${result.home}-${result.away} ${away.name}`;
    const eventText = (result.events ?? [])
      .filter((event) => ["goal", "foul", "card", "injury", "leadChange", "decision"].includes(event.type))
      .slice(0, 8)
      .map((event) => `${event.minute}' ${event.text}`)
      .join(" / ");
    return `${headline}. ${eventText || "A cagey match settled by small tactical margins."}`;
  }

  applyGroupResult(match, result) {
    const table = this.groupTables.get(match.groupId);
    const home = table.find((record) => record.teamId === match.homeTeamId);
    const away = table.find((record) => record.teamId === match.awayTeamId);
    home.played += 1;
    away.played += 1;
    home.goalsFor += result.home;
    home.goalsAgainst += result.away;
    away.goalsFor += result.away;
    away.goalsAgainst += result.home;
    home.goalDifference = home.goalsFor - home.goalsAgainst;
    away.goalDifference = away.goalsFor - away.goalsAgainst;
    if (result.home > result.away) {
      home.wins += 1;
      home.points += 3;
      away.losses += 1;
    } else if (result.away > result.home) {
      away.wins += 1;
      away.points += 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  isGroupStageComplete() {
    return this.matches.filter((match) => match.stage === STAGES.GROUP).every((match) => match.status === "completed");
  }

  getQualifiedTeams() {
    const winners = [];
    const runnersUp = [];
    const thirdPlaced = [];
    for (const group of this.groups) {
      const standings = this.getGroupStandings(group.id);
      winners.push({ ...standings[0], qualification: "winner" });
      runnersUp.push({ ...standings[1], qualification: "runnerUp" });
      thirdPlaced.push({ ...standings[2], qualification: "third" });
    }
    const rankValue = { winner: 0, runnerUp: 1, third: 2 };
    return [...winners, ...runnersUp, ...thirdPlaced.sort(this.compareRecords).slice(0, 8)]
      .map((record) => ({ record, teamId: record.teamId, groupId: record.groupId, qualification: record.qualification }))
      .sort((a, b) => rankValue[a.qualification] - rankValue[b.qualification] || this.compareRecords(a.record, b.record) || a.groupId.localeCompare(b.groupId))
      .map((entry, index) => ({ ...entry, seed: index + 1 }));
  }

  createKnockoutBracket() {
    if (this.knockoutRounds.length) return;
    this.stage = STAGES.KNOCKOUT;
    const seeded = new Map(this.getQualifiedTeams().map((entry) => [entry.seed, entry]));
    const r32Matches = SEEDED_R32_ORDER.map(([homeSeed, awaySeed], index) => ({
      id: `R32-${index + 1}`,
      stage: STAGES.KNOCKOUT,
      roundKey: "R32",
      roundName: knockoutRoundLabel("R32"),
      bracketIndex: index,
      sequence: this.matches.length + index + 1,
      homeTeamId: seeded.get(homeSeed).teamId,
      awayTeamId: seeded.get(awaySeed).teamId,
      status: "scheduled",
      result: null
    }));
    this.knockoutRounds.push({ key: "R32", label: knockoutRoundLabel("R32"), matches: r32Matches });
    this.matches.push(...r32Matches);
  }

  createInitialKnockoutBracket() {
    if (this.knockoutRounds.length) return;
    const entrants = this.seedMode === "shuffle" ? deterministicShuffle(this.teams, `knockout:${this.teams.map((team) => team.id).join(":")}`) : [...this.teams];
    const r32Matches = Array.from({ length: 16 }, (_, index) => ({
      id: `R32-${index + 1}`,
      stage: STAGES.KNOCKOUT,
      roundKey: "R32",
      roundName: knockoutRoundLabel("R32"),
      bracketIndex: index,
      sequence: index + 1,
      homeTeamId: entrants[index * 2]?.id ?? null,
      awayTeamId: entrants[index * 2 + 1]?.id ?? null,
      status: entrants[index * 2] && entrants[index * 2 + 1] ? "scheduled" : "pending",
      result: null
    }));
    this.knockoutRounds.push({ key: "R32", label: knockoutRoundLabel("R32"), matches: r32Matches });
    this.matches.push(...r32Matches);
  }

  advanceKnockoutWinner(match, winnerId) {
    const loserId = match.homeTeamId === winnerId ? match.awayTeamId : match.homeTeamId;
    if (loserId) this.eliminatedTeamIds.add(loserId);
    const roundInfo = KNOCKOUT_ROUNDS.find((round) => round.key === match.roundKey);
    if (!roundInfo?.next) {
      this.stage = STAGES.COMPLETE;
      this.championId = winnerId;
      return;
    }
    let nextRound = this.knockoutRounds.find((round) => round.key === roundInfo.next);
    if (!nextRound) {
      nextRound = { key: roundInfo.next, label: knockoutRoundLabel(roundInfo.next), matches: [] };
      this.knockoutRounds.push(nextRound);
    }
    const nextIndex = Math.floor(match.bracketIndex / 2);
    let nextMatch = nextRound.matches[nextIndex];
    if (!nextMatch) {
      nextMatch = {
        id: `${roundInfo.next}-${nextIndex + 1}`,
        stage: STAGES.KNOCKOUT,
        roundKey: roundInfo.next,
        roundName: knockoutRoundLabel(roundInfo.next),
        bracketIndex: nextIndex,
        sequence: this.matches.length + 1,
        homeTeamId: null,
        awayTeamId: null,
        status: "pending",
        result: null
      };
      nextRound.matches[nextIndex] = nextMatch;
      this.matches.push(nextMatch);
    }
    if (match.bracketIndex % 2 === 0) nextMatch.homeTeamId = winnerId;
    else nextMatch.awayTeamId = winnerId;
    if (nextMatch.homeTeamId && nextMatch.awayTeamId) nextMatch.status = "scheduled";
  }

  getBracketRounds() {
    return this.knockoutRounds.map((round) => ({ ...round, matches: round.matches.filter(Boolean) }));
  }
}
