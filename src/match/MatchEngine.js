import { FIELD, FORMATION, FORMATIONS, MATCH, MATCH_PHASES, PLAYER_STATES, STAGES } from "../core/constants.js";
import { clamp, createSeededRandom, distance, distanceSq, hashString, normalize, signedTeamDirection } from "../core/utils.js";
import { AudioManager } from "../audio/AudioManager.js";
import { MatchLogger } from "./MatchLogger.js";

const TEAM_SIDES = Object.freeze({
  home: { side: "home", attackDirection: 1 },
  away: { side: "away", attackDirection: -1 }
});

const DEFAULT_TACTICS = Object.freeze({
  pressingIntensity: 50,
  defensiveLineHeight: 50,
  passingStyle: 50
});

const DEFENDER_ROLES = new Set(["DEF", "RB", "CB", "LB", "RWB", "LWB"]);
const GOALKEEPER_ROLES = new Set(["GK"]);
const STRIKER_ROLES = new Set(["FWD", "ST", "CF"]);
const PLAYER_SEPARATION_BUFFER = 16;
const PLAYER_SEPARATION_WEIGHT = Object.freeze({
  default: 0.55,
  seekBall: 0.9,
  carrier: 0.35
});
const SET_PIECE_TYPES = Object.freeze({
  THROW_IN: "THROW_IN",
  GOAL_KICK: "GOAL_KICK",
  CORNER_KICK: "CORNER_KICK",
  DIRECT_FREE_KICK: "DIRECT_FREE_KICK",
  PENALTY_KICK: "PENALTY_KICK"
});
const SET_PIECE_STOPPAGE_SECONDS = 0.45;
const SET_PIECE_SETUP_SECONDS = 1.15;
const VIRTUAL_TEN_YARDS = FIELD.width / 12;
const WEATHER_TYPES = Object.freeze(["Clear", "Rain", "Heat"]);
const SKILL_MOVE_TYPES = Object.freeze(["stepover", "roulette", "nutmeg", "heelToHeel"]);
const SKILL_MOVE_DURATION_SECONDS = 1;
const FROZEN_SECONDS = 15 / 24;
const SKILL_COOLDOWN_SECONDS = 1.65;
const MAX_VISUAL_EVENTS = 32;

function teamTactics(team) {
  const source = team?.effectiveTactics ?? team?.tactics ?? {};
  return {
    pressingIntensity: clamp(Number(source.pressingIntensity ?? DEFAULT_TACTICS.pressingIntensity), 1, 100),
    defensiveLineHeight: clamp(Number(source.defensiveLineHeight ?? DEFAULT_TACTICS.defensiveLineHeight), 1, 100),
    passingStyle: clamp(Number(source.passingStyle ?? DEFAULT_TACTICS.passingStyle), 1, 100)
  };
}

function roleFor(player) {
  return player.source.role ?? player.source.position ?? player.position;
}

function isGoalkeeper(player) {
  return GOALKEEPER_ROLES.has(roleFor(player));
}

function isDefender(player) {
  return DEFENDER_ROLES.has(roleFor(player)) || DEFENDER_ROLES.has(player.source.position);
}

function isStriker(player) {
  return STRIKER_ROLES.has(roleFor(player)) || player.position === "ST";
}

