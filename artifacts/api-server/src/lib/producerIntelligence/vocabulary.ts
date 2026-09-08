/**
 * Universal music vocabulary (Wave U, PR-U1).
 *
 * This is the word list the deterministic intent extractor recognises, in
 * Hebrew and English. It is deliberately a *vocabulary*, not a catalogue of
 * styles: it says that "פזמון" means chorus, that "כינור" is a violin in the
 * strings family, and that "חסידי" names a tradition — it says nothing about
 * what any tradition sounds like. Style knowledge is resolved per project
 * (`styleResolution.ts`, and the future research agent of PR-U3).
 *
 * Matching is prefix-tolerant for Hebrew (ו/ה/ב/ל/מ/ש/כ clitics) and
 * suffix-tolerant for common plural / gender endings in both languages.
 */
import type { IntentSectionFunction, IntentSlotName } from "@workspace/db";

export type LexiconEntry = {
  slot: IntentSlotName;
  /** Canonical value, always English snake_case. */
  value: string;
  /** Surface forms, Hebrew or English; multi-word allowed. */
  terms: string[];
  /** Confidence that the word means this slot/value (default 0.85). */
  confidence?: number;
  /** Further inferences a word licenses ("ballad" ⇒ slow), always `inferred`. */
  implies?: Array<{ slot: IntentSlotName; value: string; confidence: number }>;
};

const e = (
  slot: IntentSlotName,
  value: string,
  terms: string[],
  extra: Partial<Pick<LexiconEntry, "confidence" | "implies">> = {},
): LexiconEntry => ({ slot, value, terms, ...extra });

