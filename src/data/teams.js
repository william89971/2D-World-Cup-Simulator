import { FORMATION } from "../core/constants.js";
import { clamp, createSeededRandom, pick } from "../core/utils.js";

const POSITIONS = FORMATION.map((slot) => slot.position);

const POSITION_PROFILES = {
  GK: { speed: -12, shooting: -34, passing: 0, defending: 28, stamina: -5 },
  RB: { speed: 9, shooting: -8, passing: 5, defending: 10, stamina: 8 },
  CB: { speed: -3, shooting: -12, passing: 1, defending: 18, stamina: 5 },
  LB: { speed: 9, shooting: -8, passing: 5, defending: 10, stamina: 8 },
  DM: { speed: 1, shooting: -4, passing: 10, defending: 13, stamina: 10 },
  CM: { speed: 4, shooting: 3, passing: 14, defending: 5, stamina: 10 },
  RW: { speed: 15, shooting: 12, passing: 8, defending: -8, stamina: 7 },
  ST: { speed: 9, shooting: 22, passing: 0, defending: -10, stamina: 4 },
  LW: { speed: 15, shooting: 12, passing: 8, defending: -8, stamina: 7 }
};

const TOP_ROSTERS = {
  ARG: [
    "Emiliano Martinez",
    "Nahuel Molina",
    "Cristian Romero",
    "Nicolas Otamendi",
    "Nicolas Tagliafico",
    "Rodrigo De Paul",
    "Enzo Fernandez",
    "Alexis Mac Allister",
    "Angel Di Maria",
    "Julian Alvarez",
    "Lionel Messi"
  ],
  FRA: [
    "Mike Maignan",
    "Jules Kounde",
    "William Saliba",
    "Dayot Upamecano",
    "Theo Hernandez",
    "Aurelien Tchouameni",
    "Eduardo Camavinga",
    "Antoine Griezmann",
    "Ousmane Dembele",
    "Kylian Mbappe",
    "Marcus Thuram"
  ],
  BRA: [
    "Alisson Becker",
    "Danilo",
    "Marquinhos",
    "Gabriel Magalhaes",
    "Wendell",
    "Casemiro",
    "Bruno Guimaraes",
    "Lucas Paqueta",
    "Vinicius Junior",
    "Rodrygo",
    "Endrick"
  ],
  USA: [
    "Matt Turner",
    "Sergino Dest",
    "Chris Richards",
    "Tim Ream",
    "Antonee Robinson",
    "Tyler Adams",
    "Weston McKennie",
    "Yunus Musah",
    "Christian Pulisic",
    "Folarin Balogun",
    "Timothy Weah"
  ],
  ENG: [
    "Jordan Pickford",
    "Kyle Walker",
    "John Stones",
    "Marc Guehi",
    "Luke Shaw",
    "Declan Rice",
    "Jude Bellingham",
    "Phil Foden",
    "Bukayo Saka",
    "Harry Kane",
    "Marcus Rashford"
  ],
  ESP: [
    "Unai Simon",
    "Dani Carvajal",
    "Robin Le Normand",
    "Aymeric Laporte",
    "Marc Cucurella",
    "Rodri",
    "Pedri",
    "Gavi",
    "Lamine Yamal",
    "Alvaro Morata",
    "Nico Williams"
  ],
  GER: [
    "Marc-Andre ter Stegen",
    "Joshua Kimmich",
    "Antonio Rudiger",
    "Jonathan Tah",
    "David Raum",
    "Robert Andrich",
    "Florian Wirtz",
    "Jamal Musiala",
    "Leroy Sane",
    "Kai Havertz",
    "Niclas Fullkrug"
  ],
  POR: [
    "Diogo Costa",
    "Joao Cancelo",
    "Ruben Dias",
    "Goncalo Inacio",
    "Nuno Mendes",
    "Vitinha",
    "Bruno Fernandes",
    "Bernardo Silva",
    "Rafael Leao",
    "Cristiano Ronaldo",
    "Goncalo Ramos"
  ],
  NED: [
    "Bart Verbruggen",
    "Denzel Dumfries",
    "Virgil van Dijk",
    "Nathan Ake",
    "Jeremie Frimpong",
    "Frenkie de Jong",
    "Tijjani Reijnders",
    "Xavi Simons",
    "Cody Gakpo",
    "Memphis Depay",
    "Donyell Malen"
  ],
  BEL: [
    "Thibaut Courtois",
    "Timothy Castagne",
    "Wout Faes",
    "Arthur Theate",
    "Maxim De Cuyper",
    "Amadou Onana",
    "Kevin De Bruyne",
    "Youri Tielemans",
    "Jeremy Doku",
    "Romelu Lukaku",
    "Lois Openda"
  ],
  SLV: [
    "Tomas Romero",
    "Bryan Tamacas",
    "Eriq Zavaleta",
    "Ronald Rodriguez",
    "Alexander Larin",
    "Narciso Orellana",
    "Darwin Ceren",
    "Enrico Hernandez",
    "Jairo Henriquez",
    "Nelson Bonilla",
    "Mateo Ceren"
  ]
};

