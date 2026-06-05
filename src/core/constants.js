export const FIELD = Object.freeze({
  width: 2000,
  height: 1000,
  playerRadius: 15,
  ballRadius: 7,
  goalDepth: 70,
  goalWidth: 220,
  penaltyBoxWidth: 330,
  penaltyBoxHeight: 440,
  goalBoxWidth: 120,
  goalBoxHeight: 260,
  centerCircleRadius: 135
});

export const MATCH = Object.freeze({
  gameMinutes: 90,
  realSeconds: 180,
  maxDeltaSeconds: 1 / 24
});

export const PIXEL_RENDERER = Object.freeze({
  colors: {
    void: "#07120d",
    standDark: "#101820",
    grassDark: "#20863f",
    grassLight: "#2fa451",
    grassShadow: "#176b33",
    chalk: "#f8fff2",
    black: "#080808",
    ballWhite: "#f8f8f0",
    ballShade: "#c9d2c8",
    trail: "#ffffff",
    hud: "#11151f",
    hudAccent: "#f7d51d"
  },
  lineWidth: 2,
  stripeWidth: 70,
  playerPixel: 4,
  ballPixel: 3,
  trailSpeed: 250,
  trailParticles: 5,
  wobbleIntervalMs: 140
});

export const PLAYER_STATES = Object.freeze({
  SEEK_BALL: "SEEK_BALL",
  RETURN_TO_POSITION: "RETURN_TO_POSITION",
  ATTACK: "ATTACK",
  DRIBBLING: "DRIBBLING",
  SKILL_MOVE: "SKILL_MOVE",
  FROZEN: "FROZEN",
  DEFEND: "DEFEND"
});

export const MATCH_PHASES = Object.freeze({
  OPEN_PLAY: "OPEN_PLAY",
  STOPPAGE: "STOPPAGE",
  SET_PIECE: "SET_PIECE"
});

export const STAGES = Object.freeze({
  GROUP: "GROUP",
  KNOCKOUT: "KNOCKOUT",
  COMPLETE: "COMPLETE"
});

export const KNOCKOUT_ROUNDS = Object.freeze([
  { key: "R32", label: "Round of 32", next: "R16" },
  { key: "R16", label: "Round of 16", next: "QF" },
  { key: "QF", label: "Quarterfinals", next: "SF" },
  { key: "SF", label: "Semifinals", next: "F" },
  { key: "F", label: "Final", next: null }
]);

export const FORMATION = Object.freeze([
  { position: "GK", x: 0.075, y: 0.5 },
  { position: "RB", x: 0.2, y: 0.19 },
  { position: "CB", x: 0.18, y: 0.38 },
  { position: "CB", x: 0.18, y: 0.62 },
  { position: "LB", x: 0.2, y: 0.81 },
  { position: "DM", x: 0.36, y: 0.5 },
  { position: "CM", x: 0.43, y: 0.31 },
  { position: "CM", x: 0.43, y: 0.69 },
  { position: "RW", x: 0.62, y: 0.22 },
  { position: "ST", x: 0.68, y: 0.5 },
  { position: "LW", x: 0.62, y: 0.78 }
]);

export const FORMATIONS = Object.freeze({
  "4-3-3": FORMATION,
  "4-4-2": Object.freeze([
    { position: "GK", x: 0.075, y: 0.5 },
    { position: "RB", x: 0.2, y: 0.18 },
    { position: "CB", x: 0.18, y: 0.39 },
    { position: "CB", x: 0.18, y: 0.61 },
    { position: "LB", x: 0.2, y: 0.82 },
    { position: "RM", x: 0.43, y: 0.2 },
    { position: "CM", x: 0.4, y: 0.4 },
    { position: "CM", x: 0.4, y: 0.6 },
    { position: "LM", x: 0.43, y: 0.8 },
    { position: "ST", x: 0.66, y: 0.42 },
    { position: "ST", x: 0.66, y: 0.58 }
  ]),
  "3-5-2": Object.freeze([
    { position: "GK", x: 0.075, y: 0.5 },
    { position: "CB", x: 0.18, y: 0.32 },
    { position: "CB", x: 0.16, y: 0.5 },
    { position: "CB", x: 0.18, y: 0.68 },
    { position: "RWB", x: 0.38, y: 0.14 },
    { position: "CM", x: 0.36, y: 0.36 },
    { position: "DM", x: 0.34, y: 0.5 },
    { position: "CM", x: 0.36, y: 0.64 },
    { position: "LWB", x: 0.38, y: 0.86 },
    { position: "ST", x: 0.66, y: 0.42 },
    { position: "ST", x: 0.66, y: 0.58 }
  ])
});