export const LEXICON: LexiconEntry[] = [
  // ---- mood -----------------------------------------------------------------
  e("mood", "happy", ["happy", "joyful", "cheerful", "שמח", "שמחה", "עליז", "עליזה"]),
  e("mood", "sad", ["sad", "sorrowful", "עצוב", "עצובה"]),
  e("mood", "nostalgic", ["nostalgic", "nostalgia", "נוסטלגי", "נוסטלגית", "געגוע", "געגועים"]),
  e("mood", "dreamy", ["dreamy", "חלומי", "חלומית"]),
  e("mood", "dark", ["dark", "brooding", "אפל", "אפלה"]),
  e("mood", "warm", ["warm", "חם", "חמים", "חמימה", "חמה"]),
  e("mood", "uplifting", ["uplifting", "מרומם", "מרוממת"]),
  e("mood", "melancholic", ["melancholic", "melancholy", "מלנכולי", "מלנכולית"]),
  e("mood", "romantic", ["romantic", "רומנטי", "רומנטית"]),
  e("mood", "festive", ["festive", "celebratory", "חגיגי", "חגיגית"]),
  e("mood", "spiritual", ["spiritual", "devotional", "רוחני", "רוחנית"]),
  e("mood", "emotional", ["emotional", "moving", "heartfelt", "רגשי", "רגשית", "מרגש", "מרגשת"]),
  e("mood", "intimate", ["intimate", "אינטימי", "אינטימית"], {
    implies: [{ slot: "production_feel", value: "intimate", confidence: 0.7 }],
  }),
  e("mood", "epic", ["epic", "אפי", "אפית"], {
    implies: [{ slot: "energy", value: "high", confidence: 0.6 }],
  }),
  e("mood", "playful", ["playful", "שובב", "שובבה"]),
  e("mood", "tense", ["tense", "dramatic", "מתוח", "מתוחה", "דרמטי", "דרמטית"]),
  e("mood", "calm", ["calm", "peaceful", "serene", "רגוע", "רגועה", "שלו", "שלווה"], {
    implies: [{ slot: "energy", value: "low", confidence: 0.6 }],
  }),
  e("mood", "longing", ["longing", "yearning", "כיסופים", "ערגה"]),

  // ---- energy ---------------------------------------------------------------
  e("energy", "high", [
    "energetic", "powerful", "driving", "punchy", "explosive", "huge", "massive",
    "אנרגטי", "אנרגטית", "עוצמתי", "עוצמתית", "חזק", "חזקה", "מפוצץ", "מפוצצת",
  ]),
  e("energy", "low", [
    "quiet", "gentle", "soft", "mellow", "subdued", "delicate", "tender",
    "שקט", "שקטה", "עדין", "עדינה", "רך", "רכה", "מאופק", "מאופקת",
  ]),

  // ---- density --------------------------------------------------------------
  e("density", "sparse", [
    "sparse", "minimal", "minimalist", "stripped", "stripped-down", "stripped down", "airy",
    "spacious", "bare", "דליל", "דלילה", "מינימלי", "מינימלית", "פשוט", "פשוטה",
    "אוורירי", "אוורירית", "מרווח", "מרווחת",
  ]),
  e("density", "dense", [
    "dense", "full", "rich", "thick", "layered", "lush", "busy", "crowded", "packed",
    "צפוף", "צפופה", "מלא", "מלאה", "עשיר", "עשירה", "עבה", "עמוס", "עמוסה", "שכבתי",
  ]),
  e("density", "dense", ["big", "גדול", "גדולה"], {
    confidence: 0.55,
    implies: [{ slot: "energy", value: "high", confidence: 0.55 }],
  }),

  // ---- era ------------------------------------------------------------------
  e("era", "1960s", ["60s", "60's", "sixties", "1960s", "שנות ה-60", "שנות ה60", "שנות השישים"]),
  e("era", "1970s", ["70s", "70's", "seventies", "1970s", "שנות ה-70", "שנות ה70", "שנות השבעים"]),
  e("era", "1980s", ["80s", "80's", "eighties", "1980s", "שנות ה-80", "שנות ה80", "שנות השמונים"]),
  e("era", "1990s", ["90s", "90's", "nineties", "1990s", "שנות ה-90", "שנות ה90", "שנות התשעים"]),
  e("era", "2000s", ["2000s", "00s", "noughties", "שנות ה-2000", "שנות האלפיים"]),
  e("era", "2010s", ["2010s", "שנות ה-2010"]),
  e("era", "old", ["old", "old-school", "oldschool", "old school", "old-fashioned", "ישן", "ישנה", "ישנים", "ישנות", "של פעם"], {
    confidence: 0.6,
  }),
  e("era", "vintage", ["vintage", "retro", "וינטג'", "וינטאג'", "רטרו"], {
    confidence: 0.7,
    implies: [{ slot: "production_feel", value: "vintage", confidence: 0.55 }],
  }),
  e("era", "classic", ["classic", "קלאסי", "קלאסית", "קלאסיים"], { confidence: 0.45 }),
  e("era", "traditional", ["traditional", "מסורתי", "מסורתית", "מסורתיים"], { confidence: 0.65 }),
  e("era", "modern", [
    "modern", "contemporary", "current", "fresh", "מודרני", "מודרנית", "עכשווי", "עכשווית",
    "חדשני", "חדשנית", "של היום",
  ], { implies: [{ slot: "production_feel", value: "modern", confidence: 0.5 }] }),

  // ---- tradition (recognised names only; no knowledge attached) ----------------
  e("tradition", "hasidic", ["hasidic", "chassidic", "chasidic", "hassidic", "chassidish", "חסידי", "חסידית", "חסידיים", "חסידיות", "חסידות"]),
  e("tradition", "jewish", ["jewish", "יהודי", "יהודית", "יהודיים"]),
  e("tradition", "klezmer", ["klezmer", "כליזמר", "כלייזמר", "כליזמרי", "כליזמרית"]),
  e("tradition", "mizrahi", ["mizrahi", "mizrachi", "מזרחי", "מזרחית"]),
  e("tradition", "yemenite", ["yemenite", "yemeni", "תימני", "תימנית"]),
  e("tradition", "sephardic", ["sephardic", "sephardi", "ספרדי", "ספרדית", "ספרדי-ירושלמי"]),
  e("tradition", "ashkenazi", ["ashkenazi", "אשכנזי", "אשכנזית"]),
  e("tradition", "israeli", ["israeli", "ישראלי", "ישראלית", "ארץ ישראלי", "ארץ-ישראלי", "ארצישראלי"]),
  e("tradition", "cantorial", ["cantorial", "chazzanut", "hazzanut", "חזנות", "חזני", "חזנית"]),
  e("tradition", "liturgical", ["liturgical", "ליטורגי", "פיוט", "פיוטים"]),
  e("tradition", "arabic", ["arabic", "arab", "ערבי", "ערבית"]),
  e("tradition", "turkish", ["turkish", "טורקי", "טורקית"]),
  e("tradition", "greek", ["greek", "יווני", "יוונית"]),
  e("tradition", "balkan", ["balkan", "בלקני", "בלקנית"]),
  e("tradition", "persian", ["persian", "פרסי", "פרסית"]),
  e("tradition", "andalusian", ["andalusian", "אנדלוסי", "אנדלוסית"]),
  e("tradition", "moroccan", ["moroccan", "מרוקאי", "מרוקאית"]),
  e("tradition", "russian", ["russian", "רוסי", "רוסית"]),
  e("tradition", "celtic", ["celtic", "irish", "קלטי", "קלטית", "אירי", "אירית"]),
  e("tradition", "latin", ["latin", "לטיני", "לטינית"]),
  e("tradition", "brazilian", ["brazilian", "ברזילאי", "ברזילאית"]),
  e("tradition", "cuban", ["cuban", "קובני", "קובנית"]),
  e("tradition", "african", ["african", "אפריקאי", "אפריקאית"]),
  e("tradition", "indian", ["indian", "הודי", "הודית"]),
  e("tradition", "flamenco", ["flamenco", "פלמנקו"]),
  e("tradition", "gospel", ["gospel", "גוספל"]),

  // ---- scene -----------------------------------------------------------------
  e("scene", "wedding", ["wedding", "weddings", "simcha", "simchas", "חתונה", "חתונות", "שמחה", "שמחות"]),
  e("scene", "yeshiva", ["yeshiva", "yeshivish", "ישיבה", "ישיבתי", "ישיבתית"]),
  e("scene", "niggun", ["niggun", "nigun", "niggunim", "ניגון", "ניגונים"]),
  e("scene", "kumzitz", ["kumzitz", "kumzits", "campfire", "קומזיץ", "מדורה"]),
  e("scene", "concert", ["concert", "concert hall", "קונצרט", "קונצרטים"]),
  e("scene", "club", ["club", "dancefloor", "dance floor", "מועדון", "רחבה"]),
  e("scene", "synagogue", ["synagogue", "shul", "בית כנסת", "בית הכנסת"]),
  e("scene", "film", ["film", "movie", "soundtrack", "trailer", "סרט", "פסקול", "טריילר"]),
  e("scene", "dance", ["danceable", "for dancing", "לרקוד", "ריקודים", "ריקודי"], {
    confidence: 0.7,
    implies: [{ slot: "tempo_feel", value: "fast", confidence: 0.5 }],
  }),

  // ---- genre words ---------------------------------------------------------------
  e("genre_word", "pop", ["pop", "poppy", "פופ", "פופי", "פופית"]),
  e("genre_word", "rock", ["rock", "רוק"]),
  e("genre_word", "jazz", ["jazz", "jazzy", "ג'אז", "ג'אזי", "ג'אזית", "גאז"]),
  e("genre_word", "blues", ["blues", "bluesy", "בלוז", "בלוזי"]),
  e("genre_word", "soul", ["soul", "סול"]),
  e("genre_word", "funk", ["funk", "funky", "פאנקי"]),
  e("genre_word", "rnb", ["r&b", "rnb", "r'n'b", "אר אנד בי"]),
  e("genre_word", "hip_hop", ["hip-hop", "hip hop", "hiphop", "rap", "היפ הופ", "היפ-הופ", "ראפ"]),
  e("genre_word", "edm", ["edm", "electronic dance"]),
  e("genre_word", "trance", ["trance", "טראנס"]),
  e("genre_word", "house", ["house music", "האוס"]),
  e("genre_word", "techno", ["techno", "טכנו"]),
  e("genre_word", "disco", ["disco", "דיסקו"]),
  e("genre_word", "reggae", ["reggae", "רגאיי", "רגיי"]),
  e("genre_word", "country", ["country", "קאנטרי"]),
  e("genre_word", "folk", ["folk", "folky", "פולק"]),
  e("genre_word", "metal", ["metal", "מטאל"]),
  e("genre_word", "indie", ["indie", "אינדי"]),
  e("genre_word", "classical", ["classical", "baroque", "בארוק"]),
  e("genre_word", "ballad", ["ballad", "ballads", "בלדה", "בלדות"], {
    implies: [{ slot: "tempo_feel", value: "slow", confidence: 0.7 }],
  }),
  e("genre_word", "lullaby", ["lullaby", "שיר ערש"], {
    implies: [
      { slot: "tempo_feel", value: "slow", confidence: 0.7 },
      { slot: "energy", value: "low", confidence: 0.7 },
    ],
  }),
  e("genre_word", "anthem", ["anthem", "anthemic", "המנון", "המנוני"], {
    implies: [{ slot: "energy", value: "high", confidence: 0.6 }],
  }),
  e("genre_word", "hymn", ["hymn", "hymnal"]),
  e("genre_word", "waltz", ["waltz", "ואלס", "וואלס"]),
  e("genre_word", "march", ["march", "מארש"]),
  e("genre_word", "tango", ["tango", "טנגו"]),
  e("genre_word", "bossa_nova", ["bossa nova", "bossa", "בוסה נובה"]),
  e("genre_word", "samba", ["samba", "סמבה"]),
  e("genre_word", "swing", ["swing", "swung", "סווינג"]),
  e("genre_word", "ambient", ["ambient", "אמביינט"]),
  e("genre_word", "dance", ["dance music", "dance track", "מוזיקת ריקודים"], { confidence: 0.6 }),

  // ---- instruments (value = instrument; family mapping below) --------------------
  e("instrument", "piano", ["piano", "פסנתר"]),
  e("instrument", "keys", ["keys", "keyboard", "keyboards", "מקלדת", "קלידים"]),
  e("instrument", "organ", ["organ", "hammond", "אורגן"]),
  e("instrument", "rhodes", ["rhodes", "electric piano", "פסנתר חשמלי"]),
  e("instrument", "accordion", ["accordion", "אקורדיון"]),
  e("instrument", "guitar", ["guitar", "guitars", "גיטרה", "גיטרות"]),
  e("instrument", "acoustic_guitar", ["acoustic guitar", "acoustic guitars", "גיטרה אקוסטית", "גיטרות אקוסטיות"]),
  e("instrument", "electric_guitar", ["electric guitar", "electric guitars", "גיטרה חשמלית", "גיטרות חשמליות"]),
  e("instrument", "mandolin", ["mandolin", "מנדולינה"]),
  e("instrument", "banjo", ["banjo", "בנג'ו"]),
  e("instrument", "ukulele", ["ukulele", "יוקולילי"]),
  e("instrument", "oud", ["oud", "עוד"]),
  e("instrument", "bouzouki", ["bouzouki", "בוזוקי"]),
  e("instrument", "strings", ["strings", "string section", "מיתרים", "כלי מיתר"]),
  e("instrument", "violin", ["violin", "violins", "fiddle", "כינור", "כינורות"]),
  e("instrument", "viola", ["viola", "ויולה"]),
  e("instrument", "cello", ["cello", "cellos", "צ'לו"]),
  e("instrument", "double_bass", ["double bass", "upright bass", "contrabass", "קונטרבס"]),
  e("instrument", "harp", ["harp", "נבל"]),
  e("instrument", "brass", ["brass", "horns", "horn section", "כלי נשיפה"], { confidence: 0.7 }),
  e("instrument", "trumpet", ["trumpet", "trumpets", "חצוצרה", "חצוצרות"]),
  e("instrument", "trombone", ["trombone", "trombones", "טרומבון"]),
  e("instrument", "horn", ["french horn", "french horns", "קרן יער"]),
  e("instrument", "tuba", ["tuba", "טובה"]),
  e("instrument", "sax", ["sax", "saxophone", "saxophones", "סקסופון", "סקסופונים"]),
  e("instrument", "winds", ["woodwinds", "woodwind", "winds", "כלי נשיפה מעץ"]),
  e("instrument", "clarinet", ["clarinet", "clarinets", "קלרינט", "קלרינטים"]),
  e("instrument", "flute", ["flute", "flutes", "חליל", "חליל צד", "חלילים"]),
  e("instrument", "oboe", ["oboe", "אבוב"]),
  e("instrument", "bassoon", ["bassoon", "בסון"]),
  e("instrument", "recorder", ["recorder", "חלילית"]),
  e("instrument", "ney", ["ney", "nay", "נאי"]),
  e("instrument", "duduk", ["duduk", "דודוק"]),
  e("instrument", "drums", ["drums", "drum kit", "drumkit", "drum set", "תופים", "מערכת תופים"]),
  e("instrument", "percussion", ["percussion", "percussions", "perc", "כלי הקשה"]),
  e("instrument", "darbuka", ["darbuka", "darbouka", "doumbek", "דרבוקה"]),
  e("instrument", "cajon", ["cajon", "cajón", "קחון"]),
  e("instrument", "tambourine", ["tambourine", "תוף מרים"]),
  e("instrument", "congas", ["congas", "bongos", "קונגות", "בונגו"]),
  e("instrument", "frame_drum", ["frame drum", "תוף מסגרת"]),
  e("instrument", "bass", ["bass", "bass guitar", "בס", "גיטרה בס", "גיטרת בס"]),
  e("instrument", "synth_bass", ["synth bass", "סינת' בס", "בס סינתטי"]),
  e("instrument", "synth", ["synth", "synths", "synthesizer", "synthesizers", "סינת'", "סינתים", "סינתיסייזר", "סינטיסייזר"]),
  e("instrument", "pads", ["pad", "pads", "פאד", "פאדים"]),
  e("instrument", "choir", ["choir", "choirs", "מקהלה", "מקהלות"], {
    implies: [{ slot: "vocal_treatment", value: "choir", confidence: 0.8 }],
  }),

  // ---- ensemble size -------------------------------------------------------------
  e("ensemble_size", "solo", ["solo instrument", "solo piano", "solo guitar", "סולו פסנתר", "סולו גיטרה"]),
  e("ensemble_size", "duo", ["duo", "צמד"]),
  e("ensemble_size", "trio", ["trio", "שלישייה", "שלישיה"]),
  e("ensemble_size", "quartet", ["quartet", "רביעייה", "רביעיה"]),
  e("ensemble_size", "quartet", ["string quartet", "רביעיית מיתרים"], {
    implies: [{ slot: "instrument", value: "strings", confidence: 0.9 }],
  }),
  e("ensemble_size", "band", ["band", "להקה"]),
  e("ensemble_size", "big_band", ["big band", "ביג בנד", "ביג-בנד"]),
  e("ensemble_size", "orchestra", ["orchestra", "orchestral", "תזמורת", "תזמורתי", "תזמורתית", "סימפוני", "סימפונית", "symphonic"], {
    implies: [{ slot: "production_feel", value: "orchestral", confidence: 0.7 }],
  }),
  e("ensemble_size", "chamber", ["chamber", "קאמרי", "קאמרית"]),
  e("ensemble_size", "wedding_band", ["wedding band", "simcha band", "להקת חתונות", "להקת חתונה", "להקת שמחות"], {
    implies: [{ slot: "scene", value: "wedding", confidence: 0.8 }],
  }),
  e("ensemble_size", "choir", ["choral", "מקהלתי", "מקהלתית"]),
  e("ensemble_size", "small", ["small ensemble", "small group", "הרכב קטן", "הרכב מצומצם"]),
  e("ensemble_size", "large", ["large ensemble", "big ensemble", "הרכב גדול"]),

  // ---- tempo feel ---------------------------------------------------------------
  e("tempo_feel", "slow", ["slow", "slowly", "איטי", "איטית", "לאט"]),
  e("tempo_feel", "fast", ["fast", "quick", "מהיר", "מהירה"]),
  e("tempo_feel", "fast", ["uptempo", "up-tempo", "קצבי", "קצבית"], { confidence: 0.7 }),
  e("tempo_feel", "moderate", ["mid-tempo", "midtempo", "mid tempo", "medium tempo", "קצב בינוני"]),

  // ---- production feel -------------------------------------------------------------
  e("production_feel", "cinematic", ["cinematic", "קולנועי", "קולנועית", "סינמטי", "סינמטית"]),
  e("production_feel", "acoustic", ["acoustic", "unplugged", "אקוסטי", "אקוסטית"]),
  e("production_feel", "acoustic", ["organic", "אורגני", "אורגנית"], { confidence: 0.6 }),
  e("production_feel", "electronic", ["electronic", "אלקטרוני", "אלקטרונית"]),
  e("production_feel", "electronic", ["synthetic", "סינתטי", "סינתטית"], { confidence: 0.6 }),
  e("production_feel", "live", ["live band", "live recording", "live feel", "לייב", "הקלטה חיה", "הרגשה חיה"]),
  e("production_feel", "raw", ["raw", "גולמי", "גולמית"]),
  e("production_feel", "polished", ["polished", "produced", "slick", "מלוטש", "מלוטשת", "מהוקצע", "מהוקצעת", "מופק", "מופקת"]),
  e("production_feel", "lo_fi", ["lo-fi", "lofi", "lo fi", "לו-פיי", "לו פיי", "לופיי"]),
  e("production_feel", "orchestral", ["cinematic orchestra"], { confidence: 0.8 }),
  e("production_feel", "ambient", ["atmospheric", "אטמוספרי", "אטמוספרית"]),
  e("production_feel", "wide", ["wide", "רחב", "רחבה"], { confidence: 0.6 }),
  e("production_feel", "dry", ["dry", "יבש", "יבשה"], { confidence: 0.6 }),
  e("production_feel", "wet", ["reverby", "reverb-heavy", "מהדהד", "מהדהדת"], { confidence: 0.6 }),

  // ---- vocal treatment -------------------------------------------------------------
  e("vocal_treatment", "harmonies", ["harmonies", "harmony vocals", "vocal harmonies", "הרמוניות", "הרמוניות קוליות"]),
  e("vocal_treatment", "backing_vocals", ["backing vocals", "bvs", "background vocals", "קולות רקע"]),
  e("vocal_treatment", "a_cappella", ["a cappella", "acapella", "אקפלה", "א-קפלה"]),
  e("vocal_treatment", "duet", ["duet", "דואט"]),
];