function deterministicNormalForPair(a, b) {
  const hash = hashString(`${a.id}:${b.id}`);
  const angle = (hash / 4294967296) * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function playerMaxSpeed(player) {
  const fatigueFactor = 0.62 + player.fatigue * 0.38;
  return (68 + player.source.speed * 1.25) * fatigueFactor;
}

function accelerationFor(player) {
  return 230 + player.source.speed * 2.6;
}

function tackleRadiusFor(player) {
  const pressBoost = Math.max(0, teamTactics(player.team).pressingIntensity - 50) * 0.05;
  const rainBoost = player.team.weather === "Rain" ? 9 : 0;
  return FIELD.playerRadius + FIELD.ballRadius + 8 + player.source.defending * 0.16 + pressBoost + rainBoost;
}

function skillStarsFor(player) {
  return clamp(Math.round(Number(player.source.skillMoves ?? 2)), 1, 5);
}

function pressCountFor(team) {
  const intensity = teamTactics(team).pressingIntensity;
  if (intensity >= 85) return 4;
  if (intensity >= 70) return 3;
  if (intensity >= 55) return 2;
  return 1;
}

function attackingGoalX(side) {
  return side === "home" ? FIELD.width + FIELD.goalDepth : -FIELD.goalDepth;
}

function ownGoalX(side) {
  return side === "home" ? -FIELD.goalDepth : FIELD.width + FIELD.goalDepth;
}

function fieldGoalCenter(side) {
  return { x: attackingGoalX(side), y: FIELD.height / 2 };
}

function clampPointToField(x, y, margin = FIELD.ballRadius) {
  return {
    x: clamp(x, margin, FIELD.width - margin),
    y: clamp(y, margin, FIELD.height - margin)
  };
}

function isInGoalMouth(y) {
  return Math.abs(y - FIELD.height / 2) < FIELD.goalWidth / 2;
}

function isInsidePenaltyAreaForSide(x, y, side) {
  const inPenaltyY = Math.abs(y - FIELD.height / 2) <= FIELD.penaltyBoxHeight / 2;
  if (!inPenaltyY) return false;
  return side === "home" ? x <= FIELD.penaltyBoxWidth : x >= FIELD.width - FIELD.penaltyBoxWidth;
}

function formationForTeam(team) {
  return FORMATIONS[team?.formation] ?? FORMATIONS[team?.coach?.preferredFormation] ?? FORMATION;
}

function createEntityPlayer(team, side, source, index) {
  const slot = formationForTeam(team)[index] ?? FORMATION[index];
  const mirroredX = side === "home" ? slot.x : 1 - slot.x;
  const x = mirroredX * FIELD.width;
  const y = slot.y * FIELD.height;
  return {
    id: `${side}-${source.id}`,
    teamId: team.id,
    team,
    side,
    source,
    number: source.number,
    name: source.name,
    position: source.position,
    homeX: x,
    homeY: y,
    x,
    y,
    vx: 0,
    vy: 0,
    targetX: x,
    targetY: y,
    radius: FIELD.playerRadius,
    state: PLAYER_STATES.RETURN_TO_POSITION,
    fatigue: 1,
    intentCooldown: 0,
    tackleCooldown: 0,
    skillCooldown: 0,
    frozenTimer: 0,
    visualBurstTimer: 0,
    skillFlashTimer: 0,
    skillMove: null,
    dribbleElapsed: 0,
    dribbleLimit: 0,
    hasPossession: false
  };
}

function createMatchTeam(team) {
  return {
    ...team,
    tactics: { ...(team.tactics ?? DEFAULT_TACTICS) },
    effectiveTactics: { ...(team.tactics ?? DEFAULT_TACTICS) },
    runtimeMomentum: { positiveUntil: 0, panicUntil: 0, gameMinutes: 0 },
    players: team.players.map((player) => ({ ...player, ego: player.ego ?? 50, skillMoves: player.skillMoves ?? 2 }))
  };
}

function kickoffPlayers(players, homeScore, awayScore) {
  for (const player of players) {
    player.x = player.homeX;
    player.y = player.homeY;
    player.vx = 0;
    player.vy = 0;
    player.state = PLAYER_STATES.RETURN_TO_POSITION;
    player.hasPossession = false;
    player.dribbleElapsed = 0;
    player.dribbleLimit = 0;
    player.skillCooldown = 0;
    player.frozenTimer = 0;
    player.visualBurstTimer = 0;
    player.skillFlashTimer = 0;
    player.skillMove = null;
    if (isStriker(player)) {
      const offset = player.side === "home" ? -36 : 36;
      player.x = FIELD.width / 2 + offset;
      player.y = FIELD.height / 2 + (homeScore + awayScore) % 2 * 18 - 9;
    }
  }
}

export class MatchEngine {
  constructor({ match, homeTeam, awayTeam, tournamentContext = null, onComplete = () => {} }) {
    this.match = match;
    this.homeTeam = createMatchTeam(homeTeam);
    this.awayTeam = createMatchTeam(awayTeam);
    this.tournamentContext = tournamentContext;
    this.onComplete = onComplete;
    this.random = createSeededRandom(`watch:${match.id}:${this.homeTeam.id}:${this.awayTeam.id}`);
    this.weather = this.rollWeather();
    this.homeTeam.weather = this.weather;
    this.awayTeam.weather = this.weather;
    this.logger = new MatchLogger();
    this.logger.record({ minute: 0, type: "weather", text: `${this.weather} conditions at kickoff` });
    this.passStreaks = new Map([
      [this.homeTeam.id, 0],
      [this.awayTeam.id, 0]
    ]);
    this.nextManagerMinute = 15;
    this.finalManagerApplied = false;
    this.pendingPass = null;
    this.players = [
      ...this.homeTeam.players.map((player, index) => createEntityPlayer(this.homeTeam, "home", player, index)),
      ...this.awayTeam.players.map((player, index) => createEntityPlayer(this.awayTeam, "away", player, index))
    ];
    this.ball = { x: FIELD.width / 2, y: FIELD.height / 2, vx: 0, vy: 0, radius: FIELD.ballRadius };
    this.score = { home: 0, away: 0 };
    this.gameMinutes = 0;
    this.realSeconds = 0;
    this.paused = false;
    this.complete = false;
    this.result = null;
    this.possessionPlayer = null;
    this.lastTouchTeamId = null;
    this.lastEvent = "Kickoff";
    this.matchPhase = MATCH_PHASES.OPEN_PLAY;
    this.phaseTimer = 0;
    this.setPiece = null;
    this.visualEvents = [];
    this.nextVisualEventId = 1;
    kickoffPlayers(this.players, 0, 0);
  }

  rollWeather() {
    const random = createSeededRandom(`weather:${this.match.id}:${this.homeTeam.id}:${this.awayTeam.id}`);
    const roll = random();
    if (roll < 0.62) return WEATHER_TYPES[0];
    if (roll < 0.84) return WEATHER_TYPES[1];
    return WEATHER_TYPES[2];
  }

  setPaused(paused) {
    this.paused = paused;
  }

  update(deltaSeconds) {
    if (this.paused || this.complete) return;
    const dt = Math.min(deltaSeconds, MATCH.maxDeltaSeconds);
    this.realSeconds += dt;
    this.gameMinutes = clamp(this.realSeconds * (MATCH.gameMinutes / MATCH.realSeconds), 0, MATCH.gameMinutes);
    this.homeTeam.runtimeMomentum.gameMinutes = this.gameMinutes;
    this.awayTeam.runtimeMomentum.gameMinutes = this.gameMinutes;
    this.updateManagerAI();

    if (this.matchPhase === MATCH_PHASES.STOPPAGE) {
      this.updateStoppage(dt);
      this.checkMatchTime();
      return;
    }

    if (this.matchPhase === MATCH_PHASES.SET_PIECE) {
      this.updateSetPiece(dt);
      this.checkMatchTime();
      return;
    }

    this.updateAI(dt);
    this.updatePlayers(dt);
    this.resolvePlayerCollisions();
    this.resolveTackles(dt);
    if (this.matchPhase !== MATCH_PHASES.OPEN_PLAY) {
      this.checkMatchTime();
      return;
    }
    this.updatePossession();
    this.updateBall(dt);
    this.checkMatchTime();
  }

  checkMatchTime() {
    if (this.gameMinutes >= MATCH.gameMinutes) {
      this.finishMatch();
    }
  }

  updateManagerAI() {
    const finalWindow = !this.finalManagerApplied && this.gameMinutes >= 80;
    const shouldEvaluate = this.gameMinutes >= this.nextManagerMinute || finalWindow;
    if (!shouldEvaluate) return;
    while (this.nextManagerMinute <= this.gameMinutes) this.nextManagerMinute += 15;
    if (finalWindow) this.finalManagerApplied = true;
    this.applyManagerTactics(this.homeTeam, this.score.home, this.score.away);
    this.applyManagerTactics(this.awayTeam, this.score.away, this.score.home);
  }

  applyManagerTactics(team, ownScore, opponentScore) {
    const base = team.tactics ?? DEFAULT_TACTICS;
    const effective = { ...base };
    if (ownScore < opponentScore && this.gameMinutes >= 45) {
      effective.pressingIntensity = Math.max(effective.pressingIntensity, 92);
      effective.passingStyle = Math.max(effective.passingStyle, 88);
      effective.defensiveLineHeight = Math.max(effective.defensiveLineHeight, 76);
      this.logger.record({ minute: this.gameMinutes, type: "tactic", teamId: team.id, text: `${team.name} chase the game` });
    }
    if (ownScore > opponentScore && this.gameMinutes >= 80) {
      effective.pressingIntensity = Math.min(effective.pressingIntensity, 36);
      effective.passingStyle = Math.min(effective.passingStyle, 38);
      effective.defensiveLineHeight = Math.min(effective.defensiveLineHeight, 26);
      this.logger.record({ minute: this.gameMinutes, type: "tactic", teamId: team.id, text: `${team.name} park the bus` });
    }
    team.effectiveTactics = effective;
  }

  updateAI(dt) {
    const pressersByTeam = this.pressersByTeam();

    for (const player of this.players) {
      player.intentCooldown = Math.max(0, player.intentCooldown - dt);
      player.tackleCooldown = Math.max(0, player.tackleCooldown - dt);
      player.skillCooldown = Math.max(0, player.skillCooldown - dt);
      player.visualBurstTimer = Math.max(0, player.visualBurstTimer - dt);
      player.skillFlashTimer = Math.max(0, player.skillFlashTimer - dt);
      player.hasPossession = this.possessionPlayer === player;

      if (player.frozenTimer > 0) {
        player.frozenTimer = Math.max(0, player.frozenTimer - dt);
        player.state = PLAYER_STATES.FROZEN;
        player.targetX = player.x;
        player.targetY = player.y;
        player.vx *= 0.82;
        player.vy *= 0.82;
        if (this.possessionPlayer !== player) continue;
      }

      if (this.possessionPlayer === player) {
        if (this.updateActiveSkillMove(player, dt)) continue;
        if (this.maybeStartSkillMove(player)) continue;
        player.state = PLAYER_STATES.DRIBBLING;
        player.dribbleElapsed += dt;
        this.setDribbleTarget(player);
        if (player.intentCooldown <= 0 && player.dribbleElapsed >= player.dribbleLimit) this.chooseOnBallAction(player);
        continue;
      }

      if (!this.possessionPlayer) {
        if (pressersByTeam.get(player.teamId)?.has(player)) {
          player.state = PLAYER_STATES.SEEK_BALL;
          player.targetX = this.ball.x;
          player.targetY = this.ball.y;
        } else {
          player.state = PLAYER_STATES.RETURN_TO_POSITION;
          this.setReturnTarget(player);
        }
        continue;
      }

      if (this.possessionPlayer.teamId === player.teamId) {
        player.state = PLAYER_STATES.ATTACK;
        this.setSupportTarget(player);
      } else if (pressersByTeam.get(player.teamId)?.has(player)) {
        player.state = PLAYER_STATES.SEEK_BALL;
        player.targetX = this.ball.x;
        player.targetY = this.ball.y;
      } else {
        player.state = PLAYER_STATES.DEFEND;
        this.setDefensiveTarget(player);
      }
    }
  }

  updateActiveSkillMove(player, dt) {
    const skillMove = player.skillMove;
    if (!skillMove?.success || skillMove.timer <= 0) {
      if (skillMove?.timer <= 0) player.skillMove = null;
      return false;
    }

    skillMove.timer = Math.max(0, skillMove.timer - dt);
    player.state = PLAYER_STATES.SKILL_MOVE;
    if (skillMove.type === "stepover" || skillMove.type === "heelToHeel") {
      const direction = signedTeamDirection(player.side);
      const burst = skillMove.type === "heelToHeel" ? 235 : 175;
      player.targetX = clamp(player.x + direction * burst, 70, FIELD.width - 70);
      player.targetY = clamp(player.y, 70, FIELD.height - 70);
    } else if (skillMove.type === "roulette") {
      player.targetX = clamp(player.x + signedTeamDirection(player.side) * 125, 70, FIELD.width - 70);
      player.targetY = clamp(player.targetY, 70, FIELD.height - 70);
    }

    if (skillMove.timer <= 0) player.skillMove = null;
    return this.possessionPlayer === player;
  }

  maybeStartSkillMove(player) {
    if (player.skillCooldown > 0 || player.skillMove) return false;
    const defender = this.nearestTacklingDefender(player);
    if (!defender) return false;

    const stars = skillStarsFor(player);
    const ego = player.source.ego ?? 50;
    const triggerChance = clamp(0.02 + (stars - 1) * 0.115 + (ego - 50) * 0.004 + (player.source.speed - 70) * 0.0015, 0.02, 0.72);
    player.skillCooldown = 0.42;
    if (this.random() > triggerChance) return false;

    const type = this.chooseSkillMoveType(player, defender);
    const attackerSkill = stars * 20 + player.source.speed * 0.08 + ego * 0.06;
    const defenderSkill = defender.source.defending + defender.source.speed * 0.06;
    const pressure = clamp(1 - distance(player, defender) / Math.max(tackleRadiusFor(defender), 1), 0, 1);
    const successChance = clamp(0.36 + (attackerSkill - defenderSkill) / 120 - pressure * 0.08, 0.14, 0.88);
    const success = this.random() < successChance;
    player.skillCooldown = SKILL_COOLDOWN_SECONDS;

    if (!success) {
      this.failSkillMove(player, defender, type);
      return true;
    }

    player.skillMove = {
      type,
      timer: SKILL_MOVE_DURATION_SECONDS,
      duration: SKILL_MOVE_DURATION_SECONDS,
      defenderId: defender.id,
      success: true
    };
    player.state = PLAYER_STATES.SKILL_MOVE;
    player.visualBurstTimer = 0.72;
    player.skillFlashTimer = type === "stepover" || type === "heelToHeel" ? 0.38 : 0.18;
    defender.frozenTimer = FROZEN_SECONDS;
    defender.tackleCooldown = FROZEN_SECONDS + 0.25;
    defender.state = PLAYER_STATES.FROZEN;
    defender.skillMove = null;
    this.executeSuccessfulSkillMove(player, defender, type);
    AudioManager.playSkill();
    this.emitVisualEvent(stars >= 5 ? "fiveStarSkill" : "skill", {
      teamId: player.teamId,
      playerId: player.source.id,
      defenderPlayerId: defender.source.id,
      skillMoveType: type,
      x: player.x,
      y: player.y
    });
    this.logger.record({
      minute: this.gameMinutes,
      type: "skillMove",
      teamId: player.teamId,
      playerId: player.source.id,
      text: `${player.name} beats ${defender.name} with ${this.skillMoveLabel(type)}`,
      metadata: { type, defenderPlayerId: defender.source.id }
    });
    this.lastEvent = `${player.name}: ${this.skillMoveLabel(type)}`;
    return true;
  }

  nearestTacklingDefender(player) {
    return this.players
      .filter((candidate) => candidate.teamId !== player.teamId && candidate.frozenTimer <= 0 && candidate.tackleCooldown <= 0)
      .filter((candidate) => distanceSq(candidate, player) <= tackleRadiusFor(candidate) ** 2)
      .sort((a, b) => distanceSq(a, player) - distanceSq(b, player))[0] ?? null;
  }

  chooseSkillMoveType(player, defender) {
    const stars = skillStarsFor(player);
    const speedBias = player.source.speed >= 82;
    const closePressure = distance(player, defender) < FIELD.playerRadius * 2.4;
    const roll = this.random();
    if (stars >= 4 && closePressure && roll < 0.28) return "nutmeg";
    if (stars >= 3 && roll < 0.52) return "roulette";
    if (speedBias && roll < 0.78) return "heelToHeel";
    return "stepover";
  }

  skillMoveLabel(type) {
    if (type === "heelToHeel") return "Heel-to-Heel";
    return type[0].toUpperCase() + type.slice(1);
  }

  executeSuccessfulSkillMove(player, defender, type) {
    const direction = signedTeamDirection(player.side);
    if (type === "roulette") {
      const away = normalize(player.x - defender.x, player.y - defender.y);
      const lateralSign = Math.sign(away.y || player.y - FIELD.height / 2 || 1);
      player.y = clamp(player.y + lateralSign * 92, player.radius, FIELD.height - player.radius);
      player.vy += lateralSign * 210;
      this.updateDribbleBall(player);
      return;
    }

    if (type === "nutmeg") {
      const slip = normalize(defender.x - player.x + direction * 42, defender.y - player.y);
      this.ball.x = clamp(defender.x + slip.x * (defender.radius + this.ball.radius + 4), FIELD.ballRadius, FIELD.width - FIELD.ballRadius);
      this.ball.y = clamp(defender.y + slip.y * (defender.radius + this.ball.radius + 4), FIELD.ballRadius, FIELD.height - FIELD.ballRadius);
      this.ball.vx = slip.x * (430 + player.source.speed * 2.1);
      this.ball.vy = slip.y * (430 + player.source.speed * 2.1);
      this.possessionPlayer = null;
      player.hasPossession = false;
      player.state = PLAYER_STATES.SEEK_BALL;
      player.targetX = clamp(this.ball.x + direction * 80, player.radius, FIELD.width - player.radius);
      player.targetY = clamp(this.ball.y, player.radius, FIELD.height - player.radius);
      player.skillMove.timer = 0.34;
      this.lastTouchTeamId = player.teamId;
      this.resetPassStreak(player.teamId);
      return;
    }

    const burst = type === "heelToHeel" ? 340 : 260;
    player.vx += direction * burst;
    player.targetX = clamp(player.x + direction * (type === "heelToHeel" ? 250 : 180), player.radius, FIELD.width - player.radius);
    player.targetY = clamp(player.y, player.radius, FIELD.height - player.radius);
  }

  failSkillMove(player, defender, type) {
    const push = normalize(defender.x - player.x, defender.y - player.y);
    this.ball.x = clamp(player.x + push.x * (player.radius + this.ball.radius + 5), FIELD.ballRadius, FIELD.width - FIELD.ballRadius);
    this.ball.y = clamp(player.y + push.y * (player.radius + this.ball.radius + 5), FIELD.ballRadius, FIELD.height - FIELD.ballRadius);
    this.ball.vx = push.x * (145 + defender.source.defending * 1.4);
    this.ball.vy = push.y * (145 + defender.source.defending * 1.4);
    this.possessionPlayer = null;
    player.hasPossession = false;
    player.skillMove = null;
    player.dribbleElapsed = 0;
    player.dribbleLimit = 0;
    player.state = PLAYER_STATES.SEEK_BALL;
    defender.tackleCooldown = 0.35;
    AudioManager.playTackle();
    this.resetPassStreak();
    this.lastEvent = `${defender.name} reads ${player.name}'s ${this.skillMoveLabel(type)}`;
  }

  setCarrierTarget(player) {
    const direction = signedTeamDirection(player.side);
    const goal = fieldGoalCenter(player.side);
    player.targetX = clamp(player.x + direction * 150, 70, FIELD.width - 70);
    player.targetY = clamp(player.y + (goal.y - player.y) * 0.22, 70, FIELD.height - 70);
  }

  setDribbleTarget(player) {
    const direction = signedTeamDirection(player.side);
    const goal = fieldGoalCenter(player.side);
    const pressure = this.nearestOpponentDistance(player);
    const laneEscape = pressure < 92 ? Math.sign(player.y - FIELD.height / 2 || 1) * 95 : 0;
    const advance = 110 + player.source.speed * 1.7;
    player.targetX = clamp(player.x + direction * advance, 70, FIELD.width - 70);
    player.targetY = clamp(player.y + (goal.y - player.y) * 0.16 + laneEscape, 70, FIELD.height - 70);
  }

  setSupportTarget(player) {
    const direction = signedTeamDirection(player.side);
    const laneBias = (player.homeY - FIELD.height / 2) * 0.2;
    const ballAdvance = direction * clamp((this.ball.x - player.homeX) * direction, 0, 220);
    player.targetX = clamp(player.homeX + direction * 125 + ballAdvance * 0.35, 55, FIELD.width - 55);
    player.targetY = clamp(player.homeY + laneBias * 0.18, 45, FIELD.height - 45);
  }

  setDefensiveTarget(player) {
    const direction = signedTeamDirection(player.side);
    const panic = player.team.runtimeMomentum?.panicUntil > this.gameMinutes;
    const panicScatter = panic ? ((hashString(player.id) % 100) - 50) * 0.9 : 0;
    const dangerX = clamp(this.ball.x - direction * 120, 45, FIELD.width - 45);
    player.targetX = clamp(player.homeX * (panic ? 0.48 : 0.62) + dangerX * (panic ? 0.52 : 0.38), 45, FIELD.width - 45);
    player.targetY = clamp(player.homeY * 0.72 + this.ball.y * 0.28 + panicScatter, 45, FIELD.height - 45);
  }

  setReturnTarget(player) {
    if (isDefender(player)) {
      const lineHeight = teamTactics(player.team).defensiveLineHeight;
      const lineRatio = (lineHeight - 1) / 99;
      const lowBlockX = player.side === "home" ? FIELD.width * 0.11 : FIELD.width * 0.89;
      const highBlockX = player.side === "home" ? FIELD.width * 0.35 : FIELD.width * 0.65;
      const tacticalX = lowBlockX + (highBlockX - lowBlockX) * lineRatio;
      player.targetX = clamp(player.homeX * 0.35 + tacticalX * 0.65, 45, FIELD.width - 45);
    } else {
      player.targetX = player.homeX;
    }
    player.targetY = player.homeY;
  }

  chooseOnBallAction(player) {
    const goal = fieldGoalCenter(player.side);
    const direction = signedTeamDirection(player.side);
    const distanceToGoal = distance(player, goal);
    const attackingProgress = player.side === "home" ? player.x / FIELD.width : 1 - player.x / FIELD.width;
    const shotStat = player.source.shooting / 100;
    const passStat = player.source.passing / 100;
    const passTarget = this.findPassTarget(player);
    const shotChance = clamp(0.1 + shotStat * 0.45 + attackingProgress * 0.36 - distanceToGoal / 1700, 0.08, 0.82);
    if ((player.source.ego ?? 50) > 85 && this.random() < 0.4) {
      this.logger.record({ minute: this.gameMinutes, type: "heroBall", teamId: player.teamId, playerId: player.source.id, text: `${player.name} ignores the obvious pass` });
      if (attackingProgress < 0.72 && this.random() < 0.48) {
        player.dribbleLimit += 0.9;
        player.intentCooldown = 0.45;
        this.lastEvent = `${player.name} tries hero ball`;
        return;
      }
      const target = {
        x: goal.x,
        y: clamp(goal.y + (this.random() - 0.5) * FIELD.goalWidth * 1.15, goal.y - FIELD.goalWidth / 2 + 8, goal.y + FIELD.goalWidth / 2 - 8)
      };
      this.kickBall(player, target, 285 + player.source.shooting * 2.4, "shot");
      return;
    }
    const shouldShoot = !passTarget || this.random() < shotChance;

    if (shouldShoot) {
      const verticalError = (this.random() - 0.5) * (1 - shotStat) * 210;
      const target = { x: goal.x, y: clamp(goal.y + verticalError, goal.y - FIELD.goalWidth / 2 + 8, goal.y + FIELD.goalWidth / 2 - 8) };
      const force = 330 + player.source.shooting * 3.4 + attackingProgress * 80;
      this.kickBall(player, target, force, "shot");
    } else {
      const passError = (this.random() - 0.5) * (1 - passStat) * 74;
      const target = {
        x: passTarget.x + direction * 20,
        y: clamp(passTarget.y + passError, 28, FIELD.height - 28)
      };
      const force = 190 + player.source.passing * 2.2 + distance(player, passTarget) * 0.18;
      this.kickBall(player, target, force, "pass", passTarget);
    }
  }

  findPassTarget(player) {
    const direction = signedTeamDirection(player.side);
    const directness = (teamTactics(player.team).passingStyle - 1) / 99;
    const teammates = this.players
      .filter((candidate) => candidate.teamId === player.teamId && candidate !== player && !isGoalkeeper(candidate))
      .filter((candidate) => (candidate.x - player.x) * direction > -40)
      .sort((a, b) => {
        const score = (candidate) => {
          const passDistance = distance(player, candidate);
          const forwardProgress = (candidate.x - player.x) * direction;
          const fieldProgress = candidate.x * direction;
          const shortPassScore = -passDistance;
          const directPassScore = forwardProgress * 1.8 + fieldProgress * 0.12 - passDistance * 0.22;
          return shortPassScore * (1 - directness) + directPassScore * directness;
        };
        return score(b) - score(a);
      });
    return teammates[0] ?? null;
  }

  kickBall(player, target, force, type, receiver = null) {
    const vector = normalize(target.x - this.ball.x, target.y - this.ball.y);
    this.ball.vx = vector.x * force;
    this.ball.vy = vector.y * force;
    AudioManager.playKick();
    this.lastTouchTeamId = player.teamId;
    this.possessionPlayer = null;
    player.hasPossession = false;
    player.dribbleElapsed = 0;
    player.dribbleLimit = 0;
    this.pendingPass = type === "pass" ? { fromTeamId: player.teamId, receiverId: receiver?.id ?? null } : null;
    if (type === "shot") this.resetPassStreak(player.teamId);
    player.intentCooldown = type === "shot" ? 1.2 : 0.85;
    this.lastEvent =
      type === "shot"
        ? `${player.name} shoots`
        : `${player.name} passes${receiver ? ` to ${receiver.name}` : ""}`;
  }

  updatePlayers(dt) {
    for (const player of this.players) {
      const toTarget = normalize(player.targetX - player.x, player.targetY - player.y);
      const separation = this.playerSeparationVector(player);
      const separationWeight =
        this.possessionPlayer === player
          ? PLAYER_SEPARATION_WEIGHT.carrier
          : player.state === PLAYER_STATES.SEEK_BALL
            ? PLAYER_SEPARATION_WEIGHT.seekBall
            : PLAYER_SEPARATION_WEIGHT.default;
      const steering = normalize(
        toTarget.x + separation.x * separationWeight,
        toTarget.y + separation.y * separationWeight
      );
      const momentumMultiplier = this.teamMomentumMultiplier(player.teamId);
      const skillBurst =
        player.state === PLAYER_STATES.SKILL_MOVE && (player.skillMove?.type === "stepover" || player.skillMove?.type === "heelToHeel")
          ? player.skillMove.type === "heelToHeel"
            ? 2.25
            : 2
          : 1;
      const frozenDrag = player.state === PLAYER_STATES.FROZEN ? 0.08 : 1;
      const maxSpeed = playerMaxSpeed(player) * momentumMultiplier * (skillBurst > 1 ? 1.22 : 1) * frozenDrag;
      const desiredVx = steering.x * maxSpeed;
      const desiredVy = steering.y * maxSpeed;
      const accel = accelerationFor(player) * momentumMultiplier * skillBurst * frozenDrag * dt;
      player.vx += clamp(desiredVx - player.vx, -accel, accel);
      player.vy += clamp(desiredVy - player.vy, -accel, accel);
      player.vx *= 0.985;
      player.vy *= 0.985;

      const currentSpeed = Math.hypot(player.vx, player.vy);
      if (currentSpeed > maxSpeed) {
        player.vx = (player.vx / currentSpeed) * maxSpeed;
        player.vy = (player.vy / currentSpeed) * maxSpeed;
      }

      player.x += player.vx * dt;
      player.y += player.vy * dt;
      player.x = clamp(player.x, player.radius, FIELD.width - player.radius);
      player.y = clamp(player.y, player.radius, FIELD.height - player.radius);

      const exertion = currentSpeed / Math.max(maxSpeed, 1);
      const heatSeekMultiplier = this.weather === "Heat" && player.state === PLAYER_STATES.SEEK_BALL ? 1.75 : 1;
      const dribbleMultiplier = player.state === PLAYER_STATES.DRIBBLING || this.possessionPlayer === player ? 1.2 : 1;
      player.fatigue = clamp(
        player.fatigue - dt * exertion * heatSeekMultiplier * dribbleMultiplier * (0.00055 + (100 - player.source.stamina) * 0.000018),
        0.48,
        1
      );
    }
  }

  playerSeparationVector(player) {
    let sx = 0;
    let sy = 0;
    for (const other of this.players) {
      if (other === player) continue;
      const dx = player.x - other.x;
      const dy = player.y - other.y;
      const desiredDistance = player.radius + other.radius + PLAYER_SEPARATION_BUFFER;
      const actualDistance = Math.hypot(dx, dy);
      if (actualDistance >= desiredDistance) continue;

      const normal = actualDistance > 0.001 ? { x: dx / actualDistance, y: dy / actualDistance } : deterministicNormalForPair(player, other);
      const pressure = (desiredDistance - actualDistance) / desiredDistance;
      sx += normal.x * pressure;
      sy += normal.y * pressure;
    }
    return normalize(sx, sy);
  }

  resolvePlayerCollisions(iterations = 2) {
    for (let pass = 0; pass < iterations; pass += 1) {
      for (let i = 0; i < this.players.length; i += 1) {
        for (let j = i + 1; j < this.players.length; j += 1) {
          const a = this.players[i];
          const b = this.players[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const minDistance = a.radius + b.radius;
          const actualDistance = Math.hypot(dx, dy);
          if (actualDistance >= minDistance) continue;

          const normal = actualDistance > 0.001 ? { x: dx / actualDistance, y: dy / actualDistance } : deterministicNormalForPair(a, b);
          const overlap = minDistance - actualDistance;
          const correction = overlap * 0.5;
          a.x = clamp(a.x - normal.x * correction, a.radius, FIELD.width - a.radius);
          a.y = clamp(a.y - normal.y * correction, a.radius, FIELD.height - a.radius);
          b.x = clamp(b.x + normal.x * correction, b.radius, FIELD.width - b.radius);
          b.y = clamp(b.y + normal.y * correction, b.radius, FIELD.height - b.radius);

          const impact = (a.vx - b.vx) * normal.x + (a.vy - b.vy) * normal.y;
          const shove = clamp(overlap * 7, 18, 70);
          a.vx -= normal.x * shove;
          a.vy -= normal.y * shove;
          b.vx += normal.x * shove;
          b.vy += normal.y * shove;

          if (impact > 0) {
            a.vx -= impact * normal.x * 0.26;
            a.vy -= impact * normal.y * 0.26;
            b.vx += impact * normal.x * 0.26;
            b.vy += impact * normal.y * 0.26;
          }
        }
      }
    }
  }

  resolveTackles(dt) {
    if (!this.possessionPlayer) return;
    const carrier = this.possessionPlayer;
    if (carrier.state === PLAYER_STATES.SKILL_MOVE && carrier.skillMove?.success && carrier.skillMove.timer > 0) return;
    for (const defender of this.players) {
      if (defender.teamId === carrier.teamId || defender.tackleCooldown > 0 || defender.frozenTimer > 0 || defender.state === PLAYER_STATES.FROZEN) continue;
      if (distanceSq(defender, carrier) > tackleRadiusFor(defender) ** 2) continue;

      const defenderQuality = defender.source.defending * 1.35 + defender.source.speed * 0.22;
      const attackerQuality = carrier.source.speed * 1.05 + carrier.source.passing * 0.2 + carrier.source.shooting * 0.15;
      const attemptRate = clamp(0.7 + defender.source.defending / 70, 0.8, 2.25) * dt;
      if (this.random() > attemptRate) continue;

      defender.tackleCooldown = 0.7;

      const foulChance = clamp(0.1 + (carrier.source.speed - defender.source.defending) * 0.0012, 0.1, 0.16);
      if (this.random() < foulChance) {
        this.awardFoul(defender, carrier);
        break;
      }

      const successRate = clamp(0.42 + (defenderQuality - attackerQuality) / 170, 0.18, 0.82);
      if (this.random() < successRate) {
        const push = normalize(this.ball.x - defender.x, this.ball.y - defender.y);
        this.ball.vx = push.x * (150 + defender.source.defending * 1.8);
        this.ball.vy = push.y * (150 + defender.source.defending * 1.8);
        AudioManager.playTackle();
        this.possessionPlayer = null;
        carrier.hasPossession = false;
        carrier.dribbleElapsed = 0;
        carrier.dribbleLimit = 0;
        this.resetPassStreak();
        this.lastEvent = `${defender.name} tackles`;
        break;
      }
    }
  }

  updatePossession() {
    if (this.possessionPlayer) {
      const carrier = this.possessionPlayer;
      this.updateDribbleBall(carrier);
      this.lastTouchTeamId = carrier.teamId;
      return;
    }

    const ballSpeed = Math.hypot(this.ball.vx, this.ball.vy);
    const closest = this.closestPlayerToBall();
    if (!closest) return;
    const controlRadius = FIELD.playerRadius + FIELD.ballRadius + 6 + closest.source.passing * 0.03;
    if (distance(closest, this.ball) <= controlRadius && ballSpeed < 165 + closest.source.passing) {
      this.givePossession(closest, `${closest.name} controls`);
    }
  }

  givePossession(player, eventText = `${player.name} controls`) {
    this.resolvePassStreakOnPossession(player);
    this.possessionPlayer = player;
    this.lastTouchTeamId = player.teamId;
    player.hasPossession = true;
    player.state = PLAYER_STATES.DRIBBLING;
    player.skillMove = null;
    player.dribbleElapsed = 0;
    player.dribbleLimit = clamp(0.55 + player.source.speed * 0.011 + (100 - player.source.passing) * 0.008, 0.65, 2.15);
    player.intentCooldown = Math.max(player.intentCooldown, 0.25);
    this.lastEvent = eventText;
  }

  resolvePassStreakOnPossession(player) {
    if (!this.pendingPass) return;
    if (this.pendingPass.fromTeamId === player.teamId) {
      const count = (this.passStreaks.get(player.teamId) ?? 0) + 1;
      this.passStreaks.set(player.teamId, count);
      if (count > 0 && count % 10 === 0) this.applyMomentum(player.teamId, "positive", 5, `${player.team.name} complete 10 passes`);
    } else {
      this.resetPassStreak(this.pendingPass.fromTeamId);
    }
    this.pendingPass = null;
  }

  resetPassStreak(teamId = null) {
    if (teamId) this.passStreaks.set(teamId, 0);
    else for (const key of this.passStreaks.keys()) this.passStreaks.set(key, 0);
  }

  updateDribbleBall(carrier) {
    const goal = fieldGoalCenter(carrier.side);
    const forward = normalize(goal.x - carrier.x, goal.y - carrier.y);
    const footGap = carrier.radius + this.ball.radius + 9;
    const targetX = carrier.x + forward.x * footGap;
    const targetY = carrier.y + forward.y * footGap;
    this.ball.x += (targetX - this.ball.x) * 0.48;
    this.ball.y += (targetY - this.ball.y) * 0.48;
    this.ball.vx = carrier.vx * 0.92 + (targetX - this.ball.x) * 5.2;
    this.ball.vy = carrier.vy * 0.92 + (targetY - this.ball.y) * 5.2;
  }

  updateBall(dt) {
    if (this.possessionPlayer) return;
    const speed = Math.hypot(this.ball.vx, this.ball.vy);
    const substeps = clamp(Math.ceil(speed / 130), 1, 8);
    const step = dt / substeps;
    for (let i = 0; i < substeps; i += 1) {
      this.ball.x += this.ball.vx * step;
      this.ball.y += this.ball.vy * step;
      const friction = this.weather === "Rain" ? 1.75 * 0.7 : 1.75;
      this.ball.vx *= 1 - Math.min(0.98, friction * step);
      this.ball.vy *= 1 - Math.min(0.98, friction * step);
      if (Math.hypot(this.ball.vx, this.ball.vy) < 4) {
        this.ball.vx = 0;
        this.ball.vy = 0;
      }

      this.resolveBallPlayerCollision();
      if (this.checkGoal()) break;
      if (this.checkBallOutOfPlay()) break;
    }
  }

  resolveBallPlayerCollision() {
    for (const player of this.players) {
      const dx = this.ball.x - player.x;
      const dy = this.ball.y - player.y;
      const minDistance = this.ball.radius + player.radius;
      const actualDistance = Math.hypot(dx, dy) || 0.001;
      if (actualDistance >= minDistance) continue;
      const nx = dx / actualDistance;
      const ny = dy / actualDistance;
      const overlap = minDistance - actualDistance;
      this.ball.x += nx * overlap;
      this.ball.y += ny * overlap;
      const relativeSpeed = (this.ball.vx - player.vx) * nx + (this.ball.vy - player.vy) * ny;
      this.ball.vx -= relativeSpeed * nx * 1.15;
      this.ball.vy -= relativeSpeed * ny * 1.15;
      this.ball.vx += player.vx * 0.38 + nx * 22;
      this.ball.vy += player.vy * 0.38 + ny * 22;
      this.lastTouchTeamId = player.teamId;
    }
  }

  checkGoal() {
    if (!isInGoalMouth(this.ball.y)) return false;
    if (this.ball.x > FIELD.width + this.ball.radius) {
      const wasDrawOrBehind = this.score.home <= this.score.away;
      this.score.home += 1;
      this.lastEvent = `${this.homeTeam.name} goal`;
      this.logGoal(this.homeTeam, this.awayTeam, wasDrawOrBehind);
      this.resetAfterGoal("away");
      return true;
    }
    if (this.ball.x < -this.ball.radius) {
      const wasDrawOrBehind = this.score.away <= this.score.home;
      this.score.away += 1;
      this.lastEvent = `${this.awayTeam.name} goal`;
      this.logGoal(this.awayTeam, this.homeTeam, wasDrawOrBehind);
      this.resetAfterGoal("home");
      return true;
    }
    return false;
  }

  logGoal(scoringTeam, concedingTeam, leadChange) {
    this.resetPassStreak();
    AudioManager.playGoalCheer();
    this.emitVisualEvent("goal", { teamId: scoringTeam.id, x: this.ball.x, y: this.ball.y });
    this.applyMomentum(scoringTeam.id, "positive", 8, `${scoringTeam.name} surge after scoring`);
    this.applyMomentum(concedingTeam.id, "panic", 6, `${concedingTeam.name} wobble after conceding`);
    this.logger.record({ minute: this.gameMinutes, type: "goal", teamId: scoringTeam.id, text: `${scoringTeam.name} score` });
    if (leadChange) this.logger.record({ minute: this.gameMinutes, type: "leadChange", teamId: scoringTeam.id, text: `${scoringTeam.name} seize control` });
  }

  checkBallOutOfPlay() {
    const outTop = this.ball.y < -this.ball.radius;
    const outBottom = this.ball.y > FIELD.height + this.ball.radius;
    const outLeft = this.ball.x < -this.ball.radius;
    const outRight = this.ball.x > FIELD.width + this.ball.radius;
    if (!outTop && !outBottom && !outLeft && !outRight) return false;

    if (outTop || outBottom) {
      const restartTeam = this.opponentTeamFor(this.lastTouchTeamId) ?? (this.ball.x < FIELD.width / 2 ? this.awayTeam : this.homeTeam);
      this.triggerSetPiece({
        type: SET_PIECE_TYPES.THROW_IN,
        restartTeamId: restartTeam.id,
        x: clamp(this.ball.x, 70, FIELD.width - 70),
        y: outTop ? FIELD.ballRadius : FIELD.height - FIELD.ballRadius,
        reason: `${restartTeam.name} throw-in`
      });
      return true;
    }

    const crossedRightEndline = outRight;
    const attackingTeam = crossedRightEndline ? this.homeTeam : this.awayTeam;
    const defendingTeam = crossedRightEndline ? this.awayTeam : this.homeTeam;
    const lastTouchTeamId = this.lastTouchTeamId;
    const cornerY = this.ball.y < FIELD.height / 2 ? FIELD.ballRadius : FIELD.height - FIELD.ballRadius;

    if (lastTouchTeamId === defendingTeam.id) {
      this.triggerSetPiece({
        type: SET_PIECE_TYPES.CORNER_KICK,
        restartTeamId: attackingTeam.id,
        x: crossedRightEndline ? FIELD.width - FIELD.ballRadius : FIELD.ballRadius,
        y: cornerY,
        reason: `${attackingTeam.name} corner`
      });
    } else {
      this.triggerSetPiece({
        type: SET_PIECE_TYPES.GOAL_KICK,
        restartTeamId: defendingTeam.id,
        x: crossedRightEndline ? FIELD.width - FIELD.goalBoxWidth * 0.55 : FIELD.goalBoxWidth * 0.55,
        y: FIELD.height / 2,
        reason: `${defendingTeam.name} goal kick`
      });
    }
    return true;
  }

  updateStoppage(dt) {
    this.phaseTimer += dt;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.updatePlayers(dt * 0.72);
    this.resolvePlayerCollisions();
    if (this.phaseTimer >= SET_PIECE_STOPPAGE_SECONDS) {
      this.matchPhase = MATCH_PHASES.SET_PIECE;
      this.phaseTimer = 0;
      this.prepareSetPieceTargets();
    }
  }

  updateSetPiece(dt) {
    this.phaseTimer += dt;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.updatePlayers(dt * 0.78);
    this.resolvePlayerCollisions();
    if (this.phaseTimer >= SET_PIECE_SETUP_SECONDS || this.playersReadyForSetPiece()) {
      this.executeSetPiece();
    }
  }

  triggerSetPiece({ type, restartTeamId, x, y, reason }) {
    const restartTeam = this.teamFor(restartTeamId);
    const defendingTeam = this.opponentTeamFor(restartTeamId);
    const spot = clampPointToField(x, y, FIELD.ballRadius);
    this.matchPhase = MATCH_PHASES.STOPPAGE;
    this.phaseTimer = 0;
    this.possessionPlayer = null;
    this.resetPassStreak();
    for (const player of this.players) {
      player.hasPossession = false;
      player.dribbleElapsed = 0;
      player.dribbleLimit = 0;
    }
    this.ball.x = spot.x;
    this.ball.y = spot.y;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.setPiece = {
      type,
      restartTeamId,
      defendingTeamId: defendingTeam?.id ?? null,
      x: spot.x,
      y: spot.y,
      takerId: null
    };
    this.lastEvent = reason ?? `${restartTeam?.name ?? "Team"} set piece`;
    this.prepareSetPieceTargets();
  }

  awardFoul(defender, carrier) {
    const foulX = clamp((defender.x + carrier.x) / 2, FIELD.ballRadius, FIELD.width - FIELD.ballRadius);
    const foulY = clamp((defender.y + carrier.y) / 2, FIELD.ballRadius, FIELD.height - FIELD.ballRadius);
    const inPenaltyArea = isInsidePenaltyAreaForSide(foulX, foulY, defender.side);
    const restartX = inPenaltyArea
      ? defender.side === "home"
        ? FIELD.penaltyBoxWidth * 0.65
        : FIELD.width - FIELD.penaltyBoxWidth * 0.65
      : foulX;
    const restartY = inPenaltyArea ? FIELD.height / 2 : foulY;
    this.resetPassStreak();
    AudioManager.playWhistle();
    const cardRoll = this.random();
    const card = cardRoll < 0.03 ? "red" : cardRoll < 0.21 ? "yellow" : null;
    this.logger.record({
      minute: this.gameMinutes,
      type: "foul",
      teamId: defender.teamId,
      playerId: defender.source.id,
      text: inPenaltyArea ? `${defender.name} concedes a penalty` : `${defender.name} fouls ${carrier.name}`,
      metadata: { fouledPlayerId: carrier.source.id, inPenaltyArea }
    });
    if (card) {
      this.logger.record({
        minute: this.gameMinutes,
        type: "card",
        teamId: defender.teamId,
        playerId: defender.source.id,
        text: `${defender.name} sees ${card}`,
        metadata: { card }
      });
    }
    if (inPenaltyArea) this.applyMomentum(defender.teamId, "panic", 7, `${defender.team.name} panic after box foul`);
    this.triggerSetPiece({
      type: inPenaltyArea ? SET_PIECE_TYPES.PENALTY_KICK : SET_PIECE_TYPES.DIRECT_FREE_KICK,
      restartTeamId: carrier.teamId,
      x: restartX,
      y: restartY,
      reason: inPenaltyArea ? `${defender.name} foul: penalty` : `${defender.name} foul: free kick`
    });
  }

  prepareSetPieceTargets() {
    if (!this.setPiece) return;
    const restartTeam = this.teamFor(this.setPiece.restartTeamId);
    const defendingTeam = this.teamFor(this.setPiece.defendingTeamId);
    const restartSide = this.sideForTeam(restartTeam?.id);
    const direction = signedTeamDirection(restartSide);
    const restartPlayers = this.playersForTeam(restartTeam?.id);
    const defendingPlayers = this.playersForTeam(defendingTeam?.id);
    const taker = this.selectSetPieceTaker(restartPlayers, this.setPiece.type);
    if (taker) {
      this.setPiece.takerId = taker.id;
      taker.targetX = clamp(this.setPiece.x - direction * 28, taker.radius, FIELD.width - taker.radius);
      taker.targetY = clamp(this.setPiece.y, taker.radius, FIELD.height - taker.radius);
      if (this.setPiece.type === SET_PIECE_TYPES.CORNER_KICK) {
        taker.vx = 0;
        taker.vy = 0;
      }
    }

    if (this.setPiece.type === SET_PIECE_TYPES.PENALTY_KICK) {
      this.positionPenaltySetPiece(taker, restartPlayers, defendingPlayers);
      return;
    }

    if (this.setPiece.type === SET_PIECE_TYPES.DIRECT_FREE_KICK) {
      this.positionFreeKickWall(defendingPlayers);
    }

    if (this.setPiece.type === SET_PIECE_TYPES.CORNER_KICK) {
      this.positionCornerSetPiece(taker, restartPlayers, defendingPlayers, direction);
      return;
    }

    if (this.setPiece.type === SET_PIECE_TYPES.GOAL_KICK) {
      this.positionGoalKickSetPiece(taker, restartPlayers, defendingPlayers, direction);
      return;
    }

    this.positionRestartShape(taker, restartPlayers, defendingPlayers, direction);
  }

  positionRestartShape(taker, restartPlayers, defendingPlayers, direction) {
    const lanes = [0.18, 0.32, 0.46, 0.6, 0.74, 0.86, 0.26, 0.54, 0.78, 0.4];
    restartPlayers
      .filter((player) => player !== taker)
      .forEach((player, index) => {
        player.targetX = clamp(this.setPiece.x + direction * (130 + (index % 4) * 80), player.radius, FIELD.width - player.radius);
        player.targetY = clamp(FIELD.height * lanes[index % lanes.length], player.radius, FIELD.height - player.radius);
      });
    defendingPlayers.forEach((player, index) => {
      player.targetX = clamp(this.setPiece.x - direction * (105 + (index % 4) * 55), player.radius, FIELD.width - player.radius);
      player.targetY = clamp(FIELD.height * lanes[(index + 3) % lanes.length], player.radius, FIELD.height - player.radius);
    });
  }

  positionCornerSetPiece(taker, restartPlayers, defendingPlayers, direction) {
    const boxX = direction === 1 ? FIELD.width - FIELD.penaltyBoxWidth * 0.45 : FIELD.penaltyBoxWidth * 0.45;
    const yards = [-0.32, -0.18, -0.06, 0.08, 0.2, 0.32];
    restartPlayers
      .filter((player) => player !== taker)
      .forEach((player, index) => {
        player.targetX = clamp(boxX - direction * ((index % 3) * 42), player.radius, FIELD.width - player.radius);
        player.targetY = clamp(FIELD.height / 2 + yards[index % yards.length] * FIELD.penaltyBoxHeight, player.radius, FIELD.height - player.radius);
      });
    defendingPlayers.forEach((player, index) => {
      player.targetX = clamp(boxX - direction * (42 + (index % 4) * 38), player.radius, FIELD.width - player.radius);
      player.targetY = clamp(FIELD.height / 2 + yards[(index + 2) % yards.length] * FIELD.penaltyBoxHeight, player.radius, FIELD.height - player.radius);
    });
  }

  positionGoalKickSetPiece(taker, restartPlayers, defendingPlayers, direction) {
    restartPlayers
      .filter((player) => player !== taker)
      .forEach((player, index) => {
        player.targetX = clamp(player.homeX + direction * (120 + (index % 3) * 70), player.radius, FIELD.width - player.radius);
        player.targetY = clamp(player.homeY, player.radius, FIELD.height - player.radius);
      });
    defendingPlayers.forEach((player) => {
      player.targetX = clamp(player.homeX + direction * 180, player.radius, FIELD.width - player.radius);
      player.targetY = clamp(player.homeY, player.radius, FIELD.height - player.radius);
    });
  }

  positionPenaltySetPiece(taker, restartPlayers, defendingPlayers) {
    const defendingSide = this.sideForTeam(this.setPiece.defendingTeamId);
    const keeper = defendingPlayers.find((player) => isGoalkeeper(player));
    if (taker) {
      taker.targetX = this.setPiece.x;
      taker.targetY = this.setPiece.y + 38;
    }
    if (keeper) {
      keeper.targetX = defendingSide === "home" ? FIELD.playerRadius + 8 : FIELD.width - FIELD.playerRadius - 8;
      keeper.targetY = FIELD.height / 2;
    }
    [...restartPlayers, ...defendingPlayers]
      .filter((player) => player !== taker && player !== keeper)
      .forEach((player, index) => {
        const side = index % 2 === 0 ? -1 : 1;
        player.targetX = clamp(FIELD.width / 2 + side * (80 + (index % 4) * 38), player.radius, FIELD.width - player.radius);
        player.targetY = clamp(FIELD.height / 2 + side * (140 + (index % 5) * 16), player.radius, FIELD.height - player.radius);
      });
  }

  positionFreeKickWall(defendingPlayers) {
    const defendingSide = this.sideForTeam(this.setPiece.defendingTeamId);
    const goal = { x: ownGoalX(defendingSide), y: FIELD.height / 2 };
    const wallVector = normalize(goal.x - this.setPiece.x, goal.y - this.setPiece.y);
    const wallCenter = {
      x: clamp(this.setPiece.x + wallVector.x * VIRTUAL_TEN_YARDS, 50, FIELD.width - 50),
      y: clamp(this.setPiece.y + wallVector.y * VIRTUAL_TEN_YARDS, 50, FIELD.height - 50)
    };
    const wallPlayers = defendingPlayers
      .filter((player) => !isGoalkeeper(player))
      .sort((a, b) => distanceSq(a, this.ball) - distanceSq(b, this.ball))
      .slice(0, 4);
    wallPlayers.forEach((player, index) => {
      player.targetX = clamp(wallCenter.x, player.radius, FIELD.width - player.radius);
      player.targetY = clamp(wallCenter.y + (index - 1.5) * (player.radius * 2.3), player.radius, FIELD.height - player.radius);
    });
  }

  executeSetPiece() {
    if (!this.setPiece) return;
    const restartTeam = this.teamFor(this.setPiece.restartTeamId);
    const taker = this.players.find((player) => player.id === this.setPiece.takerId) ?? this.selectSetPieceTaker(this.playersForTeam(restartTeam?.id), this.setPiece.type);
    if (!taker) {
      this.matchPhase = MATCH_PHASES.OPEN_PLAY;
      this.setPiece = null;
      return;
    }

    const setPiece = this.setPiece;
    const direction = signedTeamDirection(taker.side);
    this.matchPhase = MATCH_PHASES.OPEN_PLAY;
    this.phaseTimer = 0;
    this.setPiece = null;

    if (setPiece.type === SET_PIECE_TYPES.PENALTY_KICK) {
      const goal = fieldGoalCenter(taker.side);
      const target = { x: goal.x, y: goal.y + (this.random() - 0.5) * FIELD.goalWidth * 0.54 };
      this.kickBall(taker, target, 520 + taker.source.shooting * 3.2, "shot");
      this.lastEvent = `${taker.name} penalty`;
      return;
    }

    if (setPiece.type === SET_PIECE_TYPES.CORNER_KICK) {
      taker.vx = 0;
      taker.vy = 0;
      this.ball.x = setPiece.x;
      this.ball.y = setPiece.y;
      this.ball.vx = 0;
      this.ball.vy = 0;
      const target = {
        x: clamp(direction === 1 ? FIELD.width - FIELD.penaltyBoxWidth * 0.42 : FIELD.penaltyBoxWidth * 0.42, FIELD.ballRadius, FIELD.width - FIELD.ballRadius),
        y: clamp(FIELD.height / 2 + (this.random() - 0.5) * FIELD.goalWidth, FIELD.ballRadius, FIELD.height - FIELD.ballRadius)
      };
      this.kickBall(taker, target, 310 + taker.source.passing * 2.1, "pass");
      this.lastEvent = `${taker.name} corner`;
      return;
    }

    const attackingProgress = taker.side === "home" ? setPiece.x / FIELD.width : 1 - setPiece.x / FIELD.width;
    if (setPiece.type === SET_PIECE_TYPES.DIRECT_FREE_KICK && attackingProgress > 0.72 && this.random() < 0.45 + taker.source.shooting / 220) {
      this.kickBall(taker, fieldGoalCenter(taker.side), 430 + taker.source.shooting * 2.6, "shot");
      this.lastEvent = `${taker.name} free kick`;
      return;
    }

    const target = this.findSetPiecePassTarget(taker) ?? {
      x: clamp(setPiece.x + direction * 260, FIELD.ballRadius, FIELD.width - FIELD.ballRadius),
      y: clamp(setPiece.y + (this.random() - 0.5) * 180, FIELD.ballRadius, FIELD.height - FIELD.ballRadius)
    };
    this.kickBall(taker, target, setPiece.type === SET_PIECE_TYPES.THROW_IN ? 170 : 270 + taker.source.passing * 1.8, "pass");
    this.lastEvent =
      setPiece.type === SET_PIECE_TYPES.THROW_IN
        ? `${taker.name} throw-in`
        : setPiece.type === SET_PIECE_TYPES.GOAL_KICK
          ? `${taker.name} goal kick`
          : `${taker.name} restarts`;
  }

  playersReadyForSetPiece() {
    return this.players.every((player) => distance(player, { x: player.targetX, y: player.targetY }) < 52);
  }

  selectSetPieceTaker(players, type) {
    const candidates = type === SET_PIECE_TYPES.GOAL_KICK ? players : players.filter((player) => !isGoalkeeper(player));
    return [...candidates].sort((a, b) => distanceSq(a, this.ball) - distanceSq(b, this.ball))[0] ?? null;
  }

  findSetPiecePassTarget(taker) {
    const direction = signedTeamDirection(taker.side);
    return this.players
      .filter((player) => player.teamId === taker.teamId && player !== taker && !isGoalkeeper(player))
      .sort((a, b) => {
        const aProgress = (a.x - this.ball.x) * direction;
        const bProgress = (b.x - this.ball.x) * direction;
        return bProgress - aProgress + distance(this.ball, a) * 0.03 - distance(this.ball, b) * 0.03;
      })[0] ?? null;
  }

  resetAfterGoal(kickoffSide) {
    this.matchPhase = MATCH_PHASES.OPEN_PLAY;
    this.phaseTimer = 0;
    this.setPiece = null;
    this.ball.x = FIELD.width / 2;
    this.ball.y = FIELD.height / 2;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.possessionPlayer = null;
    kickoffPlayers(this.players, this.score.home, this.score.away);
    const kickoffPlayer = this.players.find((player) => player.side === kickoffSide && isStriker(player));
    if (kickoffPlayer) this.givePossession(kickoffPlayer, `${kickoffPlayer.name} restarts`);
  }

  pressersByTeam() {
    const pressers = new Map();
    for (const team of [this.homeTeam, this.awayTeam]) {
      const teamPlayers = this.players
        .filter((player) => player.teamId === team.id && !isGoalkeeper(player))
        .sort((a, b) => distanceSq(a, this.ball) - distanceSq(b, this.ball));
      pressers.set(team.id, new Set(teamPlayers.slice(0, pressCountFor(team))));
    }
    return pressers;
  }

  teamFor(teamId) {
    if (teamId === this.homeTeam.id) return this.homeTeam;
    if (teamId === this.awayTeam.id) return this.awayTeam;
    return null;
  }

  opponentTeamFor(teamId) {
    if (teamId === this.homeTeam.id) return this.awayTeam;
    if (teamId === this.awayTeam.id) return this.homeTeam;
    return null;
  }

  sideForTeam(teamId) {
    if (teamId === this.homeTeam.id) return "home";
    if (teamId === this.awayTeam.id) return "away";
    return "home";
  }

  playersForTeam(teamId) {
    return this.players.filter((player) => player.teamId === teamId);
  }

  teamMomentumMultiplier(teamId) {
    const team = this.teamFor(teamId);
    if (!team?.runtimeMomentum) return 1;
    const minute = this.gameMinutes;
    let multiplier = 1;
    if (team.runtimeMomentum.positiveUntil > minute) multiplier += 0.06;
    if (team.runtimeMomentum.panicUntil > minute) multiplier -= 0.025;
    return multiplier;
  }

  applyMomentum(teamId, type, durationMinutes, text) {
    const team = this.teamFor(teamId);
    if (!team?.runtimeMomentum) return;
    if (type === "positive") team.runtimeMomentum.positiveUntil = Math.max(team.runtimeMomentum.positiveUntil, this.gameMinutes + durationMinutes);
    if (type === "panic") team.runtimeMomentum.panicUntil = Math.max(team.runtimeMomentum.panicUntil, this.gameMinutes + durationMinutes);
    this.logger.record({ minute: this.gameMinutes, type: type === "positive" ? "momentum" : "panic", teamId, text });
  }

  emitVisualEvent(type, payload = {}) {
    this.visualEvents.push({
      id: this.nextVisualEventId,
      minute: this.gameMinutes,
      type,
      ...payload
    });
    this.nextVisualEventId += 1;
    if (this.visualEvents.length > MAX_VISUAL_EVENTS) {
      this.visualEvents.splice(0, this.visualEvents.length - MAX_VISUAL_EVENTS);
    }
  }

  nearestOpponentDistance(player) {
    return this.players.reduce((best, candidate) => {
      if (candidate.teamId === player.teamId) return best;
      return Math.min(best, distance(player, candidate));
    }, Number.POSITIVE_INFINITY);
  }

  closestPlayerToBall() {
    return this.players.reduce((best, player) => {
      if (!best) return player;
      return distanceSq(player, this.ball) < distanceSq(best, this.ball) ? player : best;
    }, null);
  }

  finishMatch() {
    if (this.complete) return;
    this.complete = true;
    const result = {
      home: this.score.home,
      away: this.score.away,
      decidedBy: null,
      winnerId: null,
      weather: this.weather,
      events: this.logger.events,
      participation: this.players.map((player) => ({ playerId: player.source.id, teamId: player.teamId, minutes: Math.round(this.gameMinutes) })),
      tacticSnapshot: null,
      summary: ""
    };

    if (result.home > result.away) result.winnerId = this.homeTeam.id;
    if (result.away > result.home) result.winnerId = this.awayTeam.id;

    if (this.match.stage !== STAGES.GROUP) {
      if (result.home === result.away) {
        const homeQuality = this.homeTeam.strength + this.homeTeam.players.reduce((sum, player) => sum + player.shooting, 0) / 11;
        const awayQuality = this.awayTeam.strength + this.awayTeam.players.reduce((sum, player) => sum + player.shooting, 0) / 11;
        const homeChance = clamp(homeQuality / (homeQuality + awayQuality), 0.38, 0.62);
        result.decidedBy = "penalties";
        result.winnerId = this.random() < homeChance ? this.homeTeam.id : this.awayTeam.id;
        this.logger.record({ minute: this.gameMinutes, type: "decision", teamId: result.winnerId, text: `${this.teamFor(result.winnerId).name} win on penalties` });
      }
    }

    result.events = this.logger.events;
    result.tacticSnapshot = result.winnerId ? { ...teamTactics(this.teamFor(result.winnerId)) } : null;
    result.cardEvents = result.events.filter((event) => event.type === "card");
    result.foulEvents = result.events.filter((event) => event.type === "foul");
    result.summary = this.logger.formatSummary({
      homeTeam: this.homeTeam,
      awayTeam: this.awayTeam,
      score: this.score,
      weather: this.weather
    });
    this.result = result;
    this.onComplete(result);
  }

  getSnapshot() {
    return {
      field: FIELD,
      match: this.match,
      homeTeam: this.homeTeam,
      awayTeam: this.awayTeam,
      players: this.players,
      ball: this.ball,
      score: this.score,
      gameMinutes: this.gameMinutes,
      paused: this.paused,
      complete: this.complete,
      weather: this.weather,
      momentum: {
        home: this.homeTeam.runtimeMomentum,
        away: this.awayTeam.runtimeMomentum
      },
      matchPhase: this.matchPhase,
      setPiece: this.setPiece,
      visualEvents: this.visualEvents,
      possessionPlayerId: this.possessionPlayer?.id ?? null,
      lastTouchTeamId: this.lastTouchTeamId,
      lastEvent: this.lastEvent,
      leftGoalX: ownGoalX("home"),
      rightGoalX: ownGoalX("away")
    };
  }
}
