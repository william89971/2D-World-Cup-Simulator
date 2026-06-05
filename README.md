# World Cup 2026 2D Futbol Simulator

Static HTML5 Canvas game built with vanilla JavaScript modules.

## Architecture Outline

- `src/data/teams.js`: 48 confirmed 2026 World Cup teams, official-style groups A-L, jersey colors, strengths, and generated 11-player lineups with `speed`, `shooting`, `passing`, `defending`, and `stamina`.
- `src/core/utils.js`: deterministic seeded random helpers and math primitives.
- `src/core/constants.js`: pitch dimensions, match timing, and player AI state names.
- `src/match/MatchSimulator.js`: instant result model for non-watched matches.
- `src/tournament/TournamentManager.js`: group tables, 72 group matches, best third-place ranking, 32-team knockout bracket, and champion resolution.
- `src/match/MatchEngine.js`: autonomous 22-player top-down match engine with physics, possession, player state machines, passing, shooting, tackling, fatigue, and goal detection.
- `src/render/CanvasRenderer.js`: soccer pitch, goals, players, labels, ball, and possession rendering.
- `src/ui/App.js`: team selection, tournament hub, standings, bracket, match screen, scoreboard, timer, and play/pause.

## grSim-Informed Choices

The implementation borrows architecture lessons from RoboCup SSL grSim without copying its GPL C++/Qt/ODE code:

- Simulation state is separate from Canvas rendering.
- The ball uses speed-based substeps so hard shots do not skip collision checks.
- Player AI produces intentions such as move, pass, shoot, and tackle; physics resolves movement and contact.
- Pitch geometry is rendered from shared field constants instead of one-off drawing values.

## Run

```bash
npm run dev
```

Then open `http://localhost:5180`.

## Test

```bash
npm test
```
