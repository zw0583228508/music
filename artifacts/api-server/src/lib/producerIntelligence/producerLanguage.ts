/**
 * The producer's language (Wave U, PR-36).
 *
 * A producer who writes Hebrew should be answered in Hebrew. PR-U1 already
 * detects the language of every turn and PR-U1's clarification questions
 * already carry Hebrew wording; this module extends the same idea to the rest
 * of what the producer reads — the reading of their brief, the explanations,
 * the regeneration report and the standing-rule notice.
 *
 * Every phrase is a template over data the caller already holds, exactly as the
 * English sentences were: no model writes any of this, and a Hebrew reply can
 * say nothing an English one could not. Words the producer typed, section
 * names, instrument families and dimension names are theirs and are quoted or
 * printed as they are — a Hebrew sentence around a Latin word is correct, and
 * inventing a Hebrew translation of "Chorus 2" would be a lie about the data.
 */
import type { UserIntent } from "@workspace/db";

export type ProducerLanguage = UserIntent["language"];

const HEBREW = /[֐-׿]/;

/** The language to answer in: what the producer wrote, one turn at a time. */
export function replyLanguage(text: string | undefined | null): ProducerLanguage {
  return text && HEBREW.test(text) ? "he" : "en";
}

export const isHebrew = (language: ProducerLanguage): boolean => language === "he";

const joinEn = (items: string[]): string =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
/**
 * Hebrew's "ו" attaches to the word it precedes — but a Latin word, a digit or
 * a quote takes the maqaf ("ו-flute"), which is how Hebrew writes foreign words
 * and numbers. Instrument families, section names and the producer's quoted
 * words all arrive in Latin script, so this is the common case, not the edge.
 */
const joinHe = (items: string[]): string => {
  if (items.length <= 1) return items.join("");
  const last = items[items.length - 1];
  const vav = HEBREW.test(last.charAt(0)) ? `ו${last}` : `ו-${last}`;
  return `${items.slice(0, -1).join(", ")} ${vav}`;
};

export type Phrases = {
  /** Join a list in the producer's language. */
  list(items: string[]): string;
  /** Quote the producer's own words. */
  quote(value: string): string;

  // --- the reading of a brief (understanding.ts) --------------------------------
  addedToBrief(version: number, added: string): string;
  nothingNewRead: string;
  didNotUnderstand(items: string): string;
  tellMeMore: string;
  noDirectionYet: string;
  tellMeHow: string;
  hereIsHowIReadIt(world: string | null): string;
  boundaries(phrase: string): string;
  perSection(phrase: string): string;
  couldNotPlace(wishes: string, sectionNames: string): string;
  keptForAnalysis(wishes: string): string;
  excludedFromPalette(families: string): string;
  didNotUnderstandSayAgain(items: string): string;
  productionAesthetic(value: string): string;
  questionsLead(count: number): string;
  worldPrefix(words: string): string;
  sceneSuffix(scene: string): string;
  ensembleSuffix(ensemble: string): string;
  feelPrefix(feels: string): string;
  bpm(value: string): string;
  tempoFeel(value: string): string;
  instrumentsNamed(items: string): string;
  referencesNamed(items: string): string;
  sectionWishes(items: string): string;
  constraintVerb(kind: "avoid" | "limit" | "keep" | "require"): string;
  researchSentence(world: string, providers: string, dimensions: string): string;

  // --- producer memory (producerMemory.ts) --------------------------------------
  standingRulesApplied(statements: string, count: number): string;

  // --- explanations (explain.ts) -------------------------------------------------
  cannotExplain(reason: string): string;
  reasonNoPlan: string;
  reasonNoEvidenceAbout(subject: string): string;
  reasonNotInPalette(family: string, palette: string): string;
  reasonNoSuchSection(fn: string, sections: string): string;
  reasonNothingAsked: string;
  sectionsNone: string;
  decisionOriginLine(origin: string, statement: string): string;
  originStandingRule: string;
  originReference(ref: string): string;
  originResearch(ref: string): string;
  originPersonalDefaults: string;
  editRewroteIt(editText: string, replaced: number, sections: string, kept: number): string;
  editPreservedIt(editText: string, family: string, lockedNotes: number): string;

  // --- an edit turn (producerChat.ts) --------------------------------------------
  standingRuleFor(strength: "hard" | "soft", scope: string, statement: string, replaces: number): string;
  briefUpdated(version: number): string;
  noDurableDecision: string;
  nothingRegeneratedYet: string;
  scopeWholeSong: string;
  scopePhrase(id: string): string;
  scopeTrack(instrument: string, sectionName: string | null): string;

  // --- an edit plan's rationale (editPlan.ts) -------------------------------------
  editIntentName(intent: string): string;
  editUnclear(text: string): string;
  editRationale(intent: string, scope: string, scopes: number, locks: number, unresolved: string | null, evidence: string): string;
  editScopeWholeArrangement: string;
  editScopeSection(name: string): string;
  editScopeBars(startBar: number, endBar: number, instrument: string | null): string;
  evidenceNone: string;
};