/** Instrument value → planner family (the families the planners already know). */
export const INSTRUMENT_FAMILY: Record<string, string> = {
  piano: "keys", keys: "keys", organ: "keys", rhodes: "keys", accordion: "keys",
  guitar: "guitar", acoustic_guitar: "guitar", electric_guitar: "guitar", mandolin: "guitar",
  banjo: "guitar", ukulele: "guitar", oud: "guitar", bouzouki: "guitar",
  strings: "strings", violin: "strings", viola: "strings", cello: "strings", harp: "strings",
  double_bass: "bass", bass: "bass", synth_bass: "bass",
  brass: "brass", trumpet: "brass", trombone: "brass", horn: "brass", tuba: "brass",
  sax: "winds", winds: "winds", clarinet: "winds", flute: "winds", oboe: "winds",
  bassoon: "winds", recorder: "winds", ney: "winds", duduk: "winds",
  drums: "drums", percussion: "percussion", darbuka: "percussion", cajon: "percussion",
  tambourine: "percussion", congas: "percussion", frame_drum: "percussion",
  synth: "synth", pads: "pads", choir: "vocals",
};

export const instrumentFamily = (instrument: string): string =>
  INSTRUMENT_FAMILY[instrument] ?? instrument;

/** Section words, both languages. */
export const SECTION_TERMS: Array<{ function: IntentSectionFunction; terms: string[] }> = [
  { function: "prechorus", terms: ["pre-chorus", "prechorus", "pre chorus", "פרה-פזמון", "פרה פזמון", "פריקורוס"] },
  { function: "chorus", terms: ["chorus", "choruses", "hook", "refrain", "פזמון", "פזמונים"] },
  { function: "verse", terms: ["verse", "verses", "בית", "בתים"] },
  { function: "bridge", terms: ["bridge", "middle 8", "middle eight", "גשר"] },
  { function: "intro", terms: ["intro", "introduction", "פתיחה", "אינטרו", "הקדמה"] },
  { function: "outro", terms: ["outro", "coda", "ending", "סיום", "אאוטרו"] },
  { function: "breakdown", terms: ["breakdown", "ברייקדאון"] },
  { function: "instrumental", terms: ["instrumental", "interlude", "solo section", "אינסטרומנטלי", "קטע נגינה", "קטע כלי"] },
];

