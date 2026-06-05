import { writeFileSync } from "node:fs";

import { TEAMS } from "./src/data/teams.js";
import { clamp, createSeededRandom, pick } from "./src/core/utils.js";

const STARTER_ROLES = Object.freeze(["GK", "RB", "CB", "CB", "LB", "DM", "CM", "CM", "RW", "ST", "LW"]);
const SUB_ROLES = Object.freeze(["GK", "GK", "CB", "CB", "RB", "LB", "DM", "CM", "AM", "RW", "ST", "LW"]);
const FORMATIONS = Object.freeze(["4-3-3", "4-2-3-1", "4-4-2", "3-5-2"]);
const SKIN_TONES = Object.freeze(["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac", "#b06d42"]);
const HAIR_STYLES = Object.freeze(["short", "crop", "sidePart", "bald"]);
const HAIR_COLORS = Object.freeze(["#171717", "#3b2416", "#704214", "#b55b2a", "#d8b36a", "#f0f0f0"]);
const ISO2_BY_TEAM_ID = Object.freeze({
  MEX: "mx",
  RSA: "za",
  KOR: "kr",
  CZE: "cz",
  CAN: "ca",
  SUI: "ch",
  QAT: "qa",
  BIH: "ba",
  BRA: "br",
  MAR: "ma",
  HAI: "ht",
  SCO: "gb-sct",
  USA: "us",
  PAR: "py",
  AUS: "au",
  TUR: "tr",
  GER: "de",
  SLV: "sv",
  CIV: "ci",
  ECU: "ec",
  NED: "nl",
  JPN: "jp",
  TUN: "tn",
  SWE: "se",
  BEL: "be",
  EGY: "eg",
  IRN: "ir",
  NZL: "nz",
  ESP: "es",
  CPV: "cv",
  KSA: "sa",
  URU: "uy",
  FRA: "fr",
  SEN: "sn",
  NOR: "no",
  IRQ: "iq",
  ARG: "ar",
  ALG: "dz",
  AUT: "at",
  JOR: "jo",
  POR: "pt",
  UZB: "uz",
  COL: "co",
  COD: "cd",
  ENG: "gb-eng",
  CRO: "hr",
  GHA: "gh",
  PAN: "pa"
});

const POSITION_BY_ROLE = Object.freeze({
  GK: "GK",
  RB: "DEF",
  CB: "DEF",
  LB: "DEF",
  RWB: "DEF",
  LWB: "DEF",
  DM: "MID",
  CM: "MID",
  AM: "MID",
  RW: "FWD",
  ST: "FWD",
  LW: "FWD",
  CF: "FWD"
});

const ROLE_PROFILES = Object.freeze({
  GK: { speed: -14, shooting: -38, passing: 0, defending: 30, stamina: -5 },
  RB: { speed: 10, shooting: -8, passing: 5, defending: 10, stamina: 9 },
  CB: { speed: -4, shooting: -12, passing: 1, defending: 19, stamina: 5 },
  LB: { speed: 10, shooting: -8, passing: 5, defending: 10, stamina: 9 },
  DM: { speed: 1, shooting: -4, passing: 10, defending: 14, stamina: 10 },
  CM: { speed: 4, shooting: 3, passing: 14, defending: 5, stamina: 10 },
  AM: { speed: 7, shooting: 12, passing: 16, defending: -5, stamina: 6 },
  RW: { speed: 15, shooting: 12, passing: 8, defending: -8, stamina: 7 },
  ST: { speed: 9, shooting: 23, passing: 0, defending: -10, stamina: 4 },
  LW: { speed: 15, shooting: 12, passing: 8, defending: -8, stamina: 7 }
});

const ELITE_SKILL_TEAMS = new Set(["ARG", "BRA", "FRA", "ESP", "POR", "ENG"]);
const SKILL_ROLE_BONUS = Object.freeze({
  GK: -2,
  RB: -1,
  CB: -2,
  LB: -1,
  DM: -1,
  CM: 0,
  AM: 1,
  RW: 2,
  ST: 1,
  LW: 2
});