const EN: Phrases = {
  list: joinEn,
  quote: (value) => `"${value.trim()}"`,
  addedToBrief: (version, added) => `Added to the brief (v${version}): ${added}.`,
  nothingNewRead: "I could not read a new musical direction from that, so the brief is unchanged.",
  didNotUnderstand: (items) => `I did not understand ${items}.`,
  tellMeMore: "Tell me about the feel, an era, artists or songs, or the instruments you hear, and I will fold it in.",
  noDirectionYet: "I could not read a musical direction from that yet.",
  tellMeHow: "Tell me how you want the arrangement to feel — write however is comfortable, mention artists, songs or eras, or upload a reference.",
  hereIsHowIReadIt: (world) => (world ? `Here is how I read it: ${world}.` : "Here is how I read it."),
  boundaries: (phrase) => `Boundaries — ${phrase}.`,
  perSection: (phrase) => `Per section — ${phrase}.`,
  couldNotPlace: (wishes, sectionNames) =>
    `I could not place ${wishes} on this song's sections (${sectionNames}); it is kept, not guessed.`,
  keptForAnalysis: (wishes) => `${wishes} is kept for when the song is analysed; there is no Song Model to place it on yet.`,
  excludedFromPalette: (families) => `Excluded from the palette: ${families}.`,
  didNotUnderstandSayAgain: (items) => `I did not understand ${items} — say it another way and I will pick it up.`,
  productionAesthetic: (value) => `Production aesthetic for the planners: ${value}.`,
  questionsLead: (count) =>
    count === 1 ? "One thing would change the arrangement materially:" : "Two things would change the arrangement materially:",
  worldPrefix: (words) => `a ${words}`,
  sceneSuffix: (scene) => `${scene} scene`,
  ensembleSuffix: (ensemble) => `${ensemble} ensemble`,
  feelPrefix: (feels) => `feel: ${feels}`,
  bpm: (value) => `${value} bpm`,
  tempoFeel: (value) => `${value} tempo`,
  instrumentsNamed: (items) => `instruments named: ${items}`,
  referencesNamed: (items) => `references: ${items}`,
  sectionWishes: (items) => `section wishes: ${items}`,
  constraintVerb: (kind) =>
    ({ avoid: "ruled out", limit: "keep in check", keep: "keep", require: "must have" })[kind],
  researchSentence: (world, providers, dimensions) =>
    `From what is known of ${world} (${providers}): ${dimensions} — marked researched in the brief, below anything you said`,
  standingRulesApplied: (statements, count) =>
    `Your standing rule${count === 1 ? "" : "s"} ${statements} ${count === 1 ? "was" : "were"} applied to this project; revoke ${count === 1 ? "it" : "them"} in producer memory, or say otherwise here and this project will follow what you say.`,
  cannotExplain: (reason) => `I can't explain that from the plan: ${reason}.`,
  reasonNoPlan: "the plan has no global or section plan to read",
  reasonNoEvidenceAbout: (subject) => `the plan holds no evidence about ${subject}`,
  reasonNotInPalette: (family, palette) => `${family} is not in this plan's palette at all (palette: ${palette})`,
  reasonNoSuchSection: (fn, sections) => `no ${fn} section exists in this plan (sections: ${sections})`,
  reasonNothingAsked: "the question names no instrument, section or climax the plan could be asked about",
  sectionsNone: "none",
  decisionOriginLine: (origin, statement) => `That decision comes from ${origin}: "${statement}".`,
  originStandingRule: "your standing rule",
  originReference: (ref) => `the reference you allowed (${ref})`,
  originResearch: (ref) => `researched world knowledge (${ref})`,
  originPersonalDefaults: "your learned defaults",
  editRewroteIt: (editText, replaced, sections, kept) =>
    `Your edit "${editText}" rewrote it: ${replaced} note(s) replaced in ${sections}, ${kept} kept verbatim.`,
  editPreservedIt: (editText, family, lockedNotes) =>
    `Your edit "${editText}" did not rewrite it: ${family} was preserved, and ${lockedNotes} locked note(s) were verified byte-identical.`,
  standingRuleFor: (strength, scope, statement, replaces) =>
    `${strength === "hard" ? "Standing rule" : "Preference"} for ${scope}: ${statement}${replaces ? ` (replaces ${replaces} earlier decision${replaces > 1 ? "s" : ""})` : ""}.`,
  briefUpdated: (version) => `Brief updated to v${version}.`,
  noDurableDecision: "No durable decision was recorded from this; the plan above is what a regeneration would do.",
  nothingRegeneratedYet: "Nothing is regenerated from chat yet — the plan is returned for the next arrangement.",
  scopeWholeSong: "the whole song",
  scopePhrase: (id) => `phrase ${id}`,
  scopeTrack: (instrument, sectionName) => `${instrument}${sectionName ? ` in "${sectionName}"` : ""}`,
  editIntentName: (intent) => intent.replace(/_/g, " "),
  editUnclear: (text) => `Could not map "${text}" onto an arrangement change; nothing is regenerated.`,
  editRationale: (intent, scope, scopes, locks, unresolved, evidence) =>
    `${intent} on ${scope}: ${scopes} regeneration scope(s), ${locks} lock(s)${unresolved ? `; the requested ${unresolved} could not be matched to a section of this song` : ""}. Evidence: ${evidence}.`,
  editScopeWholeArrangement: "the whole arrangement",
  editScopeSection: (name) => `section "${name}"`,
  editScopeBars: (startBar, endBar, instrument) => `bars ${startBar}–${endBar}${instrument ? ` of ${instrument}` : ""}`,
  evidenceNone: "none",
};