export const ORDINAL_TERMS: Array<{ ordinal: number | "last" | "all"; terms: string[] }> = [
  { ordinal: 1, terms: ["first", "1st", "opening", "ראשון", "ראשונה"] },
  { ordinal: 2, terms: ["second", "2nd", "שני", "שנייה", "שניה"] },
  { ordinal: 3, terms: ["third", "3rd", "שלישי", "שלישית"] },
  { ordinal: 4, terms: ["fourth", "4th", "רביעי", "רביעית"] },
  { ordinal: "last", terms: ["last", "final", "closing", "אחרון", "אחרונה", "סופי", "סופית"] },
  { ordinal: "all", terms: ["every", "each", "all the", "all", "כל", "בכל"] },
];

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const HEBREW = /[֐-׿]/;
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Hebrew clitic prefixes (and/the/in/to/from/that/as), up to two stacked. */
const HE_PREFIX = "[והבלמשכ]{0,2}";
/** Common Hebrew plural / gender / possessive endings. */
const HE_SUFFIX = "(?:יים|יות|ים|ות|ית|י|ה|ת)?";
const EN_SUFFIX = "(?:es|s|ed|ing|y|ish)?";

/**
 * A regex that finds `term` as a whole word, tolerant of Hebrew clitic
 * prefixes and common suffixes in both languages. Group 1 is the whole
 * matched span (verbatim evidence), group 2 the bare term.
 */
