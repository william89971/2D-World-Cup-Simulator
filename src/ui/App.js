import { FORMATIONS, MATCH } from "../core/constants.js";
import { compactTeamName, escapeHtml, formatClock } from "../core/utils.js";
import { flagUrl, loadWorldCupData } from "../data/loadWorldCupData.js";
import { MatchEngine } from "../match/MatchEngine.js";
import { ThreeJsRenderer } from "../render/ThreeJsRenderer.js";
import { TournamentState, selectKnockoutTeams } from "../tournament/TournamentState.js?v=setupDynamic";

function resultText(match) {
  if (!match?.result) return "vs";
  const suffix = match.result.decidedBy ? ` (${match.result.decidedBy})` : "";
  return `${match.result.home}-${match.result.away}${suffix}`;
}

function statBar(value) {
  return `<span class="stat-bar"><span style="width:${value}%"></span></span>`;
}

function setupClone(team) {
  return JSON.parse(JSON.stringify(team));
}

function setupPlayerScore(player) {
  return player.speed * 0.18 + player.shooting * 0.2 + player.passing * 0.22 + player.defending * 0.2 + player.stamina * 0.16 + (player.skillMoves ?? 2) * 2;
}

function setupPlayerOverall(player) {
  return Math.max(1, Math.min(99, Math.round(setupPlayerScore(player))));
}

function sortedSetupRoster(roster, starters) {
  return [...roster]
    .filter((player) => Boolean(player.isStarter) === starters)
    .sort((a, b) => (a.lineupOrder ?? 99) - (b.lineupOrder ?? 99) || setupPlayerScore(b) - setupPlayerScore(a));
}

export class App {
  constructor(root) {
    this.root = root;
    this.toast = document.getElementById("toast");
    this.data = null;
    this.tournament = null;
    this.knockoutTeams = [];
    this.selectedTeamId = null;
    this.setupTeamDraft = null;
    this.setupSelectedPlayerId = null;
    this.view = "loading";
    this.engine = null;
    this.renderer = null;
    this.activeMatch = null;
    this.lastMatchSummary = "";
    this.lastFrameTime = 0;
    this.animationFrame = null;
    this.speedMultiplier = 1;
    this.renderLoading();
    this.init();
  }

  async init() {
    this.data = await loadWorldCupData();
    this.knockoutTeams = selectKnockoutTeams(this.data.teams);
    this.initializeTournamentState();
    this.view = "selection";
    this.render();
  }

  initializeTournamentState(teams = this.data?.teams, groups = this.data?.groups, userTeam = null) {
    const fullTeams = Array.isArray(teams) ? teams : [];
    this.knockoutTeams = selectKnockoutTeams(fullTeams);
    const fullGroups = Array.isArray(groups) ? groups : [];
    this.tournament = new TournamentState({
      teams: this.knockoutTeams,
      groups: fullGroups,
      userTeamId: userTeam?.id ?? this.selectedTeamId,
      userTeam
    });
    return this.tournament;
  }

  getTeam(id) {
    return this.data.teamMap.get(id);
  }

  teamName(id) {
    return id ? this.getTeam(id)?.name ?? "TBD" : "TBD";
  }

  flagImg(team, className = "flag-pixel") {
    const src = flagUrl(team);
    return src ? `<img class="${className}" src="${src}" alt="" loading="lazy">` : "";
  }

  matchLabel(match) {
    if (!match) return "No scheduled match";
    return `${this.teamName(match.homeTeamId)} ${resultText(match)} ${this.teamName(match.awayTeamId)}`;
  }

  render() {
    this.stopLoop();
    if (this.view === "loading") this.renderLoading();
    if (this.view === "selection") this.renderSelection();
    if (this.view === "setup") this.renderTeamSetup();
    if (this.view === "hub") this.renderHub();
    if (this.view === "match") this.renderMatch();
  }

  renderLoading() {
    this.root.innerHTML = `
      <main class="screen selection-screen arcade-shell">
        <section class="masthead retro-slab">
          <div>
            <p class="eyebrow">Loading tournament database</p>
            <h1>World Cup 2D Futbol</h1>
            <p class="lede">Building squads, flags, groups, and tournament state.</p>
          </div>
        </section>
      </main>
    `;
  }

