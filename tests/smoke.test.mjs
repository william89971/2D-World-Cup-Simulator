import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { FIELD, MATCH_PHASES, PLAYER_STATES, STAGES } from "../src/core/constants.js";
import { compactTeamName, distanceSq } from "../src/core/utils.js";
import { AudioManager } from "../src/audio/AudioManager.js";
import { buildGroups, flagUrl } from "../src/data/loadWorldCupData.js";
import { GROUPS, TEAMS, getTeamById } from "../src/data/teams.js";
import { MatchEngine } from "../src/match/MatchEngine.js";
import { resolvePlayerSpriteMeta } from "../src/render/CanvasRenderer.js";
import { TournamentManager } from "../src/tournament/TournamentManager.js";
import { TournamentState, selectKnockoutTeams } from "../src/tournament/TournamentState.js";

assert.equal(TEAMS.length, 48, "expected 48 teams");
assert.equal(GROUPS.length, 12, "expected 12 groups");
assert.equal(getTeamById("SLV")?.name, "El Salvador", "El Salvador is available in fallback teams");

for (const group of GROUPS) {
  assert.equal(group.teamIds.length, 4, `expected 4 teams in ${group.name}`);
}

for (const team of TEAMS) {
  assert.match(team.primary, /^#[0-9a-f]{6}$/i, `${team.name} primary color`);
  assert.match(team.secondary, /^#[0-9a-f]{6}$/i, `${team.name} secondary color`);
  assert.equal(team.players.length, 11, `${team.name} lineup size`);
  for (const player of team.players) {
    assert.ok(player.skillMoves >= 1 && player.skillMoves <= 5, `${player.name} skillMoves stat`);
    for (const key of ["speed", "shooting", "passing", "defending", "stamina"]) {
      assert.ok(player[key] >= 1 && player[key] <= 100, `${player.name} ${key} stat`);
    }
  }
}

const fallbackElSalvadorStar = getTeamById("SLV").players.find((player) => player.name === "Mateo Ceren");
assert.ok(fallbackElSalvadorStar, "El Salvador fallback roster includes Mateo Ceren");
assert.equal(fallbackElSalvadorStar.skillMoves, 5, "El Salvador fallback star has five-star skills");
assert.ok(fallbackElSalvadorStar.speed >= 90, "El Salvador fallback star has elite speed");
assert.ok(fallbackElSalvadorStar.shooting >= 88, "El Salvador fallback star has elite shooting");

const generatedPath = new URL("../teams.json", import.meta.url);
assert.ok(existsSync(generatedPath), "expected teams.json; run npm run generate:teams");
const generatedTeams = JSON.parse(readFileSync(generatedPath, "utf8"));
assert.equal(generatedTeams.length, 48, "generated teams count");

for (const team of generatedTeams) {
  assert.ok(team.iso2, `${team.countryName} iso2`);
  assert.match(flagUrl(team), /^https:\/\/flagcdn\.com\/w40\/[a-z]{2}(?:-[a-z]{3})?\.png$/, `${team.countryName} flag url`);
  if (team.iso2.startsWith("gb-")) {
    assert.match(flagUrl(team), /\/gb-[a-z]{3}\.png$/, `${team.countryName} UK subdivision flag path`);
  }
  assert.ok(team.coach?.name, `${team.countryName} coach name`);
  assert.ok(team.coach?.preferredFormation, `${team.countryName} preferred formation`);
  assert.ok(team.tactics, `${team.countryName} tactics`);
  for (const key of ["pressingIntensity", "defensiveLineHeight", "passingStyle"]) {
    assert.ok(team.tactics[key] >= 1 && team.tactics[key] <= 100, `${team.countryName} ${key}`);
  }
  assert.equal(team.roster.length, 23, `${team.countryName} roster size`);
  assert.equal(team.roster.filter((player) => player.isStarter).length, 11, `${team.countryName} starter count`);
  assert.equal(team.roster.filter((player) => !player.isStarter).length, 12, `${team.countryName} substitute count`);
  assert.equal(team.players.length, 11, `${team.countryName} engine players count`);
  assert.match(team.flagColor.primary, /^#[0-9a-f]{6}$/i, `${team.countryName} flag primary`);
  assert.match(team.flagColor.secondary, /^#[0-9a-f]{6}$/i, `${team.countryName} flag secondary`);
  for (const player of team.roster) {
    assert.ok(player.name, `${team.countryName} player name`);
    assert.ok(["GK", "DEF", "MID", "FWD"].includes(player.position), `${player.name} generic position`);
    assert.ok(player.role, `${player.name} tactical role`);
    assert.ok(player.skinTone, `${player.name} skin tone`);
    assert.ok(player.hairStyle, `${player.name} hair style`);
    assert.ok(player.hairColor, `${player.name} hair color`);
    assert.ok(Number.isInteger(player.skillMoves), `${player.name} skillMoves integer`);
    assert.ok(player.skillMoves >= 1 && player.skillMoves <= 5, `${player.name} skillMoves stars`);
    for (const key of ["speed", "shooting", "passing", "defending", "stamina", "ego"]) {
      assert.ok(player[key] >= 1 && player[key] <= 100, `${player.name} generated ${key} stat`);
    }
  }
}

const generatedElSalvador = generatedTeams.find((team) => team.id === "SLV");
assert.ok(generatedElSalvador, "generated teams include El Salvador");
assert.equal(generatedElSalvador.countryName, "El Salvador", "generated El Salvador country name");
assert.equal(generatedElSalvador.iso2, "sv", "generated El Salvador FlagCDN iso2");
const generatedElSalvadorStar = generatedElSalvador.roster.find((player) => player.name === "Mateo Ceren");
assert.ok(generatedElSalvadorStar, "generated El Salvador roster includes Mateo Ceren");
assert.equal(generatedElSalvadorStar.skillMoves, 5, "generated El Salvador star has five-star skills");
assert.ok(generatedElSalvadorStar.ego >= 85, "generated El Salvador star has high ego");
assert.ok(generatedElSalvadorStar.shooting >= 88, "generated El Salvador star has elite shooting");

for (const eliteId of ["ARG", "BRA", "FRA"]) {
  const elite = generatedTeams.find((team) => team.id === eliteId);
  assert.ok(
    elite.roster.some((player) => ["AM", "RW", "ST", "LW"].includes(player.role) && player.skillMoves >= 4),
    `${elite.countryName} has elite attacking skill players`
  );
}

const fallbackSource = { id: "fallback-10", name: "Missing Metadata" };
assert.deepEqual(resolvePlayerSpriteMeta(fallbackSource), resolvePlayerSpriteMeta(fallbackSource), "sprite fallback deterministic");
assert.equal(
  resolvePlayerSpriteMeta({ ...fallbackSource, skinTone: "#123456", hairStyle: "bald", hairColor: "#654321" }).skinTone,
  "#123456",
  "sprite metadata preserves explicit values"
);
assert.doesNotThrow(() => {
  AudioManager.playKick();
  AudioManager.playWhistle();
  AudioManager.playGoalCheer();
  AudioManager.playTackle();
  AudioManager.playSkill();
}, "audio hooks are silent no-ops");
assert.equal(compactTeamName("Democratic Republic of Congo").length, 15, "long scoreboard team names compact");
assert.ok(compactTeamName("Democratic Republic of Congo").endsWith("..."), "long scoreboard team names use literal ellipsis");
assert.equal(compactTeamName("Argentina"), "Argentina", "short scoreboard team names remain unchanged");

const tournament = new TournamentManager();
const knockoutPool = selectKnockoutTeams(generatedTeams);
assert.equal(knockoutPool.length, 32, "knockout selection pool size");
assert.ok(knockoutPool.some((team) => team.id === "SLV"), "knockout pool force-includes El Salvador");
assert.equal(tournament.matches.filter((match) => match.stage === STAGES.GROUP).length, 0, "no group matches in knockout-only mode");
assert.equal(tournament.getBracketRounds()[0].matches.length, 16, "initial round of 32 match count");
assert.equal(tournament.getScheduledMatches().length, 16, "initial knockout schedule count");

const generatedTournamentA = new TournamentState({ teams: generatedTeams, groups: buildGroups(generatedTeams) });
const generatedTournamentB = new TournamentState({ teams: generatedTeams, groups: buildGroups(generatedTeams) });
const generatedMatch = generatedTournamentA.getNextMatch();
const generatedResultA = generatedTournamentA.fastSim(generatedMatch);
const generatedResultB = generatedTournamentB.fastSim(generatedTournamentB.getNextMatch());
assert.deepEqual(
  {
    home: generatedResultA.home,
    away: generatedResultA.away,
    winnerId: generatedResultA.winnerId,
    eventTypes: generatedResultA.events.map((event) => event.type)
  },
  {
    home: generatedResultB.home,
    away: generatedResultB.away,
    winnerId: generatedResultB.winnerId,
    eventTypes: generatedResultB.events.map((event) => event.type)
  },
  "fast sim is deterministic per match"
);

const simToUserTournament = new TournamentState({ teams: generatedTeams, groups: buildGroups(generatedTeams) });
const simCount = simToUserTournament.simulateToUserMatch("USA");
assert.ok(simCount > 0, "sim to user advances non-user matches");
assert.ok(simToUserTournament.matchIncludesTeam(simToUserTournament.getNextMatch(), "USA"), "sim to user stops before user match");

const knockoutProbe = new TournamentState({ teams: generatedTeams, groups: buildGroups(generatedTeams) });
let decidedKnockout = null;
for (let i = 0; i < 240 && !decidedKnockout; i += 1) {
  const result = knockoutProbe.fastSim({
    id: `K-PROBE-${i}`,
    stage: STAGES.KNOCKOUT,
    homeTeamId: "ARG",
    awayTeamId: "FRA",
    status: "scheduled",
    sequence: 900 + i
  });
  if (result.decidedBy) decidedKnockout = result;
}
assert.ok(decidedKnockout?.winnerId, "knockout draw path decides a winner");
assert.ok(["extra time", "penalties"].includes(decidedKnockout.decidedBy), "knockout draw uses extra time or penalties");

const memoryTournament = new TournamentState({ teams: generatedTeams, groups: buildGroups(generatedTeams) });
memoryTournament.memory.recordWin(memoryTournament.getTeam("BRA"), {
  pressingIntensity: 55,
  defensiveLineHeight: 85,
  passingStyle: 58
});
assert.ok(memoryTournament.getPreparedTeam("ARG", "BRA").tactics.passingStyle >= 85, "memory adjusts direct passing versus high line");

const suspendedPlayer = memoryTournament.getTeam("ARG").roster[0];
memoryTournament.applyCard(suspendedPlayer.id, "yellow");
memoryTournament.applyCard(suspendedPlayer.id, "yellow");
assert.equal(memoryTournament.getPlayerStatus(suspendedPlayer.id).suspendedMatches, 1, "two yellows create one-match ban");
assert.ok(!memoryTournament.getAvailableLineup("ARG").some((player) => player.id === suspendedPlayer.id), "suspended player unavailable");

const setupTeams = JSON.parse(JSON.stringify(generatedTeams));
const setupArgentina = setupTeams.find((team) => team.id === "ARG");
const originalStarter = setupArgentina.roster.find((player) => player.isStarter);
const chosenSub = setupArgentina.roster.find((player) => !player.isStarter);
originalStarter.isStarter = false;
originalStarter.lineupOrder = null;
chosenSub.isStarter = true;
chosenSub.lineupOrder = 0;
const setupTournament = new TournamentState({ teams: setupTeams, groups: buildGroups(setupTeams) });
assert.equal(setupTournament.getAvailableLineup("ARG")[0].id, chosenSub.id, "user-selected starter is honored in available lineup");

const customElSalvador = JSON.parse(JSON.stringify(generatedElSalvador));
customElSalvador.formation = "3-5-2";
customElSalvador.coach.preferredFormation = "3-5-2";
customElSalvador.tactics = { pressingIntensity: 91, defensiveLineHeight: 27, passingStyle: 84 };
const salvadorStarter = customElSalvador.roster.find((player) => player.isStarter);
const salvadorSub = customElSalvador.roster.find((player) => !player.isStarter);
salvadorStarter.isStarter = false;
salvadorStarter.lineupOrder = null;
salvadorSub.isStarter = true;
salvadorSub.lineupOrder = 0;
customElSalvador.players = customElSalvador.roster.filter((player) => player.isStarter).slice(0, 11);
const customTournament = new TournamentState({
  teams: generatedTeams,
  groups: buildGroups(generatedTeams),
  userTeamId: "SLV",
  userTeam: customElSalvador
});
assert.equal(customTournament.getTeam("SLV").roster.length, 23, "custom user team keeps 23-player roster");
assert.equal(customTournament.getTeam("SLV").formation, "3-5-2", "custom user formation survives tournament initialization");
assert.equal(customTournament.getPreparedTeam("SLV", "ARG").tactics.pressingIntensity, 91, "custom pressing persists into prepared team");
assert.equal(customTournament.getAvailableLineup("SLV")[0].id, salvadorSub.id, "custom starter swap survives tournament initialization");
assert.equal(customTournament.getPreparedTeam("SLV", "ARG").players.length, 11, "custom prepared team has exactly 11 players");

const firstRoundMatch = tournament.getNextMatch();
const firstRoundTeams = [firstRoundMatch.homeTeamId, firstRoundMatch.awayTeamId];
const firstRoundResult = tournament.simulateMatch(firstRoundMatch.id);
assert.ok(firstRoundResult.winnerId, "knockout match produces a winner");
const eliminatedId = firstRoundTeams.find((teamId) => teamId !== firstRoundResult.winnerId);
assert.ok(tournament.eliminatedTeamIds.has(eliminatedId), "knockout loser is eliminated");
assert.ok(!tournament.getScheduledMatches().some((match) => tournament.matchIncludesTeam(match, eliminatedId)), "eliminated team does not reappear in scheduled matches");

const progressionTournament = new TournamentState({ teams: generatedTeams, groups: buildGroups(generatedTeams) });
while (progressionTournament.getNextMatch()) {
  progressionTournament.simulateMatch(progressionTournament.getNextMatch().id);
}
assert.equal(progressionTournament.stage, STAGES.COMPLETE, "knockout tournament completes");
assert.ok(progressionTournament.championId, "knockout tournament crowns champion");
assert.equal(progressionTournament.getBracketRounds().at(-1).key, "F", "final round exists");

const firstWatched = tournament.getNextMatch();
let watchedResult = null;
const engine = new MatchEngine({
  match: firstWatched,
  homeTeam: getTeamById(firstWatched.homeTeamId),
  awayTeam: getTeamById(firstWatched.awayTeamId),
  onComplete: (result) => {
    watchedResult = result;
  }
});

for (let i = 0; i < 4400 && !engine.complete; i += 1) {
  engine.update(1 / 24);
}

const snapshot = engine.getSnapshot();
assert.ok(watchedResult, "watched match completes");
assert.ok(watchedResult.summary, "watched match produces newspaper summary");
assert.ok(watchedResult.events.some((event) => event.type === "weather"), "match logs weather");
assert.equal(snapshot.players.length, 22, "match has 22 players");
assert.ok(Number.isFinite(snapshot.ball.x), "ball x finite");
assert.ok(Number.isFinite(snapshot.ball.y), "ball y finite");
assert.ok(snapshot.players.every((player) => Object.values(PLAYER_STATES).includes(player.state)), "valid AI states");
assert.ok(Array.isArray(snapshot.visualEvents), "match snapshot exposes visual events");

engine.logGoal(engine.homeTeam, engine.awayTeam, false);
assert.ok(engine.getSnapshot().visualEvents.some((event) => event.type === "goal"), "goal emits visual event");
for (let i = 0; i < 40; i += 1) engine.emitVisualEvent("probe", { index: i });
assert.ok(engine.getSnapshot().visualEvents.length <= 32, "visual events are bounded");

const overlapEngine = new MatchEngine({
  match: firstWatched,
  homeTeam: getTeamById(firstWatched.homeTeamId),
  awayTeam: getTeamById(firstWatched.awayTeamId)
});
const stuckA = overlapEngine.players[0];
const stuckB = overlapEngine.players[1];
stuckA.x = 420;
stuckA.y = 320;
stuckB.x = 420;
stuckB.y = 320;
stuckA.vx = 0;
stuckA.vy = 0;
stuckB.vx = 0;
stuckB.vy = 0;
overlapEngine.resolvePlayerCollisions();
assert.ok(distanceSq(stuckA, stuckB) >= (FIELD.playerRadius * 2 - 0.5) ** 2, "exact player overlap resolves");

const outEngine = new MatchEngine({
  match: firstWatched,
  homeTeam: getTeamById(firstWatched.homeTeamId),
  awayTeam: getTeamById(firstWatched.awayTeamId)
});
outEngine.lastTouchTeamId = outEngine.homeTeam.id;
outEngine.ball.x = FIELD.width / 2;
outEngine.ball.y = -FIELD.ballRadius - 2;
outEngine.updateBall(1 / 24);
assert.equal(outEngine.matchPhase, MATCH_PHASES.STOPPAGE, "sideline exit creates stoppage");
assert.equal(outEngine.setPiece?.type, "THROW_IN", "sideline exit creates throw-in");

const dribbleEngine = new MatchEngine({
  match: firstWatched,
  homeTeam: getTeamById(firstWatched.homeTeamId),
  awayTeam: getTeamById(firstWatched.awayTeamId)
});
dribbleEngine.givePossession(dribbleEngine.players[0]);
dribbleEngine.update(1 / 24);
assert.equal(dribbleEngine.players[0].state, PLAYER_STATES.DRIBBLING, "possession enters dribbling state");

const formationEngine = new MatchEngine({
  match: firstWatched,
  homeTeam: { ...getTeamById(firstWatched.homeTeamId), formation: "4-4-2" },
  awayTeam: getTeamById(firstWatched.awayTeamId)
});
assert.ok(Math.abs(formationEngine.players[9].homeY - FIELD.height * 0.42) < 1, "selected formation changes striker slot one");
assert.ok(Math.abs(formationEngine.players[10].homeY - FIELD.height * 0.58) < 1, "selected formation changes striker slot two");

const fatigueEngine = new MatchEngine({
  match: firstWatched,
  homeTeam: getTeamById(firstWatched.homeTeamId),
  awayTeam: getTeamById(firstWatched.awayTeamId)
});
const dribblerFatigue = fatigueEngine.players[0];
const runnerFatigue = fatigueEngine.players[6];
Object.assign(dribblerFatigue.source, { speed: 80, stamina: 70 });
Object.assign(runnerFatigue.source, { speed: 80, stamina: 70 });
dribblerFatigue.state = PLAYER_STATES.DRIBBLING;
runnerFatigue.state = PLAYER_STATES.ATTACK;
dribblerFatigue.x = 300;
dribblerFatigue.y = 180;
runnerFatigue.x = 300;
runnerFatigue.y = 820;
dribblerFatigue.targetX = 900;
runnerFatigue.targetX = 900;
dribblerFatigue.targetY = dribblerFatigue.y;
runnerFatigue.targetY = runnerFatigue.y;
dribblerFatigue.fatigue = 1;
runnerFatigue.fatigue = 1;
fatigueEngine.updatePlayers(1 / 24);
assert.ok(1 - dribblerFatigue.fatigue > 1 - runnerFatigue.fatigue, "dribbling drains stamina faster than off-ball sprinting");

const cornerEngine = new MatchEngine({
  match: firstWatched,
  homeTeam: getTeamById(firstWatched.homeTeamId),
  awayTeam: getTeamById(firstWatched.awayTeamId)
});
cornerEngine.triggerSetPiece({
  type: "CORNER_KICK",
  restartTeamId: cornerEngine.homeTeam.id,
  x: FIELD.width - FIELD.ballRadius,
  y: FIELD.ballRadius,
  reason: "corner probe"
});
const cornerTaker = cornerEngine.players.find((player) => player.id === cornerEngine.setPiece.takerId);
assert.equal(cornerTaker.vx, 0, "corner taker vx resets during setup");
assert.equal(cornerTaker.vy, 0, "corner taker vy resets during setup");
cornerTaker.vx = 220;
cornerTaker.vy = -140;
cornerEngine.executeSetPiece();
assert.equal(cornerTaker.vx, 0, "corner taker vx resets before execution");
assert.equal(cornerTaker.vy, 0, "corner taker vy resets before execution");
assert.ok(cornerEngine.ball.x < FIELD.width && cornerEngine.ball.x > 0, "corner target stays inside field");

const skillEngine = new MatchEngine({
  match: firstWatched,
  homeTeam: getTeamById(firstWatched.homeTeamId),
  awayTeam: getTeamById(firstWatched.awayTeamId)
});
const skiller = skillEngine.players[8];
const marker = skillEngine.players.find((player) => player.teamId !== skiller.teamId);
Object.assign(skiller.source, { skillMoves: 5, ego: 96, speed: 92 });
Object.assign(marker.source, { defending: 20, speed: 45 });
skiller.x = 920;
skiller.y = 500;
marker.x = 938;
marker.y = 500;
skillEngine.givePossession(skiller);
const skillRolls = [0, 0.6, 0];
skillEngine.random = () => skillRolls.shift() ?? 0.5;
skillEngine.update(1 / 24);
assert.equal(skiller.state, PLAYER_STATES.SKILL_MOVE, "high-skill dribbler enters skill move under pressure");
assert.equal(marker.state, PLAYER_STATES.FROZEN, "beaten defender freezes after skill move");
assert.ok(skiller.visualBurstTimer > 0, "skill success exposes visual burst timer");
assert.ok(skillEngine.getSnapshot().visualEvents.some((event) => event.type === "fiveStarSkill"), "five-star skill emits visual event");

const failedSkillEngine = new MatchEngine({
  match: firstWatched,
  homeTeam: getTeamById(firstWatched.homeTeamId),
  awayTeam: getTeamById(firstWatched.awayTeamId)
});
const riskyDribbler = failedSkillEngine.players[8];
const strongMarker = failedSkillEngine.players.find((player) => player.teamId !== riskyDribbler.teamId);
Object.assign(riskyDribbler.source, { skillMoves: 5, ego: 96, speed: 70 });
Object.assign(strongMarker.source, { defending: 100, speed: 80 });
riskyDribbler.x = 920;
riskyDribbler.y = 500;
strongMarker.x = 938;
strongMarker.y = 500;
failedSkillEngine.givePossession(riskyDribbler);
const failRolls = [0, 0.6, 0.99];
failedSkillEngine.random = () => failRolls.shift() ?? 0.5;
failedSkillEngine.update(1 / 24);
assert.equal(failedSkillEngine.possessionPlayer, null, "failed skill move loses possession");
assert.notEqual(strongMarker.state, PLAYER_STATES.FROZEN, "failed skill move does not freeze defender");

tournament.applyWatchedResult(firstWatched.id, watchedResult);
tournament.simulateTournamentRemainder();
assert.equal(tournament.stage, STAGES.COMPLETE, "tournament completes");
assert.ok(tournament.championId, "champion exists");

console.log("Smoke tests passed");
