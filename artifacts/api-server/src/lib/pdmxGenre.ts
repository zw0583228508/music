/**
 * Genre families over PDMX metadata (Wave Q — Model Discovery, global tournament).
 *
 * PDMX publishes three free-text columns that say what a score *is*:
 *
 *  - `genres` — MuseScore's own genre slugs, hyphen-joined (`rock-pop`,
 *    `classical-soundtrack`, `rbfunksoul`). Present on ~62 % of the admitted
 *    multitrack rows.
 *  - `tags` — uploader tags, hyphen-joined, free text (`jazz-bossanova`,
 *    `halo-odst-rain-videogame-soundtrack`).
 *  - `groups` — MuseScore community groups, hyphen-joined (`videogameandanimemusic`).
 *
 * This module folds those into a small, fixed set of **genre families** the
 * tournament can target, and says where each label came from. Two rules keep
 * it honest:
 *
 *  1. A family is only ever *added* by evidence in the row; a row with no
 *     usable label is `unlabelled`, never guessed from its instruments or title.
 *  2. Latin and musical theatre have no MuseScore genre slug at all; they can
 *     only come from tags, and the profile says so.
 *
 * Nothing here decides rights. Admission is `pdmxIngest.ts` and the authors'
 * `no_license_conflict` subset, exactly as before.
 */

export const GENRE_FAMILIES = [
  "pop", "rock", "metal", "jazz", "blues", "folk", "country", "film_game", "electronic",
  "hiphop", "rnb_funk_soul", "reggae_ska", "latin", "world_traditional", "religious_worship",
  "musical_theatre", "wind_band_marching", "classical", "experimental_other", "unlabelled",
] as const;
export type GenreFamily = (typeof GENRE_FAMILIES)[number];

export type GenreLabelSource = "genres" | "tags" | "none";

export type PdmxGenre = {
  /** Every family the row's labels support, in priority order (see `GENRE_FAMILIES`). */
  families: GenreFamily[];
  /** The first family from the `genres` column when it has one, else from tags, else `unlabelled`. */
  primary: GenreFamily;
  source: GenreLabelSource;
  /** The raw `genres` cell, when present. */
  genres?: string;
  /** Tag and group tokens as published, lower-cased; capped so a report stays readable. */
  tags: string[];
};

/** MuseScore genre slug → family. The slugs are the ones the real table uses. */
export const GENRE_SLUG_FAMILY: Readonly<Record<string, GenreFamily>> = {
  classical: "classical",
  soundtrack: "film_game",
  folk: "folk",
  rock: "rock",
  pop: "pop",
  jazz: "jazz",
  rbfunksoul: "rnb_funk_soul",
  religiousmusic: "religious_worship",
  electronic: "electronic",
  hiphop: "hiphop",
  worldmusic: "world_traditional",
  metal: "metal",
  country: "country",
  disco: "electronic",
  reggaeska: "reggae_ska",
  blues: "blues",
  newage: "experimental_other",
  comedy: "experimental_other",
  experimental: "experimental_other",
};

/**
 * Tag/group tokens that name a family. Exact token match only, so `rock` does
 * not fire on `rockymountainhigh` and `mass` cannot fire on `massachusetts`.
 * Artist names are deliberately absent: a Toto arrangement for trumpet
 * ensemble is a rock *source*, not necessarily a rock *arrangement*.
 */