  renderSelection() {
    this.root.innerHTML = `
      <main class="screen selection-screen arcade-shell">
        <section class="masthead selection-masthead">
          <div>
            <p class="eyebrow">2026 autonomous tournament sim</p>
            <h1>World Cup 2D Futbol</h1>
            <p class="lede">Select one country, then manage a persistent tournament with form, suspensions, injuries, weather, and autonomous match AI.</p>
          </div>
          <div class="structure-panel retro-slab">
            <h2>Tournament Systems</h2>
            <ol>
              <li><strong>Knockout field:</strong> 32 teams, one loss and you are out.</li>
              <li><strong>Coach AI:</strong> tactics, momentum, weather, and autonomous decisions.</li>
              <li><strong>Hub:</strong> bracket view, fixture queue, fast simulation, and watched matches.</li>
            </ol>
          </div>
        </section>
        <section class="team-selection retro-scroll-panel">
          <article class="group-card knockout-selection-card">
            <h2>32-Team Knockout Field</h2>
            <div class="team-grid knockout-team-grid">
              ${this.knockoutTeams
                .map((team) => `
                  <button class="team-card flag-team-card" data-select-team="${team.id}" style="--primary:${team.primary};--secondary:${team.secondary}">
                    ${this.flagImg(team)}
                    <span>
                      <strong>${escapeHtml(team.name)}</strong>
                      <small>${escapeHtml(team.confederation)} · Strength ${team.strength}</small>
                    </span>
                  </button>
                `)
                .join("")}
            </div>
          </article>
        </section>
      </main>
    `;
    this.root.addEventListener("click", this.handleSelectionClick, { once: true });
  }

  groupSelectionHtml(group) {
    return `
      <article class="group-card">
        <h2>${escapeHtml(group.name)}</h2>
        <div class="team-grid">
          ${group.teamIds
            .map((teamId) => {
              const team = this.getTeam(teamId);
              return `
                <button class="team-card flag-team-card" data-select-team="${team.id}" style="--primary:${team.primary};--secondary:${team.secondary}">
                  ${this.flagImg(team)}
                  <span>
                    <strong>${escapeHtml(team.name)}</strong>
                    <small>${escapeHtml(team.confederation)} · Strength ${team.strength}</small>
                  </span>
                </button>
              `;
            })
            .join("")}
        </div>
      </article>
    `;
  }

  handleSelectionClick = (event) => {
    const button = event.target.closest("[data-select-team]");
    if (!button) {
      this.root.addEventListener("click", this.handleSelectionClick, { once: true });
      return;
    }
    this.selectedTeamId = button.dataset.selectTeam;
    this.initializeTournamentState();
    this.setupTeamDraft = setupClone(this.getTeam(this.selectedTeamId));
    this.setupSelectedPlayerId = null;
    this.view = "setup";
    this.showToast(`${this.teamName(this.selectedTeamId)} selected`);
    this.render();
  };