/** The edit intents PR-U1 can read, in the producer's own language. */
const HE_EDIT_INTENTS: Record<string, string> = {
    regenerate_part: "לכתוב מחדש חלק",
    regenerate_section: "לכתוב מחדש חלק מהשיר",
    reduce_density: "לדלל",
    raise_density: "לעבות",
    lower_energy: "להנמיך אנרגיה",
    raise_energy: "להעלות אנרגיה",
    raise_climax: "לחזק את השיא",
    change_groove: "לשנות גרוב",
    change_harmony: "לשנות הרמוניה",
    add_instrument: "להוסיף כלי",
    remove_instrument: "להסיר כלי",
    keep: "לשמור",
    unclear: "לא ברור",
};

const HE: Phrases = {
  list: joinHe,
  quote: (value) => `"${value.trim()}"`,
  addedToBrief: (version, added) => `נוסף לבריף (גרסה ${version}): ${added}.`,
  nothingNewRead: "לא הצלחתי לקרוא מזה כיוון מוזיקלי חדש, אז הבריף לא השתנה.",
  didNotUnderstand: (items) => `לא הבנתי ${items}.`,
  tellMeMore: "ספר לי על התחושה, על תקופה, על אמנים או שירים, או על הכלים שאתה שומע — ואשלב את זה.",
  noDirectionYet: "עוד לא הצלחתי לקרוא מזה כיוון מוזיקלי.",
  tellMeHow: "ספר לי איך אתה רוצה שהעיבוד יישמע — כתוב איך שנוח לך, הזכר אמנים, שירים או תקופות, או העלה רפרנס.",
  hereIsHowIReadIt: (world) => (world ? `כך קראתי את זה: ${world}.` : "כך קראתי את זה."),
  boundaries: (phrase) => `גבולות — ${phrase}.`,
  perSection: (phrase) => `לפי חלקים — ${phrase}.`,
  couldNotPlace: (wishes, sectionNames) =>
    `לא הצלחתי למקם את ${wishes} על חלקי השיר הזה (${sectionNames}); זה נשמר, לא נוחש.`,
  keptForAnalysis: (wishes) => `${wishes} נשמר לכשהשיר ינותח; אין עדיין Song Model למקם את זה עליו.`,
  excludedFromPalette: (families) => `הוצא מהפלטה: ${families}.`,
  didNotUnderstandSayAgain: (items) => `לא הבנתי ${items} — נסח אחרת ואקלוט את זה.`,
  productionAesthetic: (value) => `אסתטיקת ההפקה למתכננים: ${value}.`,
  questionsLead: (count) =>
    count === 1 ? "דבר אחד ישנה את העיבוד באופן ממשי:" : "שני דברים ישנו את העיבוד באופן ממשי:",
  worldPrefix: (words) => words,
  sceneSuffix: (scene) => `סצנה: ${scene}`,
  ensembleSuffix: (ensemble) => `הרכב: ${ensemble}`,
  feelPrefix: (feels) => `תחושה: ${feels}`,
  bpm: (value) => `${value} פעימות לדקה`,
  tempoFeel: (value) => `טמפו ${value}`,
  instrumentsNamed: (items) => `כלים שהוזכרו: ${items}`,
  referencesNamed: (items) => `רפרנסים: ${items}`,
  sectionWishes: (items) => `בקשות לפי חלקים: ${items}`,
  constraintVerb: (kind) =>
    ({ avoid: "נפסל", limit: "לרסן", keep: "לשמור", require: "חובה" })[kind],
  researchSentence: (world, providers, dimensions) =>
    `ממה שידוע על ${world} (${providers}): ${dimensions} — מסומן בבריף כמחקר, מתחת לכל מה שאמרת`,
  standingRulesApplied: (statements, count) =>
    `${count === 1 ? "הכלל הקבוע שלך" : "הכללים הקבועים שלך"} ${statements} ${count === 1 ? "הוחל" : "הוחלו"} על הפרויקט הזה; אפשר לבטל ${count === 1 ? "אותו" : "אותם"} בזיכרון המפיק, או פשוט לומר כאן אחרת — והפרויקט הזה ילך לפי מה שתאמר.`,
  cannotExplain: (reason) => `אני לא יכול להסביר את זה מהתוכנית: ${reason}.`,
  reasonNoPlan: "אין בתוכנית תוכנית-על או תוכנית חלקים לקרוא",
  reasonNoEvidenceAbout: (subject) => `לתוכנית אין ראיות על ${subject}`,
  reasonNotInPalette: (family, palette) => `${family} בכלל לא נמצא בפלטה של התוכנית הזאת (הפלטה: ${palette})`,
  reasonNoSuchSection: (fn, sections) => `אין בתוכנית הזאת חלק מסוג ${fn} (החלקים: ${sections})`,
  reasonNothingAsked: "השאלה לא מציינת כלי, חלק או שיא שאפשר לשאול עליהם את התוכנית",
  sectionsNone: "אין",
  decisionOriginLine: (origin, statement) => `ההחלטה הזאת מגיעה מ${origin}: "${statement}".`,
  originStandingRule: "כלל קבוע שלך",
  originReference: (ref) => `הרפרנס שהרשית (${ref})`,
  originResearch: (ref) => `ידע מחקרי על העולם המוזיקלי (${ref})`,
  originPersonalDefaults: "ברירות המחדל הנלמדות שלך",
  editRewroteIt: (editText, replaced, sections, kept) =>
    `העריכה שלך "${editText}" כתבה את זה מחדש: ${replaced} תווים הוחלפו ב-${sections}, ${kept} נשמרו מילה במילה.`,
  editPreservedIt: (editText, family, lockedNotes) =>
    `העריכה שלך "${editText}" לא כתבה את זה מחדש: ${family} נשמר, ו-${lockedNotes} תווים נעולים אומתו כזהים בייט בבייט.`,
  standingRuleFor: (strength, scope, statement, replaces) =>
    `${strength === "hard" ? "כלל קבוע" : "העדפה"} ל${scope}: ${statement}${replaces ? ` (מחליף ${replaces} ${replaces > 1 ? "החלטות קודמות" : "החלטה קודמת"})` : ""}.`,
  briefUpdated: (version) => `הבריף עודכן לגרסה ${version}.`,
  noDurableDecision: "לא נרשמה מכאן החלטה קבועה; התוכנית שלמעלה היא מה שרג׳נרציה הייתה עושה.",
  nothingRegeneratedYet: "עדיין לא בוצעה רג׳נרציה מהצ׳אט — התוכנית מוחזרת לעיבוד הבא.",
  scopeWholeSong: "כל השיר",
  scopePhrase: (id) => `משפט ${id}`,
  scopeTrack: (instrument, sectionName) => `${instrument}${sectionName ? ` ב"${sectionName}"` : ""}`,
  editIntentName: (intent) => HE_EDIT_INTENTS[intent] ?? intent.replace(/_/g, " "),
  editUnclear: (text) => `לא הצלחתי למפות את "${text}" לשינוי בעיבוד; שום דבר לא נכתב מחדש.`,
  editRationale: (intent, scope, scopes, locks, unresolved, evidence) =>
    `${intent} על ${scope}: ${scopes} תחומי רג׳נרציה, ${locks} נעילות${unresolved ? `; לא הצלחתי להתאים את ה${unresolved} המבוקש לחלק בשיר הזה` : ""}. ראיות: ${evidence}.`,
  editScopeWholeArrangement: "כל העיבוד",
  editScopeSection: (name) => `החלק "${name}"`,
  editScopeBars: (startBar, endBar, instrument) => `תיבות ${startBar}–${endBar}${instrument ? ` של ${instrument}` : ""}`,
  evidenceNone: "אין",
};

export function phrases(language: ProducerLanguage): Phrases {
  return isHebrew(language) ? HE : EN;
}