const NAME_POOLS = {
  anglo: {
    first: ["Adam", "Ben", "Callum", "Daniel", "Ethan", "Finn", "Harry", "Jack", "Liam", "Noah", "Owen", "Ryan"],
    last: ["Bennett", "Campbell", "Cooper", "Davies", "Fraser", "Grant", "Morgan", "Parker", "Reed", "Sullivan", "Turner", "Wilson"]
  },
  arabic: {
    first: ["Adel", "Ahmed", "Amir", "Hassan", "Karim", "Mahmoud", "Nabil", "Omar", "Rami", "Sami", "Tarek", "Youssef"],
    last: ["Abbas", "Alami", "Farouk", "Haddad", "Hassan", "Khalil", "Mansour", "Nasser", "Rahman", "Saleh", "Yassin", "Zaher"]
  },
  eastAsian: {
    first: ["Daichi", "Haru", "Jin", "Jun", "Kaito", "Min-Jae", "Ren", "Riku", "Sota", "Takumi", "Yuto", "Yuya"],
    last: ["Cho", "Ito", "Kim", "Kobayashi", "Lee", "Mori", "Nakamura", "Park", "Sato", "Suzuki", "Tanaka", "Yamada"]
  },
  european: {
    first: ["Adrian", "Andreas", "David", "Dominik", "Jan", "Jonas", "Leon", "Lukas", "Marco", "Martin", "Niklas", "Tomas"],
    last: ["Bauer", "Berger", "Horvat", "Keller", "Kovac", "Novak", "Schmidt", "Steiner", "Svoboda", "Weber", "Wimmer", "Zoric"]
  },
  french: {
    first: ["Abdou", "Aime", "Blaise", "Cheikh", "Ibrahima", "Jean", "Kader", "Mamadou", "Moussa", "Olivier", "Saliou", "Yann"],
    last: ["Ba", "Camara", "Diallo", "Diop", "Fall", "Gueye", "Mendy", "Ndiaye", "Sarr", "Seck", "Sow", "Traore"]
  },
  hispanic: {
    first: ["Alejandro", "Andres", "Carlos", "Diego", "Emiliano", "Francisco", "Javier", "Jose", "Luis", "Mateo", "Rafael", "Santiago"],
    last: ["Alvarez", "Castillo", "Diaz", "Fernandez", "Garcia", "Gomez", "Herrera", "Lopez", "Martinez", "Morales", "Ramirez", "Torres"]
  },
  lusophone: {
    first: ["Andre", "Bruno", "Caio", "Diogo", "Felipe", "Gabriel", "Hugo", "Joao", "Lucas", "Mateus", "Rafael", "Tiago"],
    last: ["Almeida", "Barbosa", "Carvalho", "Costa", "Ferreira", "Gomes", "Lima", "Martins", "Pereira", "Rocha", "Santos", "Silva"]
  },
  african: {
    first: ["Abdul", "Baba", "Daniel", "Emmanuel", "Ibrahim", "Isaac", "Kofi", "Kwame", "Musa", "Samuel", "Seydou", "Yaw"],
    last: ["Addo", "Boateng", "Diarra", "Mensah", "N'Dour", "Nkosi", "Osei", "Quaye", "Sissoko", "Toure", "Yakubu", "Zongo"]
  },
  slavic: {
    first: ["Ante", "Dario", "Ivan", "Josip", "Luka", "Marko", "Mateo", "Milan", "Nikola", "Petar", "Stipe", "Toni"],
    last: ["Babic", "Kovac", "Kralj", "Maric", "Novak", "Peric", "Petrovic", "Popovic", "Radic", "Varga", "Vidic", "Zivkovic"]
  },
  turkic: {
    first: ["Ali", "Arda", "Baris", "Burak", "Can", "Emir", "Hakan", "Kerem", "Mert", "Orkun", "Selim", "Yusuf"],
    last: ["Aydin", "Celik", "Demir", "Erdem", "Kara", "Kaya", "Koc", "Ozturk", "Sahin", "Turan", "Yildiz", "Yilmaz"]
  }
};