export const TAG_TOKEN_FAMILY: Readonly<Record<string, GenreFamily>> = {
  // film / game / anime
  videogame: "film_game", videogames: "film_game", videogamemusic: "film_game", videogameandanimemusic: "film_game",
  filmsandgamesmusics: "film_game", musicforamovie: "film_game", videogamemoviecomposers: "film_game",
  originalvideogamemusicyoucomposed: "film_game", nintendo: "film_game", nintendosheetmusic: "film_game",
  zelda: "film_game", legendofzelda: "film_game", pokemon: "film_game", undertale: "film_game", anime: "film_game",
  disney: "film_game", soundtrack: "film_game", ost: "film_game", movie: "film_game", film: "film_game",
  filmmusic: "film_game", gamemusic: "film_game", halo: "film_game", mario: "film_game", ghibli: "film_game",
  // musical theatre — no MuseScore slug; tags only
  musical: "musical_theatre", musicals: "musical_theatre", broadway: "musical_theatre", showtune: "musical_theatre",
  showtunes: "musical_theatre", lesmiserables: "musical_theatre", hamilton: "musical_theatre", sondheim: "musical_theatre",
  lloydwebber: "musical_theatre", operetta: "musical_theatre",
  // latin — no MuseScore slug; tags only
  latin: "latin", latino: "latin", bossanova: "latin", bossa: "latin", samba: "latin", tango: "latin", salsa: "latin",
  choro: "latin", rhumba: "latin", rumba: "latin", cumbia: "latin", mariachi: "latin", flamenco: "latin", bolero: "latin",
  merengue: "latin", bachata: "latin", brazilianmusic: "latin", folklorevenezolano: "latin", cavaquinho: "latin",
  funkcarioca: "latin", reggaeton: "latin",
  // jazz
  jazz: "jazz", bigband: "jazz", swing: "jazz", dixieland: "jazz", bebop: "jazz", jazzband: "jazz", jazzensemble: "jazz",
  ragtime: "jazz",
  // religious / worship
  hymn: "religious_worship", hymns: "religious_worship", worship: "religious_worship", gospel: "religious_worship",
  christian: "religious_worship", church: "religious_worship", sacred: "religious_worship", praise: "religious_worship",
  praiseandworship: "religious_worship", christmascarol: "religious_worship", carol: "religious_worship",
  // world / traditional
  klezmer: "world_traditional", jewish: "world_traditional", celtic: "world_traditional", celticmusic: "world_traditional",
  irish: "world_traditional", scottish: "world_traditional", african: "world_traditional", arabic: "world_traditional",
  chinese: "world_traditional", indian: "world_traditional", balkan: "world_traditional", turkish: "world_traditional",
  greek: "world_traditional", traditional: "world_traditional", folklore: "world_traditional", mizrahi: "world_traditional",
  gamelan: "world_traditional", polka: "world_traditional", ukrainianchristmascarol: "world_traditional",
  // rock / metal / pop / electronic / hiphop / soul / country / blues / folk / reggae
  rock: "rock", classicrock: "rock", punk: "rock", grunge: "rock", indie: "rock", hardrock: "rock", poprock: "rock",
  metal: "metal", heavymetal: "metal", metalcore: "metal",
  pop: "pop", kpop: "pop", jpop: "pop",
  electronic: "electronic", electro: "electronic", edm: "electronic", techno: "electronic", house: "electronic",
  trance: "electronic", dubstep: "electronic", synthwave: "electronic", chiptune: "electronic", disco: "electronic",
  hiphop: "hiphop", rap: "hiphop", trap: "hiphop",
  funk: "rnb_funk_soul", soul: "rnb_funk_soul", rnb: "rnb_funk_soul", motown: "rnb_funk_soul",
  country: "country", countrywestern: "country", bluegrass: "country",
  blues: "blues",
  folk: "folk", folksong: "folk", shanty: "folk", seashanty: "folk",
  reggae: "reggae_ska", ska: "reggae_ska",
  // wind band / marching — a real idiom outside the concert hall
  marchingband: "wind_band_marching", concertband: "wind_band_marching", drumline: "wind_band_marching",
  dci: "wind_band_marching", pepband: "wind_band_marching", windband: "wind_band_marching", brassband: "wind_band_marching",
  marchingpercussion: "wind_band_marching", drumcorps: "wind_band_marching",
  // classical — tags that name a form or an era, not a composer
  classical: "classical", baroque: "classical", renaissance: "classical", romantic: "classical", opera: "classical",
  symphony: "classical", sonata: "classical", fugue: "classical", concerto: "classical", requiem: "classical",
  madrigal: "classical", oratorio: "classical", cantata: "classical", motet: "classical", chorale: "classical",
  counterpointandfugue: "classical", stringquartet: "classical", classicalmusic: "classical",
};

/** How many tag tokens a task record keeps. */
export const MAX_TAGS_KEPT = 12;