export function termPattern(term: string): RegExp {
  const body = escapeRegExp(term.toLowerCase());
  return HEBREW.test(term)
    ? new RegExp(`(?<![\\p{L}'])(${HE_PREFIX}(${body})${HE_SUFFIX})(?![\\p{L}'])`, "u")
    : new RegExp(`(?<![\\p{L}\\d])(${body}${EN_SUFFIX})(?![\\p{L}\\d])`, "iu");
}

/** The verbatim span where `term` occurs in `text`, or null. */
export function findTerm(text: string, term: string): { span: string; index: number } | null {
  const match = termPattern(term).exec(text.toLowerCase());
  if (!match || match.index === undefined) return null;
  return { span: text.slice(match.index, match.index + match[1].length), index: match.index };
}

export type LexiconHit = {
  entry: LexiconEntry;
  term: string;
  span: string;
  index: number;
};

/** Every lexicon entry found in `text`, longest terms first so "string quartet" beats "strings". */
export function findLexiconHits(text: string, lexicon: LexiconEntry[] = LEXICON): LexiconHit[] {
  const hits: LexiconHit[] = [];
  const claimed: Array<[number, number]> = [];
  const candidates: Array<{ entry: LexiconEntry; term: string }> = [];
  for (const entry of lexicon) for (const term of entry.terms) candidates.push({ entry, term });
  candidates.sort((a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term));
  for (const { entry, term } of candidates) {
    const found = findTerm(text, term);
    if (!found) continue;
    const end = found.index + found.span.length;
    const overlaps = claimed.some(([s, e2]) => found.index < e2 && end > s);
    if (overlaps) continue;
    claimed.push([found.index, end]);
    hits.push({ entry, term, span: found.span, index: found.index });
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** Strip Hebrew clitic prefixes from a bare token when the remainder is known. */
export function stripHebrewPrefix(token: string, known: (candidate: string) => boolean): string {
  if (!HEBREW.test(token)) return token;
  for (let n = 0; n <= 2 && n < token.length - 1; n += 1) {
    const candidate = token.slice(n);
    if (known(candidate)) return candidate;
  }
  return token;
}

/** Apostrophes / geresh marks vary by keyboard; compare words without them. */
const plain = (s: string): string => s.toLowerCase().replace(/['׳’`]/g, "");

/** Canonical lexicon entry for a single word (either language), or null. */
export function lookupWord(word: string, lexicon: LexiconEntry[] = LEXICON): LexiconEntry | null {
  const lower = plain(word).replace(/^[\s"“”‘(]+|[\s"“”‘).,!?;:]+$/g, "");
  if (!lower) return null;
  const direct = lexicon.find((entry) => entry.terms.some((t) => plain(t) === lower));
  if (direct) return direct;
  for (const entry of lexicon) {
    for (const term of entry.terms) {
      if (termPattern(plain(term)).test(lower) && lower.length <= term.length + 3) return entry;
    }
  }
  return null;
}

export function detectLanguage(text: string): "he" | "en" | "mixed" | "unknown" {
  const he = (text.match(/[֐-׿]/g) ?? []).length;
  const en = (text.match(/[A-Za-z]/g) ?? []).length;
  if (he === 0 && en === 0) return "unknown";
  if (he > 0 && en > 0 && Math.min(he, en) / Math.max(he, en) > 0.25) return "mixed";
  return he >= en ? "he" : "en";
}