const TEAM_DEFINITIONS = [
  { id: "MEX", name: "Mexico", confederation: "Concacaf", group: "A", slot: 1, primary: "#006847", secondary: "#ffffff", strength: 80, culture: "hispanic" },
  { id: "RSA", name: "South Africa", confederation: "CAF", group: "A", slot: 2, primary: "#f7d417", secondary: "#007a4d", strength: 69, culture: "african" },
  { id: "KOR", name: "Korea Republic", confederation: "AFC", group: "A", slot: 3, primary: "#c21f32", secondary: "#ffffff", strength: 77, culture: "eastAsian" },
  { id: "CZE", name: "Czechia", confederation: "UEFA", group: "A", slot: 4, primary: "#d7141a", secondary: "#11457e", strength: 76, culture: "european" },

  { id: "CAN", name: "Canada", confederation: "Concacaf", group: "B", slot: 1, primary: "#e21f26", secondary: "#ffffff", strength: 75, culture: "anglo" },
  { id: "SUI", name: "Switzerland", confederation: "UEFA", group: "B", slot: 2, primary: "#d52b1e", secondary: "#ffffff", strength: 81, culture: "european" },
  { id: "QAT", name: "Qatar", confederation: "AFC", group: "B", slot: 3, primary: "#8a1538", secondary: "#ffffff", strength: 70, culture: "arabic" },
  { id: "BIH", name: "Bosnia and Herzegovina", confederation: "UEFA", group: "B", slot: 4, primary: "#002f6c", secondary: "#f9d616", strength: 74, culture: "slavic" },

  { id: "BRA", name: "Brazil", confederation: "CONMEBOL", group: "C", slot: 1, primary: "#ffdf00", secondary: "#002776", strength: 90, culture: "lusophone" },
  { id: "MAR", name: "Morocco", confederation: "CAF", group: "C", slot: 2, primary: "#c1272d", secondary: "#006233", strength: 82, culture: "arabic" },
  { id: "HAI", name: "Haiti", confederation: "Concacaf", group: "C", slot: 3, primary: "#00209f", secondary: "#d21034", strength: 65, culture: "french" },
  { id: "SCO", name: "Scotland", confederation: "UEFA", group: "C", slot: 4, primary: "#1c2c5b", secondary: "#ffffff", strength: 76, culture: "anglo" },

  { id: "USA", name: "USA", confederation: "Concacaf", group: "D", slot: 1, primary: "#1f3c88", secondary: "#c8102e", strength: 79, culture: "anglo" },
  { id: "PAR", name: "Paraguay", confederation: "CONMEBOL", group: "D", slot: 2, primary: "#d52b1e", secondary: "#0038a8", strength: 73, culture: "hispanic" },
  { id: "AUS", name: "Australia", confederation: "AFC", group: "D", slot: 3, primary: "#ffcd00", secondary: "#00843d", strength: 75, culture: "anglo" },
  { id: "TUR", name: "Turkiye", confederation: "UEFA", group: "D", slot: 4, primary: "#e30a17", secondary: "#ffffff", strength: 78, culture: "turkic" },

  { id: "GER", name: "Germany", confederation: "UEFA", group: "E", slot: 1, primary: "#f7f7f7", secondary: "#151515", strength: 86, culture: "european" },
  { id: "SLV", name: "El Salvador", confederation: "Concacaf", group: "E", slot: 2, primary: "#0047ab", secondary: "#ffffff", strength: 72, culture: "hispanic" },
  { id: "CIV", name: "Cote d'Ivoire", confederation: "CAF", group: "E", slot: 3, primary: "#f77f00", secondary: "#009e60", strength: 79, culture: "french" },
  { id: "ECU", name: "Ecuador", confederation: "CONMEBOL", group: "E", slot: 4, primary: "#ffdd00", secondary: "#034ea2", strength: 80, culture: "hispanic" },

  { id: "NED", name: "Netherlands", confederation: "UEFA", group: "F", slot: 1, primary: "#f36c21", secondary: "#1d2d5c", strength: 86, culture: "european" },
  { id: "JPN", name: "Japan", confederation: "AFC", group: "F", slot: 2, primary: "#003f88", secondary: "#ffffff", strength: 81, culture: "eastAsian" },
  { id: "TUN", name: "Tunisia", confederation: "CAF", group: "F", slot: 3, primary: "#e70013", secondary: "#ffffff", strength: 72, culture: "arabic" },
  { id: "SWE", name: "Sweden", confederation: "UEFA", group: "F", slot: 4, primary: "#ffcd00", secondary: "#005293", strength: 78, culture: "european" },

  { id: "BEL", name: "Belgium", confederation: "UEFA", group: "G", slot: 1, primary: "#ef3340", secondary: "#111111", strength: 84, culture: "european" },
  { id: "EGY", name: "Egypt", confederation: "CAF", group: "G", slot: 2, primary: "#ce1126", secondary: "#ffffff", strength: 77, culture: "arabic" },
  { id: "IRN", name: "IR Iran", confederation: "AFC", group: "G", slot: 3, primary: "#ffffff", secondary: "#239f40", strength: 78, culture: "arabic" },
  { id: "NZL", name: "New Zealand", confederation: "OFC", group: "G", slot: 4, primary: "#f5f5f5", secondary: "#111111", strength: 68, culture: "anglo" },

  { id: "ESP", name: "Spain", confederation: "UEFA", group: "H", slot: 1, primary: "#aa151b", secondary: "#f1bf00", strength: 88, culture: "hispanic" },
  { id: "CPV", name: "Cabo Verde", confederation: "CAF", group: "H", slot: 2, primary: "#003893", secondary: "#ffffff", strength: 66, culture: "lusophone" },
  { id: "KSA", name: "Saudi Arabia", confederation: "AFC", group: "H", slot: 3, primary: "#006c35", secondary: "#ffffff", strength: 72, culture: "arabic" },
  { id: "URU", name: "Uruguay", confederation: "CONMEBOL", group: "H", slot: 4, primary: "#75aadb", secondary: "#111111", strength: 84, culture: "hispanic" },

  { id: "FRA", name: "France", confederation: "UEFA", group: "I", slot: 1, primary: "#1a2f6b", secondary: "#ffffff", strength: 91, culture: "french" },
  { id: "SEN", name: "Senegal", confederation: "CAF", group: "I", slot: 2, primary: "#00853f", secondary: "#fdef42", strength: 80, culture: "french" },
  { id: "NOR", name: "Norway", confederation: "UEFA", group: "I", slot: 3, primary: "#ba0c2f", secondary: "#00205b", strength: 79, culture: "european" },
  { id: "IRQ", name: "Iraq", confederation: "AFC", group: "I", slot: 4, primary: "#007a3d", secondary: "#ffffff", strength: 70, culture: "arabic" },

  { id: "ARG", name: "Argentina", confederation: "CONMEBOL", group: "J", slot: 1, primary: "#75aadb", secondary: "#ffffff", strength: 91, culture: "hispanic" },
  { id: "ALG", name: "Algeria", confederation: "CAF", group: "J", slot: 2, primary: "#ffffff", secondary: "#006233", strength: 78, culture: "arabic" },
  { id: "AUT", name: "Austria", confederation: "UEFA", group: "J", slot: 3, primary: "#ed2939", secondary: "#ffffff", strength: 79, culture: "european" },
  { id: "JOR", name: "Jordan", confederation: "AFC", group: "J", slot: 4, primary: "#ce1126", secondary: "#ffffff", strength: 67, culture: "arabic" },

  { id: "POR", name: "Portugal", confederation: "UEFA", group: "K", slot: 1, primary: "#6a0f21", secondary: "#006600", strength: 87, culture: "lusophone" },
  { id: "UZB", name: "Uzbekistan", confederation: "AFC", group: "K", slot: 2, primary: "#0099b5", secondary: "#ffffff", strength: 69, culture: "turkic" },
  { id: "COL", name: "Colombia", confederation: "CONMEBOL", group: "K", slot: 3, primary: "#fcd116", secondary: "#003893", strength: 83, culture: "hispanic" },
  { id: "COD", name: "Congo DR", confederation: "CAF", group: "K", slot: 4, primary: "#007fff", secondary: "#ce1021", strength: 72, culture: "french" },

  { id: "ENG", name: "England", confederation: "UEFA", group: "L", slot: 1, primary: "#ffffff", secondary: "#1c2c5b", strength: 88, culture: "anglo" },
  { id: "CRO", name: "Croatia", confederation: "UEFA", group: "L", slot: 2, primary: "#f00f21", secondary: "#ffffff", strength: 82, culture: "slavic" },
  { id: "GHA", name: "Ghana", confederation: "CAF", group: "L", slot: 3, primary: "#ffffff", secondary: "#111111", strength: 75, culture: "african" },
  { id: "PAN", name: "Panama", confederation: "Concacaf", group: "L", slot: 4, primary: "#d21034", secondary: "#ffffff", strength: 68, culture: "hispanic" }
];