  renderTeamSetup() {
    const team = this.setupTeamDraft;
    const starters = sortedSetupRoster(team.roster, true);
    const subs = sortedSetupRoster(team.roster, false);
    const formation = team.formation ?? team.coach?.preferredFormation ?? "4-3-3";
    this.root.innerHTML = `
      <main class="screen setup-screen arcade-shell">
        <header class="setup-header retro-topbar">
          <div>
            <p class="eyebrow">Team Setup</p>
            <h1>${this.flagImg(team, "flag-pixel flag-large")}${escapeHtml(team.name)} Match Plan</h1>
            <p class="lede">Choose your XI, formation, and tactics before the tournament begins.</p>
          </div>
          <div class="hub-actions">
            <button data-action="setup-auto">Auto XI</button>
            <button data-action="setup-back">Back</button>
            <button class="primary-action" data-action="setup-save">Save & Start</button>
          </div>
        </header>

        <section class="team-setup-grid">
          <section class="setup-panel roster-panel retro-slab">
            <h2>Roster</h2>
            <p class="muted">Click a starter, then a substitute to swap.</p>
            <h3 class="setup-list-heading"><span>Starting XI</span><small>${starters.length}/11</small></h3>
            <div class="setup-roster-list starters-list">
              ${starters.map((player, index) => this.setupPlayerRowHtml(player, index + 1, true)).join("")}
            </div>
            <h3 class="setup-list-heading"><span>Substitutes</span><small>${subs.length}</small></h3>
            <div class="setup-roster-list subs-list">
              ${subs.map((player) => this.setupPlayerRowHtml(player, null, false)).join("")}
            </div>
          </section>

          <div class="setup-side-stack">
            <section class="setup-panel tactics-panel retro-slab">
              <h2>Coach Board</h2>
              <div class="coach-card">
                <span>Coach</span>
                <strong>${escapeHtml(team.coach?.name ?? "Head Coach")}</strong>
              </div>
              <label class="setup-field">
                <span>Formation</span>
                <select data-setup-field="formation">
                  ${Object.keys(FORMATIONS)
                    .map((option) => `<option value="${option}" ${option === formation ? "selected" : ""}>${option}</option>`)
                    .join("")}
                </select>
              </label>
              ${this.tacticSliderHtml("pressingIntensity", "Pressing", team.tactics?.pressingIntensity ?? 50)}
              ${this.tacticSliderHtml("defensiveLineHeight", "Defensive Line", team.tactics?.defensiveLineHeight ?? 50)}
              ${this.tacticSliderHtml("passingStyle", "Passing Directness", team.tactics?.passingStyle ?? 50)}
            </section>

            <section class="setup-panel pitch-panel retro-slab">
              <h2>Shape</h2>
              <div class="mini-pitch">
                ${this.miniPitchDotsHtml(starters, formation)}
              </div>
            </section>
          </div>
        </section>
      </main>
    `;
    this.root.removeEventListener("click", this.handleSetupClick);
    this.root.removeEventListener("input", this.handleSetupInput);
    this.root.addEventListener("click", this.handleSetupClick);
    this.root.addEventListener("input", this.handleSetupInput);
  }

  setupPlayerRowHtml(player, lineupNumber, isStarter) {
    const selected = player.id === this.setupSelectedPlayerId;
    return `
      <button class="setup-player-row ${selected ? "selected-player" : ""}" data-setup-player="${player.id}" data-starter="${isStarter ? "true" : "false"}">
        <span class="player-role">${lineupNumber ? String(lineupNumber).padStart(2, "0") : "SUB"}</span>
        <span>
          <strong>${escapeHtml(player.name)}</strong>
          <small>${escapeHtml(player.role ?? player.position)} · POS ${escapeHtml(player.position)} · OVR ${setupPlayerOverall(player)}</small>
        </span>
      </button>
    `;
  }

  tacticSliderHtml(key, label, value) {
    return `
      <label class="setup-field range-field">
        <span>${escapeHtml(label)} <strong class="setup-range-value" data-range-value="${key}">${value}</strong></span>
        <input data-setup-field="${key}" type="range" min="1" max="100" value="${value}">
      </label>
    `;
  }

  miniPitchDotsHtml(starters, formationKey) {
    const shape = FORMATIONS[formationKey] ?? FORMATIONS["4-3-3"];
    return shape
      .map((slot, index) => {
        const player = starters[index];
        const markerX = Math.max(0.14, Math.min(0.86, slot.x));
        const markerY = Math.max(0.08, Math.min(0.92, slot.y));
        const surname = player?.name?.split(" ").at(-1) ?? "";
        return `
          <span class="mini-player-dot" style="left:${markerX * 100}%;top:${markerY * 100}%" title="${escapeHtml(`${slot.position} ${surname}`)}">
            <strong>${escapeHtml(slot.position)}</strong>
            <small>${escapeHtml(surname)}</small>
          </span>
        `;
      })
      .join("");
  }

