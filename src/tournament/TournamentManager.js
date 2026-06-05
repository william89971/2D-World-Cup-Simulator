import { GROUPS, TEAMS } from "../data/teams.js";
import { TournamentState } from "./TournamentState.js";

export class TournamentManager extends TournamentState {
  constructor({ teams = TEAMS, groups = GROUPS } = {}) {
    super({ teams, groups });
  }
}

export { TournamentState, TournamentMemory } from "./TournamentState.js";