/** The hyphen-joined lists PDMX uses; `NA` and blanks are no list at all. */
export function parsePdmxList(cell: string | undefined): string[] {
  const trimmed = cell?.trim();
  if (!trimmed || trimmed === "NA") return [];
  return trimmed.split(/[-,]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
}

const FAMILY_RANK = new Map<GenreFamily, number>(GENRE_FAMILIES.map((f, i) => [f, i]));

/**
 * Classify one row. `genres` decides the primary family when it carries any
 * known slug; tags and groups can add families (and are the only source for
 * latin and musical theatre) but never override an explicit genre.
 */
export function classifyPdmxGenre(row: { genres?: string; tags?: string; groups?: string }): PdmxGenre {
  const slugs = parsePdmxList(row.genres);
  const fromGenres: GenreFamily[] = [];
  for (const slug of slugs) {
    const family = GENRE_SLUG_FAMILY[slug];
    if (family && !fromGenres.includes(family)) fromGenres.push(family);
  }
  const tokens = [...parsePdmxList(row.tags), ...parsePdmxList(row.groups)];
  const fromTags: GenreFamily[] = [];
  for (const token of tokens) {
    const family = TAG_TOKEN_FAMILY[token];
    if (family && !fromTags.includes(family)) fromTags.push(family);
  }
  fromTags.sort((a, b) => (FAMILY_RANK.get(a) ?? 99) - (FAMILY_RANK.get(b) ?? 99));

  const families: GenreFamily[] = [...fromGenres];
  for (const family of fromTags) if (!families.includes(family)) families.push(family);
  const source: GenreLabelSource = fromGenres.length ? "genres" : fromTags.length ? "tags" : "none";
  if (!families.length) families.push("unlabelled");
  const tags = [...new Set(tokens)].slice(0, MAX_TAGS_KEPT);
  return {
    families,
    primary: families[0],
    source,
    ...(slugs.length ? { genres: row.genres!.trim() } : {}),
    tags,
  };
}

export type GenreFilter = {
  /** Keep a work only if one of its families is listed. Empty = any. */
  include?: readonly string[];
  /** Drop a work if any of its families is listed. */
  exclude?: readonly string[];
};

/** Why a family name from the command line is not one, or null. */
export function genreFamilyRefusal(name: string): string | null {
  return (GENRE_FAMILIES as readonly string[]).includes(name)
    ? null
    : `"${name}" is not a genre family; known: ${GENRE_FAMILIES.join(", ")}`;
}

/** Whether a classified work passes the filter. */
export function matchesGenreFilter(genre: Pick<PdmxGenre, "families">, filter: GenreFilter): boolean {
  if (filter.exclude?.some((f) => genre.families.includes(f as GenreFamily))) return false;
  if (filter.include?.length) return filter.include.some((f) => genre.families.includes(f as GenreFamily));
  return true;
}

/**
 * Instrument targets as a producer names them → the tournament's target
 * families (`TARGET_FAMILIES` in `tournamentTask.ts`). The tournament family
 * names are accepted as-is, so `--families reed,pipe` still works.
 */
export const INSTRUMENT_TARGET_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  drums: ["drums"], percussion: ["drums"], bass: ["bass"], guitar: ["guitar"],
  keys: ["keys"], piano: ["keys"], "piano/keys": ["keys"], organ: ["organ"], synth: ["synth"],
  strings: ["strings"], ensemble: ["ensemble"], brass: ["brass"],
  woodwinds: ["reed", "pipe"], winds: ["reed", "pipe"], reed: ["reed"], pipe: ["pipe"],
};

/** Expand producer-facing instrument names to target families, refusing unknown names. */
export function expandInstrumentTargets(names: readonly string[]): { families: string[] } | { refusal: string } {
  const families: string[] = [];
  for (const raw of names) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    const expanded = INSTRUMENT_TARGET_FAMILIES[name];
    if (!expanded) return { refusal: `"${raw}" is not an instrument target; known: ${Object.keys(INSTRUMENT_TARGET_FAMILIES).join(", ")}` };
    for (const family of expanded) if (!families.includes(family)) families.push(family);
  }
  return { families };
}