const NAME_POOLS = Object.freeze({
  anglo: {
    first: ["Adam", "Ben", "Callum", "Daniel", "Ethan", "Finn", "Harry", "Jack", "Liam", "Noah", "Owen", "Ryan", "Mason", "Tyler"],
    last: ["Bennett", "Campbell", "Cooper", "Davies", "Fraser", "Grant", "Morgan", "Parker", "Reed", "Sullivan", "Turner", "Wilson", "Roberts", "Walker"]
  },
  arabic: {
    first: ["Adel", "Ahmed", "Amir", "Hassan", "Karim", "Mahmoud", "Nabil", "Omar", "Rami", "Sami", "Tarek", "Youssef", "Fahad", "Zaid"],
    last: ["Abbas", "Alami", "Farouk", "Haddad", "Hassan", "Khalil", "Mansour", "Nasser", "Rahman", "Saleh", "Yassin", "Zaher", "Al-Karim", "Mahmoud"]
  },
  eastAsian: {
    first: ["Daichi", "Haru", "Jin", "Jun", "Kaito", "Min-Jae", "Ren", "Riku", "Sota", "Takumi", "Yuto", "Yuya", "Haruto", "Yuma"],
    last: ["Cho", "Ito", "Kim", "Kobayashi", "Lee", "Mori", "Nakamura", "Park", "Sato", "Suzuki", "Tanaka", "Yamada", "Kang", "Hayashi"]
  },
  european: {
    first: ["Adrian", "Andreas", "David", "Dominik", "Jan", "Jonas", "Leon", "Lukas", "Marco", "Martin", "Niklas", "Tomas", "Florian", "Milan"],
    last: ["Bauer", "Berger", "Horvat", "Keller", "Kovac", "Novak", "Schmidt", "Steiner", "Svoboda", "Weber", "Wimmer", "Zoric", "Meyer", "Huber"]
  },
  french: {
    first: ["Abdou", "Aime", "Blaise", "Cheikh", "Ibrahima", "Jean", "Kader", "Mamadou", "Moussa", "Olivier", "Saliou", "Yann", "Noel", "Theo"],
    last: ["Ba", "Camara", "Diallo", "Diop", "Fall", "Gueye", "Mendy", "Ndiaye", "Sarr", "Seck", "Sow", "Traore", "Kone", "Moreau"]
  },
  hispanic: {
    first: ["Alejandro", "Andres", "Carlos", "Diego", "Emiliano", "Francisco", "Javier", "Jose", "Luis", "Mateo", "Rafael", "Santiago", "Nicolas", "Tomas"],
    last: ["Alvarez", "Castillo", "Diaz", "Fernandez", "Garcia", "Gomez", "Herrera", "Lopez", "Martinez", "Morales", "Ramirez", "Torres", "Rojas", "Vargas"]
  },
  lusophone: {
    first: ["Andre", "Bruno", "Caio", "Diogo", "Felipe", "Gabriel", "Hugo", "Joao", "Lucas", "Mateus", "Rafael", "Tiago", "Vitor", "Nuno"],
    last: ["Almeida", "Barbosa", "Carvalho", "Costa", "Ferreira", "Gomes", "Lima", "Martins", "Pereira", "Rocha", "Santos", "Silva", "Sousa", "Teixeira"]
  },
  african: {
    first: ["Abdul", "Baba", "Daniel", "Emmanuel", "Ibrahim", "Isaac", "Kofi", "Kwame", "Musa", "Samuel", "Seydou", "Yaw", "Kojo", "Nana"],
    last: ["Addo", "Boateng", "Diarra", "Mensah", "N'Dour", "Nkosi", "Osei", "Quaye", "Sissoko", "Toure", "Yakubu", "Zongo", "Owusu", "Bamba"]
  },
  slavic: {
    first: ["Ante", "Dario", "Ivan", "Josip", "Luka", "Marko", "Mateo", "Milan", "Nikola", "Petar", "Stipe", "Toni", "Boris", "Davor"],
    last: ["Babic", "Kovac", "Kralj", "Maric", "Novak", "Peric", "Petrovic", "Popovic", "Radic", "Varga", "Vidic", "Zivkovic", "Jovic", "Pavic"]
  },
  turkic: {
    first: ["Ali", "Arda", "Baris", "Burak", "Can", "Emir", "Hakan", "Kerem", "Mert", "Orkun", "Selim", "Yusuf", "Rustam", "Aziz"],
    last: ["Aydin", "Celik", "Demir", "Erdem", "Kara", "Kaya", "Koc", "Ozturk", "Sahin", "Turan", "Yildiz", "Yilmaz", "Karimov", "Rahimov"]
  }
});

const COUNTRY_NAME_POOLS = Object.freeze({
  SLV: {
    first: ["Alex", "Brayan", "Cristian", "Darwin", "Diego", "Enrico", "Erick", "Jairo", "Mateo", "Nelson", "Roberto", "Tomas"],
    last: ["Alas", "Bonilla", "Ceren", "Flores", "Henriquez", "Larin", "Martinez", "Orellana", "Pineda", "Rodriguez", "Romero", "Tamacas"]
  },
  JPN: {
    first: ["Daichi", "Kaito", "Ren", "Riku", "Sota", "Takumi", "Yuto", "Yuya", "Haruto", "Shoma", "Ryo", "Tatsuya"],
    last: ["Ito", "Kobayashi", "Mori", "Nakamura", "Sato", "Suzuki", "Tanaka", "Yamada", "Hayashi", "Watanabe", "Endo", "Maeda"]
  },
  KOR: {
    first: ["Min-Jae", "Jin-Su", "Seung-Ho", "Hyun-Woo", "Jae-Sung", "Sang-Min", "Dong-Hyun", "Jun-Ho", "Tae-Yang", "Woo-Jin", "Ji-Hoon", "Min-Kyu"],
    last: ["Kim", "Lee", "Park", "Cho", "Kang", "Choi", "Jung", "Han", "Yoon", "Seo", "Hwang", "Oh"]
  }
});

