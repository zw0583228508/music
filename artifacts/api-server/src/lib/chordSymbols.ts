/**
 * The one chord-symbol parser (Brain B-02, D1).
 *
 * The audit counted twelve chord parsers in this package, with three root
 * tables and no two agreeing on `Gsus4`, `C/E`, `Cm7b5` or `Cdim7`. This
 * module is the reading every harmony decision the brain makes goes through;
 * the analysis engine's `harmonyEngine.parseChordSymbol` adapts onto it, and
 * the remaining callers are listed for migration in the B-02 tracker entry.
 *
 * It is deliberately dependency-free (no `harmonyEngine` import) so the
 * analysis side can import it without a cycle.
 *
 * What it reads: roots with either accidental spelling (`Eb`, `D#`, `E♭`,
 * double accidentals folded), triads (major, minor, diminished, augmented),
 * power chords, `sus2` / `sus4` / `7sus4`, sixths (`6`, `m6`, `69`), sevenths
 * (`7`, `maj7` / `M7` / `Δ`, `m7`, `mMaj7`, `dim7` / `o7`, `m7b5` / `ø`,
 * `aug7`), extensions (`9`, `11`, `13`, `maj9`, `m11`, …), alterations
 * (`b5`, `#5`, `b9`, `#9`, `#11`, `b13`, `alt`), `add` tones, omissions
 * (`no3`, `omit5`), MIREX `C:maj7` / `C:maj/3` and slash basses. `N`, `X`,
 * `N.C.` and anything unreadable are `null` — an unparsed symbol is dropped,
 * never guessed at.
 *
 * A chord is what it contains, not how it was spelled: `Cadd2` and `Cadd9`
 * are one chord and format to one symbol; `C6/9` and `C69` likewise.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** ASCII spelling the Song Model stores (the same table `harmonyEngine` prints). */
export const ROOT_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export type TriadQuality = "maj" | "min" | "dim" | "aug" | "sus4" | "sus2" | "power";
export type SeventhKind = "min7" | "maj7" | "dim7";
export type ChordToneRole =
  | "root" | "third" | "fifth" | "seventh" | "sixth" | "ninth" | "eleventh" | "thirteenth" | "suspension";

/**
 * The template vocabulary the analysis engine scores chroma against. Kept
 * here as the literal union so `harmonyEngine.HarmonyQuality` can be this
 * type without importing anything back.
 */
export type TemplateQuality =
  | "maj" | "min" | "dim" | "aug"
  | "sus4" | "sus2"
  | "maj6" | "min6"
  | "dom7" | "maj7" | "min7" | "m7b5" | "dim7" | "minMaj7"
  | "add9" | "dom9" | "maj9" | "min9";

export type ParsedChord = {
  /** Pitch class of the root. */
  root: number;
  /** Root as the platform spells it (`Eb`, never `D#`, for pitch class 3). */
  rootName: string;
  triad: TriadQuality;
  seventh: SeventhKind | null;
  /** True when a major sixth above the root is part of the chord. */
  sixth: boolean;
  /** Extension degrees present (9, 11, 13), natural or altered. */
  extensions: number[];
  /** Alterations: `b5`, `#5`, `b9`, `#9`, `#11`, `b13`, in that order. */
  alterations: string[];
  /** Omitted degrees: 3 or 5. */
  omits: number[];
  /** Pitch class of the lowest note (the root when no slash / canonical bass names another). */
  bass: number;
  bassName: string;
  /** Semitones above the root, sorted; extensions sit above the octave (9 = 14, …). */
  intervals: number[];
  /** Distinct pitch classes in tone order: root, third, fifth, seventh, sixth, 9, 11, 13. */
  pitchClasses: number[];
  /** Pitch class → role, for doubling rules. */
  roles: Map<number, ChordToneRole>;
  /** The analysis template this chord reduces to. */
  template: TemplateQuality;
  /** The symbol as written. */
  input: string;
  /** Canonical spelling; `parseChord(symbol)` reads it back to the same chord. */
  symbol: string;
};

/** Optional canonical fields of a Song Model chord event, laid over the symbol. */
export type ChordFields = {
  root?: string | null;
  quality?: string | null;
  bass?: string | null;
  extensions?: string[] | null;
  alterations?: string[] | null;
};

const pc = (v: number): number => ((v % 12) + 12) % 12;

const normaliseText = (text: string): string =>
  text.replace(/♯/g, "#").replace(/♭/g, "b").replace(/𝄪/g, "##").replace(/△/g, "Δ").trim();

