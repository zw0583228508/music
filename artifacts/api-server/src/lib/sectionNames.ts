/**
 * What a section is called, in the languages this platform's producers type.
 *
 * The arrangement planner decides a section's *function* from its name — an
 * intro is planned as an intro, a chorus gets the chorus treatment — and until
 * now it did that with an English-only regular expression. The owner of this
 * platform writes Hebrew. B-12b measured the cost with the naming-invariance
 * invariant, which plans the same song twice under English and Hebrew names and
 * demands identical treatment: **0 of 20 models passed**. A song whose sections
 * are called בית and פזמון was planned as nine neutral sections — no chorus
 * arrival, no verse restraint, no outro.
 *
 * There is one vocabulary and it lives here. `globalArrangementPlanner`
 * classifies with it; `copilotInterpreter` recognises a producer's spoken
 * reference to a section with it. Before this module the two kept private,
 * disagreeing copies of the same words, and the copilot's copy was broken in a
 * way nobody had noticed: it recognised "פזמון" in the *command* and then
 * searched the project for a section whose name contained the English
 * "chorus", so a Hebrew command about a Hebrew-named song matched nothing.
 *
 * Adding a language means adding its words to `SECTION_VOCABULARY` and nothing
 * else.
 */

/** The section functions the planner distinguishes. */
export type SectionFunctionName =
  | "intro" | "verse" | "prechorus" | "chorus" | "bridge"
  | "breakdown" | "outro" | "instrumental" | "neutral";

/**
 * The vocabulary, **in decision order** — the first entry whose pattern matches
 * wins, so a longer name that contains a shorter one must come first:
 * "pre-chorus" before "chorus", "פרה-פזמון" before "פזמון", "breakdown" before
 * a bare "break".
 *
 * English patterns are matched against the lower-cased name. Hebrew has no
 * case, and Hebrew section names are written with the same letters whatever
 * their position, so the same patterns serve both.
 */
export const SECTION_VOCABULARY: ReadonlyArray<{
  readonly fn: Exclude<SectionFunctionName, "neutral">;
  readonly pattern: RegExp;
  /** Why these words, for the reader who wonders where a match came from. */
  readonly note: string;
}> = [
  {
    fn: "intro",
    pattern: /intro|count|פתיחה|מבוא|אינטרו|הקדמה/,
    note: "English intro / count-in; Hebrew פתיחה (opening), מבוא, אינטרו, הקדמה",
  },
  {
    fn: "prechorus",
    // Before `chorus`: every one of these contains the chorus word.
    pattern: /pre-? ?chorus|pre-? ?hook|lift|build|פרה[- ]?פזמון|טרום[- ]?פזמון|פריקורוס/,
    note: "must precede chorus: 'pre-chorus' contains 'chorus' and פרה-פזמון contains פזמון",
  },
  {
    fn: "chorus",
    pattern: /chorus|hook|drop|refrain|פזמון|רפריין/,
    note: "English chorus / hook / drop / refrain; Hebrew פזמון, רפריין",
  },
  {
    fn: "bridge",
    pattern: /bridge|middle 8|middle eight|גשר/,
    note: "English bridge / middle eight; Hebrew גשר",
  },
  {
    fn: "breakdown",
    // Before nothing in particular, but `break ?down` must precede a bare
    // `break` inside the same pattern, which alternation order gives us.
    pattern: /break ?down|break|ברייקדאון|שבירה/,
    note: "English breakdown / break; Hebrew ברייקדאון, שבירה",
  },
  {
    fn: "outro",
    pattern: /outro|coda|ending|tag|סיומת|סיום|אאוטרו|קודה/,
    note: "English outro / coda / ending / tag; Hebrew סיומת and סיום (סיומת first so the longer word is reported as itself), אאוטרו, קודה",
  },
  {
    fn: "verse",
    pattern: /verse|בית/,
    note: "English verse; Hebrew בית — the word a Hebrew producer writes for a verse",
  },
  {
    fn: "instrumental",
    pattern: /solo|instrumental|interlude|turnaround|סולו|אינסטרומנטלי|קטע כלי|מעבר/,
    note: "English solo / instrumental / interlude / turnaround; Hebrew סולו, אינסטרומנטלי, קטע כלי, מעבר",
  },
];

/**
 * The section function a name implies ("Final Chorus" → chorus, "פזמון 2" →
 * chorus), or `neutral` when no vocabulary matches. `neutral` is a real answer:
 * a section called "Section 3" states nothing about its function and the
 * planner must not invent one.
 */
export function classifySectionName(name: string): SectionFunctionName {
  const n = name.toLowerCase();
  for (const entry of SECTION_VOCABULARY) {
    if (entry.pattern.test(n)) return entry.fn;
  }
  return "neutral";
}

/**
 * Does this free text refer to the given section function? Used by the copilot
 * to read a producer's instruction ("תוסיף כלי קשת בפזמון" refers to the
 * chorus), which is the same vocabulary question asked of a sentence instead of
 * a name.
 *
 * Note the asymmetry with `classifySectionName`: a sentence may name several
 * sections, so this answers about one function at a time and does not stop at
 * the first match in the table.
 */
export function textRefersToSectionFunction(text: string, fn: Exclude<SectionFunctionName, "neutral">): boolean {
  const entry = SECTION_VOCABULARY.find((e) => e.fn === fn);
  if (!entry) return false;
  // "pre-chorus" contains "chorus" and must not read as one. Take the words of
  // the more specific entries out of the sentence before asking — which still
  // lets "in the chorus and the bridge" name both, because removing the chorus
  // words leaves the bridge word standing.
  let remaining = text.toLowerCase();
  for (const earlier of SECTION_VOCABULARY) {
    if (earlier.fn === fn) break;
    remaining = remaining.replace(new RegExp(earlier.pattern.source, "g"), " ");
  }
  return entry.pattern.test(remaining);
}