function randomName(random, team, used) {
  const pool = COUNTRY_NAME_POOLS[team.id] ?? NAME_POOLS[team.culture] ?? NAME_POOLS.european;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const name = `${pick(random, pool.first)} ${pick(random, pool.last)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `${pick(random, pool.first)} ${pick(random, pool.last)} ${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

function statFor(random, team, role, key, starterBoost) {
  const profile = ROLE_PROFILES[role] ?? ROLE_PROFILES.CM;
  return clamp(Math.round(team.strength + profile[key] + starterBoost + (random() - 0.5) * 18), 1, 100);
}

function skillMovesFor(random, team, role, isStarter) {
  const eliteBoost = ELITE_SKILL_TEAMS.has(team.id) ? 1 : 0;
  const strengthBoost = team.strength >= 86 ? 1 : team.strength <= 70 ? -1 : 0;
  const starterBoost = isStarter ? 0.45 : -0.35;
  const roleBoost = SKILL_ROLE_BONUS[role] ?? 0;
  return clamp(Math.round(2 + eliteBoost + strengthBoost + starterBoost + roleBoost + (random() - 0.5) * 1.35), 1, 5);
}

function createPlayer(team, name, role, index, isStarter) {
  const random = createSeededRandom(`${team.id}:${name}:${role}:${index}:2026-json`);
  const starterBoost = isStarter ? 4 : -4;
  const player = {
    id: `${team.id}-${String(index + 1).padStart(2, "0")}`,
    teamId: team.id,
    number: index + 1,
    name,
    position: POSITION_BY_ROLE[role] ?? "MID",
    role,
    isStarter,
    speed: statFor(random, team, role, "speed", starterBoost),
    shooting: statFor(random, team, role, "shooting", starterBoost),
    passing: statFor(random, team, role, "passing", starterBoost),
    defending: statFor(random, team, role, "defending", starterBoost),
    stamina: statFor(random, team, role, "stamina", starterBoost),
    ego: clamp(Math.round(45 + (random() - 0.5) * 54 + (role === "ST" ? 10 : 0) + (role === "GK" ? -8 : 0)), 1, 100),
    skillMoves: skillMovesFor(random, team, role, isStarter),
    skinTone: pick(random, SKIN_TONES),
    hairStyle: pick(random, HAIR_STYLES),
    hairColor: pick(random, HAIR_COLORS)
  };

  if (team.id === "SLV" && name === "Mateo Ceren") {
    return {
      ...player,
      isStar: true,
      speed: 94,
      shooting: 90,
      passing: 88,
      defending: 55,
      stamina: 91,
      ego: 92,
      skillMoves: 5,
      skinTone: "#c68642",
      hairStyle: "crop",
      hairColor: "#171717"
    };
  }

  return player;
}

function createRoster(team) {
  const random = createSeededRandom(`${team.id}:full-roster`);
  const used = new Set();
  const starterNames = team.players.map((player) => {
    used.add(player.name);
    return player.name;
  });
  const roles = [...STARTER_ROLES, ...SUB_ROLES];

  return roles.map((role, index) => {
    const isStarter = index < STARTER_ROLES.length;
    const name = isStarter ? starterNames[index] : randomName(random, team, used);
    return createPlayer(team, name, role, index, isStarter);
  });
}

function createCoach(team) {
  const random = createSeededRandom(`${team.id}:coach`);
  return {
    name: randomName(random, team, new Set()),
    preferredFormation: pick(random, FORMATIONS)
  };
}

function createTactics(team) {
  const random = createSeededRandom(`${team.id}:tactics`);
  return {
    pressingIntensity: clamp(Math.round(team.strength - 10 + random() * 30), 1, 100),
    defensiveLineHeight: clamp(Math.round(team.strength - 18 + random() * 34), 1, 100),
    passingStyle: clamp(Math.round(42 + random() * 38), 1, 100)
  };
}

const generatedTeams = TEAMS.map((team) => {
  const roster = createRoster(team);
  const players = roster.filter((player) => player.isStarter);
  return {
    id: team.id,
    countryName: team.name,
    name: team.name,
    iso2: ISO2_BY_TEAM_ID[team.id],
    confederation: team.confederation,
    group: team.group,
    strength: team.strength,
    flagColor: {
      primary: team.primary,
      secondary: team.secondary
    },
    primaryColor: team.primary,
    secondaryColor: team.secondary,
    primary: team.primary,
    secondary: team.secondary,
    coach: createCoach(team),
    tactics: createTactics(team),
    roster,
    players
  };
});

writeFileSync(new URL("./teams.json", import.meta.url), `${JSON.stringify(generatedTeams, null, 2)}\n`);

console.log(`Generated teams.json with ${generatedTeams.length} teams and ${generatedTeams.length * 23} players.`);