  handleSetupClick = (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === "setup-back") {
        this.root.removeEventListener("click", this.handleSetupClick);
        this.root.removeEventListener("input", this.handleSetupInput);
        this.setupTeamDraft = null;
        this.setupSelectedPlayerId = null;
        this.selectedTeamId = null;
        this.view = "selection";
        this.render();
      }
      if (action === "setup-auto") {
        this.autoSelectSetupXI();
        this.render();
      }
      if (action === "setup-save") this.saveTeamSetup();
      return;
    }

    const playerButton = event.target.closest("[data-setup-player]");
    if (!playerButton) return;
    this.handleSetupPlayerClick(playerButton.dataset.setupPlayer);
  };

  handleSetupInput = (event) => {
    const field = event.target.closest("[data-setup-field]");
    if (!field || !this.setupTeamDraft) return;
    const key = field.dataset.setupField;
    if (key === "formation") {
      this.setupTeamDraft.formation = field.value;
      this.setupTeamDraft.coach = { ...(this.setupTeamDraft.coach ?? {}), preferredFormation: field.value };
      this.render();
      return;
    }
    this.setupTeamDraft.tactics = {
      ...(this.setupTeamDraft.tactics ?? {}),
      [key]: Number(field.value)
    };
    const valueNode = this.root.querySelector(`[data-range-value="${key}"]`);
    if (valueNode) valueNode.textContent = field.value;
  };

  handleSetupPlayerClick(playerId) {
    if (!this.setupSelectedPlayerId) {
      this.setupSelectedPlayerId = playerId;
      this.render();
      return;
    }
    if (this.setupSelectedPlayerId === playerId) {
      this.setupSelectedPlayerId = null;
      this.render();
      return;
    }
    const roster = this.setupTeamDraft.roster;
    const first = roster.find((player) => player.id === this.setupSelectedPlayerId);
    const second = roster.find((player) => player.id === playerId);
    if (!first || !second || first.isStarter === second.isStarter) {
      this.setupSelectedPlayerId = playerId;
      this.render();
      return;
    }
    const starterOrder = first.isStarter ? first.lineupOrder : second.lineupOrder;
    first.isStarter = !first.isStarter;
    second.isStarter = !second.isStarter;
    first.lineupOrder = first.isStarter ? starterOrder : null;
    second.lineupOrder = second.isStarter ? starterOrder : null;
    this.normalizeSetupLineupOrder();
    this.setupSelectedPlayerId = null;
    this.render();
  }

  normalizeSetupLineupOrder() {
    sortedSetupRoster(this.setupTeamDraft.roster, true).forEach((player, index) => {
      player.lineupOrder = index;
      player.isStarter = true;
    });
    sortedSetupRoster(this.setupTeamDraft.roster, false).forEach((player) => {
      player.lineupOrder = null;
      player.isStarter = false;
    });
  }

  autoSelectSetupXI() {
    const roster = this.setupTeamDraft.roster;
    roster.forEach((player) => {
      player.isStarter = false;
      player.lineupOrder = null;
    });
    const selected = [];
    const add = (predicate, count) => {
      selected.push(
        ...roster
          .filter((player) => !selected.includes(player) && predicate(player))
          .sort((a, b) => setupPlayerScore(b) - setupPlayerScore(a))
          .slice(0, count)
      );
    };
    add((player) => player.position === "GK" || player.role === "GK", 1);
    add((player) => player.position === "DEF" || ["RB", "CB", "LB", "RWB", "LWB"].includes(player.role), 4);
    add((player) => player.position === "MID" || ["DM", "CM", "AM", "RM", "LM"].includes(player.role), 3);
    add((player) => player.position === "FWD" || ["RW", "LW", "ST", "CF"].includes(player.role), 3);
    if (selected.length < 11) {
      selected.push(...roster.filter((player) => !selected.includes(player)).sort((a, b) => setupPlayerScore(b) - setupPlayerScore(a)).slice(0, 11 - selected.length));
    }
    selected.slice(0, 11).forEach((player, index) => {
      player.isStarter = true;
      player.lineupOrder = index;
    });
    this.setupSelectedPlayerId = null;
  }

  saveTeamSetup() {
    this.normalizeSetupLineupOrder();
    const starters = sortedSetupRoster(this.setupTeamDraft.roster, true);
    if (starters.length !== 11) {
      this.showToast("Pick exactly 11 starters");
      return;
    }
    const updatedTeam = {
      ...this.setupTeamDraft,
      players: starters
    };
    this.data.teams = this.data.teams.map((team) => (team.id === updatedTeam.id ? updatedTeam : team));
    this.data.teamMap = new Map(this.data.teams.map((team) => [team.id, team]));
    this.initializeTournamentState(this.data.teams, this.data.groups, updatedTeam);
    this.root.removeEventListener("click", this.handleSetupClick);
    this.root.removeEventListener("input", this.handleSetupInput);
    this.setupTeamDraft = null;
    this.setupSelectedPlayerId = null;
    this.view = "hub";
    this.showToast("Team setup saved");
    this.render();
  }

  renderHub() {
    if (!this.tournament) this.initializeTournamentState();
    const selectedTeam = this.getTeam(this.selectedTeamId);
    const nextMatch = this.tournament.getNextMatch();
    const nextUserMatch = this.tournament.getNextMatchForTeam(this.selectedTeamId);
    const userUpNext = nextMatch && this.tournament.matchIncludesTeam(nextMatch, this.selectedTeamId);
    const champion = this.tournament.championId ? this.getTeam(this.tournament.championId) : null;
    const scheduled = this.tournament.getScheduledMatches().slice(0, 24);
    const stageBanner = this.hubStageBanner(nextMatch, champion);
    const bracketRounds = this.tournament.getBracketRounds();
    const userEliminated = this.selectedTeamId ? this.tournament.eliminatedTeamIds.has(this.selectedTeamId) : false;

    this.root.innerHTML = `
      <main class="screen hub-screen arcade-shell">
        <header class="hub-score-banner hub-header">
          <div class="hub-team-anchor">
            ${this.flagImg(selectedTeam, "flag-pixel flag-large")}
            <h1>${escapeHtml(selectedTeam.name)} Campaign</h1>
          </div>
          <div class="hub-stage-title">${escapeHtml(stageBanner)}</div>
          <div class="hub-status-chip">${escapeHtml(this.hubStatusText(nextMatch, champion))}</div>
        </header>

        <section class="hub-layout">
          <section class="retro-slab hub-standings">
            <div class="panel-heading">
              <span>Bracket</span>
              <small>Single Elimination</small>
            </div>
            <div class="bracket-view standings-grid-dense" data-hub-bracket></div>
          </section>
          <aside class="retro-slab hub-fixtures">
            <div class="hub-actions">
              <button data-action="sim-next" ${nextMatch && !userUpNext ? "" : "disabled"}>Sim Next</button>
              <button data-action="sim-to-user" ${nextMatch && nextUserMatch && !userUpNext ? "" : "disabled"}>Sim To My Match</button>
              <button class="primary-action play-match-action" data-action="play-user" ${userUpNext ? "" : "disabled"}>Play Match</button>
              <button data-action="new">New Tournament</button>
            </div>
            <div class="panel-heading">
              <span>Fixtures</span>
              <small>Chronological Queue</small>
            </div>
            <div class="schedule-list" data-hub-schedule></div>
            <div class="panel-heading">
              <span>Reports</span>
              <small>Latest</small>
            </div>
            <div class="recent-stack" data-hub-reports></div>
          </aside>
        </section>
      </main>
    `;

    this.root.querySelector("[data-hub-bracket]").innerHTML = bracketRounds.length
      ? bracketRounds.map((round) => this.bracketRoundHtml(round)).join("")
      : "<p class=\"muted\">No bracket available.</p>";
    this.root.querySelector("[data-hub-schedule]").innerHTML = scheduled.length
      ? scheduled.map((match) => this.scheduleRowHtml(match, nextUserMatch?.id)).join("")
      : `<p class="muted">${userEliminated && !champion ? "You have been eliminated. Sim the rest from a new tournament flow later." : "No scheduled matches remain."}</p>`;
    this.root.querySelector("[data-hub-reports]").innerHTML = this.tournament.recentSummaries.length
      ? this.tournament.recentSummaries.slice(0, 5).map((item) => `<p>${escapeHtml(item)}</p>`).join("")
      : "<p class=\"muted\">No reports yet.</p>";
    this.root.addEventListener("click", this.handleHubClick, { once: true });
  }

  hubStageBanner(nextMatch, champion) {
    if (champion) return "Tournament Complete";
    if (!nextMatch) return "Schedule Complete";
    return nextMatch.roundName ?? "Knockout Stage";
  }

  hubStatusText(nextMatch, champion) {
    if (champion) return `${champion.name} won the tournament. Start a new tournament to run it back.`;
    if (this.selectedTeamId && this.tournament.eliminatedTeamIds.has(this.selectedTeamId)) return `${this.teamName(this.selectedTeamId)} has been eliminated.`;
    if (!nextMatch) return "The schedule is complete.";
    if (this.tournament.matchIncludesTeam(nextMatch, this.selectedTeamId)) return `Your match is next: ${this.matchLabel(nextMatch)}.`;
    return `Next chronological match: ${this.matchLabel(nextMatch)}. Sim forward or wait for your fixture.`;
  }

  scheduleRowHtml(match, highlightedMatchId = null) {
    const home = this.getTeam(match.homeTeamId);
    const away = this.getTeam(match.awayTeamId);
    const isUserMatch = match.id === highlightedMatchId;
    return `
      <article class="schedule-row ${isUserMatch ? "user-schedule-row" : ""}">
        <span class="schedule-meta">${escapeHtml(this.matchMetaHtml(match))}</span>
        <span class="schedule-team" title="${escapeHtml(home.name)}">${this.flagImg(home)}<span>${escapeHtml(home.name)}</span></span>
        <strong>${escapeHtml(resultText(match))}</strong>
        <span class="schedule-team" title="${escapeHtml(away.name)}">${this.flagImg(away)}<span>${escapeHtml(away.name)}</span></span>
      </article>
    `;
  }

  standingsHtml(group) {
    return `
      <article class="standings-card">
        <h3>${escapeHtml(group.name)}</h3>
        <table>
          <thead>
            <tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr>
          </thead>
          <tbody>
            ${group.standings
              .map((record, index) => {
                const team = this.getTeam(record.teamId);
                return `
                  <tr class="${record.teamId === this.selectedTeamId ? "selected-row" : ""}">
                    <td class="standing-team" title="${escapeHtml(team.name)}"><span class="rank">${index + 1}</span>${this.flagImg(team)}<span>${escapeHtml(team.name)}</span></td>
                    <td>${record.played}</td><td>${record.wins}</td><td>${record.draws}</td><td>${record.losses}</td><td class="standing-gd">${record.goalDifference}</td><td class="standing-points">${record.points}</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </article>
    `;
  }

  bracketRoundHtml(round) {
    return `
      <article class="bracket-round-card">
        <h3>${escapeHtml(round.label)}</h3>
        <div class="bracket-match-stack">
          ${round.matches.map((match) => this.bracketMatchHtml(match)).join("")}
        </div>
      </article>
    `;
  }

  bracketMatchHtml(match) {
    const home = match.homeTeamId ? this.getTeam(match.homeTeamId) : null;
    const away = match.awayTeamId ? this.getTeam(match.awayTeamId) : null;
    const winnerId = match.result?.winnerId ?? null;
    const isUserMatch = this.tournament.matchIncludesTeam(match, this.selectedTeamId);
    return `
      <article class="bracket-match ${isUserMatch ? "user-schedule-row" : ""} ${match.status === "completed" ? "completed-match" : ""}">
        <span class="schedule-meta">${escapeHtml(match.roundName ?? "Bracket")}</span>
        ${this.bracketTeamSlotHtml(home, winnerId, match.status)}
        <strong>${escapeHtml(resultText(match))}</strong>
        ${this.bracketTeamSlotHtml(away, winnerId, match.status)}
      </article>
    `;
  }

  bracketTeamSlotHtml(team, winnerId, status) {
    if (!team) return "<span class=\"schedule-team bracket-placeholder\"><span>TBD</span></span>";
    const eliminated = status === "completed" && team.id !== winnerId;
    const winner = status === "completed" && team.id === winnerId;
    return `
      <span class="schedule-team bracket-team ${winner ? "winner-team" : ""} ${eliminated ? "eliminated-team" : ""}" title="${escapeHtml(team.name)}">
        ${this.flagImg(team)}
        <span>${escapeHtml(team.name)}</span>
      </span>
    `;
  }

  matchMetaHtml(match) {
    if (!match) return "Tournament complete";
    return match.roundName;
  }

  handleHubClick = (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) {
      this.root.addEventListener("click", this.handleHubClick, { once: true });
      return;
    }

    const action = button.dataset.action;
    if (action === "sim-next") {
      const item = this.tournament.simulateNextMatch();
      this.showToast(item ? this.matchLabel(item.match) : "No match available");
      this.render();
    }
    if (action === "sim-to-user") {
      const count = this.tournament.simulateToUserMatch(this.selectedTeamId);
      this.showToast(`${count} match${count === 1 ? "" : "es"} simulated`);
      this.render();
    }
    if (action === "play-user") this.watchUserMatch();
    if (action === "new") {
      this.selectedTeamId = null;
      this.initializeTournamentState();
      this.view = "selection";
      this.render();
    }
  };

  watchUserMatch() {
    const match = this.tournament.getNextMatch();
    if (!match || !this.tournament.matchIncludesTeam(match, this.selectedTeamId)) {
      this.showToast("Your match is not next");
      this.render();
      return;
    }
    this.activeMatch = match;
    this.view = "match";
    this.render();
  }

  renderMatch() {
    const { homeTeam, awayTeam } = this.tournament.getMatchTeams(this.activeMatch);
    this.root.innerHTML = `
      <main class="screen match-screen arcade-shell">
        <section class="match-shell">
          <div class="match-topbar">
            <div>
              <p class="eyebrow">${escapeHtml(this.matchMetaHtml(this.activeMatch))}</p>
              <h1>${this.flagImg(homeTeam)}${escapeHtml(homeTeam.name)} vs ${this.flagImg(awayTeam)}${escapeHtml(awayTeam.name)}</h1>
            </div>
            <div class="match-controls">
              <button data-action="pause">Pause</button>
              <button data-action="speed">Speed 1x</button>
              <button data-action="hub">Hub / Forfeit</button>
            </div>
          </div>
          <div class="canvas-wrap">
            <canvas id="pitchCanvas" aria-label="Retro 3D soccer match simulation"></canvas>
          </div>
          <div class="match-bottom">
            <div id="scoreboard" class="scoreboard"></div>
            <button id="continueButton" data-action="continue" class="primary-action hidden">Return to Hub</button>
          </div>
        </section>
        <aside class="match-side">
          <h2>Live AI</h2>
          <div id="livePanel"></div>
        </aside>
        <div id="newspaperModal" class="newspaper-modal hidden"></div>
      </main>
    `;

    this.engine = new MatchEngine({
      match: this.activeMatch,
      homeTeam,
      awayTeam,
      tournamentContext: this.tournament,
      onComplete: (result) => {
        this.tournament.applyWatchedResult(this.activeMatch.id, result);
        this.lastMatchSummary = result.summary;
        document.getElementById("continueButton")?.classList.remove("hidden");
        this.showNewspaperModal(result.summary);
        this.updateLivePanel();
      }
    });
    this.renderer = new ThreeJsRenderer(document.getElementById("pitchCanvas"));
    this.speedMultiplier = 1;
    this.root.addEventListener("click", this.handleMatchClick);
    this.lastFrameTime = performance.now();
    this.loop(this.lastFrameTime);
  }

  handleMatchClick = (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || this.view !== "match") return;
    const action = button.dataset.action;
    if (action === "pause") {
      this.engine.setPaused(!this.engine.paused);
      button.textContent = this.engine.paused ? "Play" : "Pause";
    }
    if (action === "speed") {
      this.speedMultiplier = this.speedMultiplier === 1 ? 2 : this.speedMultiplier === 2 ? 4 : 1;
      button.textContent = `Speed ${this.speedMultiplier}x`;
    }
    if (action === "close-summary") document.getElementById("newspaperModal")?.classList.add("hidden");
    if (action === "hub") {
      if (this.engine && !this.engine.complete) this.forfeitActiveMatch();
      this.view = "hub";
      this.render();
    }
    if (action === "continue") {
      this.view = "hub";
      this.render();
    }
  };

  forfeitActiveMatch() {
    if (!this.activeMatch || !this.tournament.matchIncludesTeam(this.activeMatch, this.selectedTeamId)) return;
    const { homeTeam, awayTeam } = this.tournament.getMatchTeams(this.activeMatch);
    const userIsHome = homeTeam.id === this.selectedTeamId;
    const winner = userIsHome ? awayTeam : homeTeam;
    const result = {
      home: userIsHome ? 0 : 3,
      away: userIsHome ? 3 : 0,
      decidedBy: "forfeit",
      winnerId: winner.id,
      weather: this.engine?.weather ?? "Forfeit",
      events: [
        {
          minute: Math.round(this.engine?.gameMinutes ?? 0),
          type: "decision",
          teamId: winner.id,
          text: `${winner.name} advance by forfeit`
        }
      ],
      participation: [],
      tacticSnapshot: { ...(winner.tactics ?? {}) },
      summary: `${homeTeam.name} ${userIsHome ? "0-3" : "3-0"} ${awayTeam.name}. ${winner.name} advance by forfeit.`
    };
    this.tournament.applyWatchedResult(this.activeMatch.id, result);
    this.lastMatchSummary = result.summary;
  }

  loop = (timestamp) => {
    if (this.view !== "match" || !this.engine || !this.renderer) return;
    const rawDt = (timestamp - this.lastFrameTime) / 1000;
    const stepDt = Math.max(0, Math.min(rawDt, MATCH.maxDeltaSeconds));
    this.lastFrameTime = timestamp;
    for (let i = 0; i < this.speedMultiplier; i += 1) this.engine.update(stepDt);
    const snapshot = this.engine.getSnapshot();
    this.renderer.render(snapshot);
    this.updateScoreboard(snapshot);
    this.updateLivePanel(snapshot);
    this.animationFrame = requestAnimationFrame(this.loop);
  };

  updateScoreboard(snapshot = this.engine?.getSnapshot()) {
    if (!snapshot) return;
    const node = document.getElementById("scoreboard");
    if (!node) return;
    node.innerHTML = `
      <strong class="scoreline">
        ${this.flagImg(snapshot.homeTeam)}
        <span class="score-team-name" title="${escapeHtml(snapshot.homeTeam.name)}">${escapeHtml(compactTeamName(snapshot.homeTeam.name))}</span>
        <span class="score-numbers">${snapshot.score.home} - ${snapshot.score.away}</span>
        ${this.flagImg(snapshot.awayTeam)}
        <span class="score-team-name" title="${escapeHtml(snapshot.awayTeam.name)}">${escapeHtml(compactTeamName(snapshot.awayTeam.name))}</span>
      </strong>
      <span>${formatClock(snapshot.gameMinutes)}</span>
      <span>${escapeHtml(snapshot.weather)}</span>
      <span>${escapeHtml(snapshot.lastEvent)}</span>
    `;
  }

  updateLivePanel(snapshot = this.engine?.getSnapshot()) {
    if (!snapshot) return;
    const node = document.getElementById("livePanel");
    if (!node) return;
    const possession = snapshot.players.find((player) => player.id === snapshot.possessionPlayerId);
    const focusPlayers = snapshot.players
      .filter((player) => ["SEEK_BALL", "DRIBBLING", "SKILL_MOVE", "FROZEN"].includes(player.state) || player.id === snapshot.possessionPlayerId)
      .slice(0, 6);
    node.innerHTML = `
      <p class="match-name">${possession ? `${escapeHtml(possession.name)} in possession` : "Loose ball"}</p>
      <p class="muted">${escapeHtml(snapshot.matchPhase)} · ${escapeHtml(snapshot.lastEvent)}</p>
      <div class="trait-stack">
        ${focusPlayers
          .map(
            (player) => `
              <article class="trait-card">
                <h3>${escapeHtml(player.name)}</h3>
                <p>${escapeHtml(player.team.name)} · ${escapeHtml(player.state)}</p>
                <div>SPD ${statBar(player.source.speed)}</div>
                <div>SKL ${statBar((player.source.skillMoves ?? 2) * 20)}</div>
                <div>EGO ${statBar(player.source.ego ?? 50)}</div>
                <div>PAS ${statBar(player.source.passing)}</div>
                <div>DEF ${statBar(player.source.defending)}</div>
              </article>
            `
          )
          .join("")}
      </div>
    `;
  }

  showNewspaperModal(summary) {
    const node = document.getElementById("newspaperModal");
    if (!node) return;
    node.classList.remove("hidden");
    node.innerHTML = `
      <article class="newspaper-card">
        <p class="eyebrow">16-Bit Sports Extra</p>
        <h2>Full-Time Report</h2>
        <p>${escapeHtml(summary)}</p>
        <button data-action="close-summary">Close Report</button>
      </article>
    `;
  }

  stopLoop() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.renderer?.dispose?.();
    this.renderer = null;
    if (this.root) this.root.removeEventListener("click", this.handleMatchClick);
  }

  showToast(message) {
    if (!this.toast) return;
    this.toast.textContent = message;
    this.toast.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove("show"), 2400);
  }
}