/** Pitch class of a note name, or null. Both accidental spellings, doubles folded. */
export function parsePitchClass(token: string): number | null {
  const m = /^([A-Ga-g])([#b]{0,2})$/.exec(normaliseText(token));
  if (!m) return null;
  let value = LETTER_PC[m[1].toUpperCase()];
  for (const accidental of m[2]) value += accidental === "#" ? 1 : -1;
  return pc(value);
}

const NO_CHORD = new Set(["", "N", "X", "NC", "N.C.", "N.C", "-", "%"]);

// ---------------------------------------------------------------------------
// The grammar
// ---------------------------------------------------------------------------

type Draft = {
  triad: TriadQuality;
  seventh: SeventhKind | null;
  sixth: boolean;
  extensions: Set<number>;
  alterations: Set<string>;
  omits: number[];
};

const emptyDraft = (): Draft => ({ triad: "maj", seventh: null, sixth: false, extensions: new Set(), alterations: new Set(), omits: [] });

/** The chord-family head of a quality token, in match order. Longer spellings first. */
const HEADS: Array<[RegExp, (d: Draft) => "maj7" | "dom" | null]> = [
  // minor-major sevenths (the Δ / M marker applies to the seventh)
  [/^(mMaj|mmaj|minMaj|minmaj|min-maj|m\(maj|min\(maj|-Δ|mΔ|mM)/, (d) => { d.triad = "min"; return "maj7"; }],
  // half-diminished
  [/^(m7b5|min7b5|-7b5|ø7|ø|hdim7|hdim|halfdim7|halfdim|half-dim7|half-dim)/, (d) => { d.triad = "dim"; d.seventh = "min7"; return null; }],
  // diminished
  [/^(dim7|o7|°7)/, (d) => { d.triad = "dim"; d.seventh = "dim7"; return null; }],
  [/^(dim|°|o(?![a-z]))/, (d) => { d.triad = "dim"; return null; }],
  // augmented (`+5` is the same as `+`)
  [/^(aug|\+5|\+)/, (d) => { d.triad = "aug"; return null; }],
  // dominant spelled out
  [/^(dominant|dom)/, () => "dom"],
  // major (the marker: `maj7` / `M7` / `Δ7` / `Δ` are major sevenths; `maj` / `M` alone a major triad)
  [/^(major|maj|Ma(?=\d)|M(?![a-z])|Δ|j(?=\d))/, () => "maj7"],
  // minor
  [/^(minor|min|m(?!aj)|-)/, (d) => { d.triad = "min"; return null; }],
  // suspensions as the head (`sus4`, `sus`, `sus2`); `7sus4` arrives through the number then the suffix loop
  [/^sus2/, (d) => { d.triad = "sus2"; return null; }],
  [/^(sus4|sus)/, (d) => { d.triad = "sus4"; return null; }],
];

/**
 * Reads the quality token (everything between the root and the slash). Null
 * for a token that is not chord vocabulary, so the symbol is refused as a
 * whole rather than read as a major triad with junk after it.
 */
function readQuality(tokenIn: string): Draft | null {
  const draft = emptyDraft();
  let token = tokenIn.replace(/[()]/g, "").replace(/,/g, "").trim();
  if (token === "") return draft;
  if (token === "5") { draft.triad = "power"; return draft; }

  // 1. Head.
  let marker: "maj7" | "dom" | null = null;
  let headText = "";
  for (const [re, apply] of HEADS) {
    const m = re.exec(token);
    if (!m) continue;
    headText = m[0];
    token = token.slice(m[0].length);
    marker = apply(draft);
    break;
  }

  // 2. The number.
  const number = /^(69|6|7|9|11|13)/.exec(token);
  if (number) {
    token = token.slice(number[0].length);
    const seventh = (): SeventhKind => draft.seventh ?? (marker === "maj7" ? "maj7" : "min7");
    switch (number[0]) {
      case "6": draft.sixth = true; break;
      case "69": draft.sixth = true; draft.extensions.add(9); break;
      case "7": draft.seventh = seventh(); break;
      case "9": draft.seventh = seventh(); draft.extensions.add(9); break;
      case "11": draft.seventh = seventh(); draft.extensions.add(9); draft.extensions.add(11); break;
      case "13": draft.seventh = seventh(); draft.extensions.add(9); draft.extensions.add(13); break;
      default: break;
    }
  } else if (marker === "maj7" && (headText === "Δ" || draft.triad === "min")) {
    // `CΔ` alone is a major seventh by convention; `CmMaj` without a number is a minor-major seventh.
    draft.seventh = draft.seventh ?? "maj7";
  } else if (marker === "dom") {
    draft.seventh = draft.seventh ?? "min7";
  }

  // 3. Suffixes in any order.
  let guard = 0;
  while (token.length && guard < 16) {
    guard += 1;
    let m: RegExpExecArray | null;
    if ((m = /^sus2/.exec(token))) { draft.triad = "sus2"; token = token.slice(m[0].length); continue; }
    if ((m = /^(sus4|sus)/.exec(token))) { draft.triad = "sus4"; token = token.slice(m[0].length); continue; }
    if ((m = /^(add|Add)(b9|#9|#11|b13|2|4|6|9|11|13)/.exec(token))) {
      const written = m[2];
      const degree = Number(written.replace(/^[b#]/, ""));
      if (/^[b#]/.test(written)) draft.alterations.add(written);
      if (degree === 2 || degree === 9) draft.extensions.add(9);
      else if (degree === 4 || degree === 11) draft.extensions.add(11);
      else if (degree === 6) draft.sixth = true;
      else if (degree === 13) draft.extensions.add(13);
      token = token.slice(m[0].length);
      continue;
    }
    if ((m = /^(omit|no)(3|5)/.exec(token))) { if (!draft.omits.includes(Number(m[2]))) draft.omits.push(Number(m[2])); token = token.slice(m[0].length); continue; }
    if ((m = /^alt(ered)?/.exec(token))) {
      draft.seventh = draft.seventh ?? "min7";
      for (const a of ["b9", "#9", "b13"]) draft.alterations.add(a);
      draft.extensions.add(9);
      draft.extensions.add(13);
      token = token.slice(m[0].length);
      continue;
    }
    if ((m = /^([b#+-])(5|9|11|13)/.exec(token))) {
      const sign = m[1] === "+" ? "#" : m[1] === "-" ? "b" : m[1];
      const degree = Number(m[2]);
      draft.alterations.add(`${sign}${degree}`);
      if (degree !== 5) {
        draft.extensions.add(degree);
        // A written altered extension on a bare triad implies the seventh (`Cb9` is read as `C7b9`).
        if (draft.seventh === null && !draft.sixth) draft.seventh = "min7";
      }
      token = token.slice(m[0].length);
      continue;
    }
    if ((m = /^(Maj7|maj7|Ma7|M7|Δ7|Δ)/.exec(token))) { draft.seventh = "maj7"; token = token.slice(m[0].length); continue; }
    if ((m = /^(7|9|11|13)/.exec(token))) {
      const n = Number(m[1]);
      draft.seventh = draft.seventh ?? "min7";
      if (n >= 9) draft.extensions.add(9);
      if (n === 11) draft.extensions.add(11);
      if (n === 13) draft.extensions.add(13);
      token = token.slice(m[0].length);
      continue;
    }
    return null;
  }
  return token.length ? null : draft;
}

// ---------------------------------------------------------------------------
// Draft → chord
// ---------------------------------------------------------------------------

const THIRD: Record<TriadQuality, number | null> = { maj: 4, min: 3, dim: 3, aug: 4, sus4: 5, sus2: 2, power: null };
const FIFTH: Record<TriadQuality, number> = { maj: 7, min: 7, dim: 6, aug: 8, sus4: 7, sus2: 7, power: 7 };
const SEVENTH: Record<SeventhKind, number> = { min7: 10, maj7: 11, dim7: 9 };
const ALTERATION_RANK: Record<string, number> = { b5: 0, "#5": 1, b9: 2, "#9": 3, "#11": 4, b13: 5 };
const alterationOrder = (a: string, b: string) => (ALTERATION_RANK[a] ?? 9) - (ALTERATION_RANK[b] ?? 9);

function realise(root: number, draft: Draft, bass: number, input: string): ParsedChord {
  const has = (a: string) => draft.alterations.has(a);
  // A diminished triad's b5 and an augmented triad's #5 are not alterations.
  const alterations = [...draft.alterations]
    .filter((a) => !(a === "b5" && draft.triad === "dim") && !(a === "#5" && draft.triad === "aug"))
    .sort(alterationOrder);
  const order: Array<[number, ChordToneRole]> = [[0, "root"]];
  const third = THIRD[draft.triad];
  if (third !== null && !draft.omits.includes(3)) {
    order.push([third, draft.triad === "sus4" || draft.triad === "sus2" ? "suspension" : "third"]);
  }
  let fifth: number | null = FIFTH[draft.triad];
  if (has("b5")) fifth = 6;
  if (has("#5")) fifth = 8;
  if (draft.omits.includes(5)) fifth = null;
  if (fifth !== null) order.push([fifth, "fifth"]);
  if (draft.seventh) order.push([SEVENTH[draft.seventh], "seventh"]);
  if (draft.sixth) order.push([9, "sixth"]);
  const extensions = [...draft.extensions].sort((a, b) => a - b);
  for (const degree of extensions) {
    if (degree === 9) {
      if (has("b9")) order.push([13, "ninth"]);
      if (has("#9")) order.push([15, "ninth"]);
      if (!has("b9") && !has("#9")) order.push([14, "ninth"]);
    }
    if (degree === 11) order.push([has("#11") ? 18 : 17, "eleventh"]);
    if (degree === 13) order.push([has("b13") ? 20 : 21, "thirteenth"]);
  }

  const intervals: number[] = [];
  const pitchClasses: number[] = [];
  const roles = new Map<number, ChordToneRole>();
  for (const [interval, role] of order) {
    if (!intervals.includes(interval)) intervals.push(interval);
    const klass = pc(root + interval);
    if (!pitchClasses.includes(klass)) pitchClasses.push(klass);
    if (!roles.has(klass)) roles.set(klass, role);
  }
  intervals.sort((a, b) => a - b);

  const chord: ParsedChord = {
    root, rootName: ROOT_NAMES[root],
    triad: draft.triad, seventh: draft.seventh, sixth: draft.sixth,
    extensions, alterations, omits: [...draft.omits].sort((a, b) => a - b),
    bass, bassName: ROOT_NAMES[bass],
    intervals, pitchClasses, roles,
    template: templateOf(draft),
    input, symbol: "",
  };
  chord.symbol = formatChord(chord);
  return chord;
}

/** The analysis template nearest to the chord (a natural ninth, or anything above it, folds onto the ninth template). */
function templateOf(draft: Draft): TemplateQuality {
  const naturalNinth = draft.extensions.has(9) && !draft.alterations.has("b9") && !draft.alterations.has("#9");
  switch (draft.triad) {
    case "dim":
      return draft.seventh === "dim7" ? "dim7" : draft.seventh === "min7" ? "m7b5" : "dim";
    case "aug":
      return "aug";
    case "sus4":
      return "sus4";
    case "sus2":
      return "sus2";
    case "power":
      return "maj";
    case "min":
      if (draft.seventh === "maj7") return "minMaj7";
      if (draft.seventh === "min7") return naturalNinth ? "min9" : "min7";
      if (draft.sixth) return "min6";
      return "min";
    case "maj":
    default:
      if (draft.seventh === "maj7") return naturalNinth ? "maj9" : "maj7";
      if (draft.seventh === "min7") return naturalNinth ? "dom9" : "dom7";
      if (draft.sixth) return "maj6";
      if (naturalNinth) return "add9";
      return "maj";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a chord symbol. `fields` are the Song Model's canonical chord fields;
 * when present they refine the symbol: a canonical `bass` is an inversion the
 * symbol may not spell, a canonical `quality` fills an empty suffix, canonical
 * `extensions` / `alterations` are added. A written suffix or slash wins over
 * a canonical field that disagrees with it.
 */
export function parseChord(symbolIn: string, fields?: ChordFields | null): ParsedChord | null {
  const raw = normaliseText(symbolIn ?? "");
  if (NO_CHORD.has(raw.toUpperCase())) return null;
  const rootMatch = /^([A-Ga-g])([#b]{0,2})/.exec(raw);
  if (!rootMatch) return null;
  let root = LETTER_PC[rootMatch[1].toUpperCase()];
  for (const accidental of rootMatch[2]) root += accidental === "#" ? 1 : -1;
  root = pc(root);
  let rest = raw.slice(rootMatch[0].length).replace(/^:/, "");

  // Slash: a bass note, a MIREX degree (`/3`, `/5`, `/7`), or the `6/9` idiom.
  let bassToken: string | null = null;
  const slash = rest.indexOf("/");
  if (slash >= 0) {
    bassToken = rest.slice(slash + 1).trim();
    rest = rest.slice(0, slash);
    if (/^m?6$/.test(rest.trim()) && bassToken === "9") { rest = `${rest.trim()}9`; bassToken = null; }
  }
  rest = rest.trim();
  let draft = readQuality(rest);
  if (!draft) return null;

  if (fields?.root) {
    const canonicalRoot = parsePitchClass(fields.root);
    if (canonicalRoot !== null) root = canonicalRoot;
  }
  if (fields?.quality && rest === "") {
    const fromQuality = readQuality(normaliseQualityWord(fields.quality));
    if (fromQuality) draft = fromQuality;
  }
  for (const extension of fields?.extensions ?? []) {
    const m = /^(add)?(b|#)?(6|9|11|13)$/.exec(String(extension).trim());
    if (!m) continue;
    const degree = Number(m[3]);
    if (degree === 6) { draft.sixth = true; continue; }
    draft.extensions.add(degree);
    if (m[2]) draft.alterations.add(`${m[2]}${degree}`);
    if (!m[1] && draft.seventh === null && !draft.sixth) draft.seventh = "min7";
  }
  for (const alteration of fields?.alterations ?? []) {
    const m = /^(b|#|\+|-)(5|9|11|13)$/.exec(String(alteration).trim());
    if (!m) continue;
    const sign = m[1] === "+" ? "#" : m[1] === "-" ? "b" : m[1];
    draft.alterations.add(`${sign}${m[2]}`);
    if (Number(m[2]) !== 5) draft.extensions.add(Number(m[2]));
  }

  let bass = root;
  if (bassToken !== null) {
    const named = parsePitchClass(bassToken);
    if (named !== null) bass = named;
    else if (/^\d+$/.test(bassToken)) {
      // MIREX degree form: the chord's own third / fifth / seventh.
      const probe = realise(root, draft, root, raw);
      const degree = Number(bassToken);
      const interval = degree === 3 ? probe.intervals.find((i) => i >= 2 && i <= 5) ?? 0
        : degree === 5 ? probe.intervals.find((i) => i >= 6 && i <= 8) ?? 0
          : degree === 7 ? probe.intervals.find((i) => i >= 9 && i <= 11) ?? 0
            : 0;
      bass = pc(root + interval);
    } else {
      return null;
    }
  } else if (fields?.bass) {
    const canonicalBass = parsePitchClass(fields.bass);
    if (canonicalBass !== null) bass = canonicalBass;
  }
  return realise(root, draft, bass, symbolIn);
}

/** `min` → `m`, `dom7` → `7`, `maj` → ``; other quality words pass through to the grammar. */
function normaliseQualityWord(quality: string): string {
  const q = quality.trim();
  const table: Record<string, string> = {
    maj: "", major: "", min: "m", minor: "m", dom7: "7", dom: "7", dom9: "9", maj6: "6", min6: "m6",
    min7: "m7", min9: "m9", minMaj7: "mMaj7", hdim7: "m7b5",
  };
  return table[q] ?? q;
}

/** Parse a Song Model chord event (symbol + canonical fields). */
export function chordFromEvent(event: { symbol: string } & ChordFields): ParsedChord | null {
  return parseChord(event.symbol, event);
}

/** Pitch classes of a chord event, root first; `[]` when unreadable. */
export function chordPitchClassesOf(event: { symbol: string } & ChordFields): number[] {
  return chordFromEvent(event)?.pitchClasses ?? [];
}

/**
 * Canonical spelling. Root position omits the slash. Reads back to the same
 * chord (`parseChord(formatChord(c))` equals `c` on every field but `input`).
 */
export function formatChord(chord: Pick<ParsedChord, "root" | "triad" | "seventh" | "sixth" | "extensions" | "alterations" | "omits" | "bass">): string {
  const altered = new Set(chord.alterations);
  const ext = new Set(chord.extensions);
  const natural = (degree: number): boolean => ext.has(degree) &&
    !(degree === 9 && (altered.has("b9") || altered.has("#9"))) &&
    !(degree === 11 && altered.has("#11")) &&
    !(degree === 13 && altered.has("b13"));
  const naturals = [9, 11, 13].filter(natural);
  // The chain a number names: 9 = 7-9, 11 = 7-9-11, 13 = 7-9-13 (the 11 omitted by convention).
  const chain = natural(9) ? (natural(13) ? 13 : natural(11) ? 11 : 9) : null;
  const hasSeventh = chord.seventh !== null;
  const plainTriad = chord.triad === "maj" || chord.triad === "min";
  const sixtyNine = chord.sixth && !hasSeventh && plainTriad && naturals.length === 1 && naturals[0] === 9;
  // Degrees the head names; every other natural extension is an `add`.
  let named: number[] = [];
  const seventhNumber = (): string => {
    if (chain === null) return "7";
    named = chain === 9 ? [9] : [9, chain];
    return String(chain);
  };
  let suffix = "";
  switch (chord.triad) {
    case "power": suffix = "5"; break;
    case "maj":
      if (chord.seventh === "maj7") suffix = `maj${seventhNumber()}`;
      else if (chord.seventh === "min7") suffix = seventhNumber();
      else if (chord.seventh === "dim7") suffix = "7(dim7)";
      else if (chord.sixth) { suffix = sixtyNine ? "69" : "6"; if (sixtyNine) named = [9]; }
      break;
    case "min":
      if (chord.seventh === "maj7") suffix = `mMaj${seventhNumber()}`;
      else if (chord.seventh === "min7") suffix = `m${seventhNumber()}`;
      else if (chord.sixth) { suffix = sixtyNine ? "m69" : "m6"; if (sixtyNine) named = [9]; }
      else suffix = "m";
      break;
    case "dim":
      if (chord.seventh === "dim7") suffix = "dim7";
      else if (chord.seventh === "min7") suffix = `m${seventhNumber()}b5`;
      else if (chord.seventh === "maj7") suffix = "dimMaj7";
      else suffix = "dim";
      break;
    case "aug":
      if (chord.seventh === "maj7") suffix = `augMaj${seventhNumber()}`;
      else if (chord.seventh === "min7") suffix = `aug${seventhNumber()}`;
      else suffix = "aug";
      break;
    case "sus4":
    case "sus2":
      if (chord.seventh === "maj7") suffix = `maj${seventhNumber()}${chord.triad}`;
      else if (chord.seventh === "min7") suffix = `${seventhNumber()}${chord.triad}`;
      else suffix = chord.triad;
      break;
    default: break;
  }
  if (chord.sixth && !(plainTriad && !hasSeventh)) suffix += "add6";
  for (const degree of naturals) if (!named.includes(degree)) suffix += `add${degree}`;
  for (const a of [...altered].sort(alterationOrder)) {
    if (a === "b5" && chord.triad === "dim") continue;
    if (a === "#5" && chord.triad === "aug") continue;
    // An altered extension on a chord with no seventh is an added tone (`Cadd#11`).
    if (!hasSeventh && /^[b#](9|11|13)$/.test(a)) { suffix += `add${a}`; continue; }
    suffix += a;
  }
  for (const o of chord.omits) suffix += `no${o}`;
  const head = `${ROOT_NAMES[chord.root]}${suffix}`;
  return chord.bass === chord.root ? head : `${head}/${ROOT_NAMES[chord.bass]}`;
}

/** Semitones above the root of the chord's bass tone, or null when the bass is not a chord tone. */
export function bassInterval(chord: ParsedChord): number | null {
  return chord.pitchClasses.includes(chord.bass) ? pc(chord.bass - chord.root) : null;
}

/** 0 root position, 1 first inversion, ...; -1 when the bass is not a chord tone. */
export function inversionOfChord(chord: ParsedChord): number {
  return chord.pitchClasses.indexOf(chord.bass);
}

/** The interval sets of the analysis templates, for callers that only need pitch classes. */
export const TEMPLATE_INTERVALS: Record<TemplateQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  maj6: [0, 4, 7, 9],
  min6: [0, 3, 7, 9],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  minMaj7: [0, 3, 7, 11],
  add9: [0, 2, 4, 7],
  dom9: [0, 2, 4, 7, 10],
  maj9: [0, 2, 4, 7, 11],
  min9: [0, 2, 3, 7, 10],
};

/** Canonical suffix per template, matching `harmonyEngine.formatChordSymbol`. */
export const TEMPLATE_SUFFIX: Record<TemplateQuality, string> = {
  maj: "", min: "m", dim: "dim", aug: "aug", sus4: "sus4", sus2: "sus2",
  maj6: "6", min6: "m6", dom7: "7", maj7: "maj7", min7: "m7", m7b5: "m7b5",
  dim7: "dim7", minMaj7: "mMaj7", add9: "add9", dom9: "9", maj9: "maj9", min9: "m9",
};

/** A template-level reading: the shape `harmonyEngine.parseChordSymbol` has always returned. */
export function parseChordTemplate(symbol: string): { root: number; quality: TemplateQuality; bass: number } | null {
  const chord = parseChord(symbol);
  return chord ? { root: chord.root, quality: chord.template, bass: chord.bass } : null;
}