function createStats(team, name, position, index) {
  const random = createSeededRandom(`${team.id}:${name}:${position}:${index}`);
  const profile = POSITION_PROFILES[position] ?? POSITION_PROFILES.CM;
  const stat = (baseOffset, spread = 15) =>
    clamp(Math.round(team.strength + baseOffset + (random() - 0.5) * spread), 35, 99);
  const roleBoost = position === "RW" || position === "LW" ? 2 : position === "ST" ? 1 : position === "CM" ? 0 : -1;
  const eliteBoost = ["ARG", "BRA", "FRA", "ESP", "POR", "ENG"].includes(team.id) ? 1 : 0;

  if (team.id === "SLV" && name === "Mateo Ceren") {
    return {
      speed: 94,
      shooting: 90,
      passing: 88,
      defending: 55,
      stamina: 91,
      skillMoves: 5
    };
  }

  return {
    speed: stat(profile.speed),
    shooting: stat(profile.shooting),
    passing: stat(profile.passing),
    defending: stat(profile.defending),
    stamina: stat(profile.stamina),
    skillMoves: clamp(Math.round(2 + roleBoost + eliteBoost + (team.strength >= 86 ? 1 : 0) + (random() - 0.5) * 1.35), 1, 5)
  };
}

function generatedNames(team) {
  const pool = NAME_POOLS[team.culture] ?? NAME_POOLS.european;
  const random = createSeededRandom(`${team.id}:names`);
  const used = new Set();

  return POSITIONS.map((_, index) => {
    let name = `${pick(random, pool.first)} ${pick(random, pool.last)}`;
    if (used.has(name)) {
      name = `${name} ${String.fromCharCode(65 + index)}`;
    }
    used.add(name);
    return name;
  });
}

function createRoster(team) {
  const names = TOP_ROSTERS[team.id] ?? generatedNames(team);
  return names.map((name, index) => {
    const position = POSITIONS[index];
    return {
      id: `${team.id}-${index + 1}`,
      teamId: team.id,
      number: index + 1,
      name,
      position,
      isStar: team.id === "SLV" && name === "Mateo Ceren",
      ...createStats(team, name, position, index)
    };
  });
}

export const TEAMS = TEAM_DEFINITIONS.map((team) => ({
  ...team,
  players: createRoster(team)
}));

export const TEAM_BY_ID = new Map(TEAMS.map((team) => [team.id, team]));

export const GROUPS = Array.from(new Set(TEAMS.map((team) => team.group))).map((group) => ({
  id: group,
  name: `Group ${group}`,
  teamIds: TEAMS
    .filter((team) => team.group === group)
    .sort((a, b) => a.slot - b.slot)
    .map((team) => team.id)
}));

export function getTeamById(id) {
  return TEAM_BY_ID.get(id);
}
