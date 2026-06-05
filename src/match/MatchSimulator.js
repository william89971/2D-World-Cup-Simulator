import { average, clamp, createSeededRandom } from "../core/utils.js";

function teamAverages(team) {
  return {
    speed: average(team.players.map((player) => player.speed)),
    shooting: average(team.players.map((player) => player.shooting)),
    passing: average(team.players.map((player) => player.passing)),
    defending: average(team.players.map((player) => player.defending)),
    stamina: average(team.players.map((player) => player.stamina))
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

function expectedGoalsFor(attackingTeam, defendingTeam, neutralBias = 0) {
  const attack = teamAverages(attackingTeam);
  const defense = teamAverages(defendingTeam);
  const creation = attackingTeam.strength * 0.45 + attack.shooting * 0.32 + attack.passing * 0.23;
  const resistance = defendingTeam.strength * 0.26 + defense.defending * 0.48 + defense.stamina * 0.12;
  return clamp(1.25 + (creation - resistance) * 0.028 + neutralBias, 0.25, 3.75);
}

function penaltyWinner(random, homeTeam, awayTeam) {
  const homePenaltyQuality = homeTeam.strength + teamAverages(homeTeam).shooting * 0.6;
  const awayPenaltyQuality = awayTeam.strength + teamAverages(awayTeam).shooting * 0.6;
  const homeChance = clamp(homePenaltyQuality / (homePenaltyQuality + awayPenaltyQuality), 0.38, 0.62);
  return random() < homeChance ? homeTeam.id : awayTeam.id;
}

export function simulateMatchResult(match, homeTeam, awayTeam) {
  const random = createSeededRandom(`instant:${match.id}:${homeTeam.id}:${awayTeam.id}`);
  const homeLambda = expectedGoalsFor(homeTeam, awayTeam, 0.08);
  const awayLambda = expectedGoalsFor(awayTeam, homeTeam, -0.02);
  const home = poisson(random, homeLambda);
  const away = poisson(random, awayLambda);

  const result = { home, away, decidedBy: null, winnerId: null };
  if (match.stage !== "GROUP") {
    if (home > away) result.winnerId = homeTeam.id;
    if (away > home) result.winnerId = awayTeam.id;
    if (home === away) {
      result.decidedBy = "penalties";
      result.winnerId = penaltyWinner(random, homeTeam, awayTeam);
    }
  }

  return result;
}
