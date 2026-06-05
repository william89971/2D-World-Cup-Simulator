import { formatClock } from "../core/utils.js";

export class MatchLogger {
  constructor() {
    this.events = [];
  }

  record({ minute, type, teamId = null, playerId = null, text, metadata = {} }) {
    this.events.push({
      minute: Math.max(0, Math.min(120, Number(minute) || 0)),
      type,
      teamId,
      playerId,
      text,
      metadata
    });
  }

  formatSummary({ homeTeam, awayTeam, score, weather }) {
    const headline = `${homeTeam.name.toUpperCase()} ${score.home}-${score.away} ${awayTeam.name.toUpperCase()}`;
    const major = this.events
      .filter((event) => ["goal", "foul", "card", "injury", "leadChange", "decision", "momentum", "weather"].includes(event.type))
      .slice(0, 10)
      .map((event) => `${formatClock(event.minute).slice(0, 2)}' ${event.text}`)
      .join(" / ");
    return `${headline}. WEATHER: ${weather}. ${major || "A tight tactical match with few clear chances."}`;
  }
}
