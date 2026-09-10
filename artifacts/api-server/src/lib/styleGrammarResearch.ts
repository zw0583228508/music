/**
 * Style research → grammar constraints (Brain B-09, D4).
 *
 * Research is *evidence about a named world* ("how does a chassidic ballad
 * usually treat the bass?"), returned as structured, cited claims against the
 * grammar's own field registry — never prose the resolver has to parse, never
 * notes, never content. This module owns:
 *
 *   - the provider interface (`StyleResearchProvider.research(query)`), so
 *     any transport (a curated table, a retrieval index, a model behind an
 *     API) plugs in behind one contract;
 *   - a deterministic **fixture provider** for tests (`STYLE_RESEARCH_FIXTURES`
 *     — every citation is labelled FIXTURE so it can never be mistaken for a
 *     source);
 *   - the **converter** from evidence to grammar candidates with the gate:
 *     an uncited claim is hearsay and is discarded; a claim under 0.4 is
 *     discarded; 0.4–0.7 is a *weak* finding that may fill an unknown but
 *     never overturns the knowledge base; ≥ 0.7 is a *fact* that may
 *     (`styleGrammar.effectiveRank`). Research never overrides a brief value:
 *     the merge ranks the brief above everything;
 *   - the **live provider seam** with an explicit `not_configured` state and
 *     the exact env vars it would need. No live call exists in this PR; when
 *     the env is present the state is `configured_unwired` and `research()`
 *     rejects, so nothing can silently pretend to have researched.
 *
 * This is distinct from Wave U's `producerIntelligence/styleResearch.ts`,
 * which researches *StyleProfile* dimensions for the producer chat and gates
 * them into clarification questions; that path still runs. The two meet in
 * `styleResolver.ts`, which adapts a profile into grammar candidates.
 */
import { isStylePath, validateStyleValue, type StyleCandidate, type StylePath, RESEARCH_FACT_CONFIDENCE } from "./styleGrammar";

export const STYLE_RESEARCH_VERSION = "STYLE_GRAMMAR_RESEARCH_V1" as const;
/** Under this a claim is discarded; between this and the fact threshold it is a weak finding. */
export const RESEARCH_MIN_CONFIDENCE = 0.4;

export type StyleResearchCitation = {
  title: string;
  url?: string;
  /** Page, section, timestamp, track ... */
  locator?: string;
  /** At most a short phrase; never lyrics or notes. */
  quote?: string;
};

export type StructuredStyleEvidence = {
  path: StylePath;
  value: unknown;
  /** 0..1, the provider's own confidence in the claim. */
  confidence: number;
  rationale: string;
  citations: StyleResearchCitation[];
  providerId: string;
};

export type StyleResearchQuery = {
  /** Identity terms naming the world: `tradition=hasidic`, `genre=ballad`, `era=1990s`. */
  world: string[];
  /** Fields the resolver could not fill; a provider may answer others too. */
  wanted?: StylePath[];
  language?: "en" | "he";
};

export type StyleResearchProvider = {
  id: string;
  research(query: StyleResearchQuery): Promise<StructuredStyleEvidence[]>;
};

// ---------------------------------------------------------------------------
// Fixture provider (deterministic; for tests and the evidence run)
// ---------------------------------------------------------------------------

export type StyleResearchFixture = {
  /** Every term must be present in the query's world. */
  when: string[];
  evidence: Array<Omit<StructuredStyleEvidence, "providerId">>;
};

export const FIXTURE_STYLE_RESEARCH_PROVIDER_ID = "style-research-fixture/v1";

const fixtureCitation = (title: string, locator?: string): StyleResearchCitation =>
  ({ title: `FIXTURE: ${title}`, ...(locator ? { locator } : {}) });

/**
 * Deterministic fixture claims. They exist to exercise the gate and the merge;
 * their content is plausible but is labelled FIXTURE in every citation and is
 * never used on the production path.
 */
export const STYLE_RESEARCH_FIXTURES: StyleResearchFixture[] = [
  {
    when: ["tradition=hasidic"],
    evidence: [
      { path: "groove.feltPulse", value: "half_time", confidence: 0.75, rationale: "chassidic ballads written above ~110 BPM are felt at half the written tempo", citations: [fixtureCitation("producer notes on chassidic ballad tempo", "note 3")] },
      { path: "harmony.modalFlavour", value: "harmonic_minor", confidence: 0.8, rationale: "the raised seventh at cadences is the default colour", citations: [fixtureCitation("niggun repertoire survey", "table 2")] },
      { path: "bass.motion", value: "roots", confidence: 0.55, rationale: "roots with an approach tone into the cadence", citations: [fixtureCitation("producer notes on chassidic ballad bass", "note 5")] },
      { path: "identity.era", value: "2010s", confidence: 0.3, rationale: "too weak: the era cannot be told from the tradition alone", citations: [fixtureCitation("guess")] },
      { path: "keys.voicingWidth", value: "open", confidence: 0.85, rationale: "uncited on purpose (exercises the hearsay gate)", citations: [] },
    ],
  },
  {
    when: ["genre=jazz"],
    evidence: [
      { path: "groove.swingRatio", value: 0.64, confidence: 0.8, rationale: "medium-tempo standards swing near 2:1", citations: [fixtureCitation("swing ratio measurements on standards", "fig. 1")] },
      { path: "groove.microtiming", value: "behind", confidence: 0.6, rationale: "the rhythm section sits back", citations: [fixtureCitation("microtiming study", "§4")] },
    ],
  },
];

export function createFixtureStyleResearchProvider(fixtures: readonly StyleResearchFixture[] = STYLE_RESEARCH_FIXTURES): StyleResearchProvider {
  return {
    id: FIXTURE_STYLE_RESEARCH_PROVIDER_ID,
    async research(query) {
      const world = new Set(query.world);
      const out: StructuredStyleEvidence[] = [];
      for (const fixture of fixtures) {
        if (!fixture.when.every((term) => world.has(term))) continue;
        for (const e of fixture.evidence) out.push({ ...e, providerId: FIXTURE_STYLE_RESEARCH_PROVIDER_ID });
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Converter: evidence → candidates, with the gate
// ---------------------------------------------------------------------------

export type ResearchGate = "fact" | "weak" | "discarded";

export type ResearchConversion = {
  candidates: StyleCandidate[];
  gated: Array<{ evidence: StructuredStyleEvidence; gate: ResearchGate; reason?: string }>;
  counts: { evidence: number; facts: number; weak: number; discarded: number };
};

export function gateStyleEvidence(evidence: StructuredStyleEvidence): { gate: ResearchGate; reason?: string } {
  if (!isStylePath(evidence.path)) return { gate: "discarded", reason: `${String(evidence.path)} is not a field of the contract` };
  const invalid = validateStyleValue(evidence.path, evidence.value);
  if (invalid) return { gate: "discarded", reason: invalid };
  if (!evidence.citations?.length || evidence.citations.some((c) => !c.title?.trim())) {
    return { gate: "discarded", reason: "uncited research is hearsay" };
  }
  if (!(evidence.confidence >= RESEARCH_MIN_CONFIDENCE)) return { gate: "discarded", reason: `confidence ${evidence.confidence} is below ${RESEARCH_MIN_CONFIDENCE}` };
  return { gate: evidence.confidence >= RESEARCH_FACT_CONFIDENCE ? "fact" : "weak" };
}

/**
 * Evidence becomes candidates with provenance `research` and a source ref per
 * citation. The merge then applies the policy: a fact outranks the knowledge
 * base and a clear measurement; a weak finding outranks neither and only
 * fills unknowns; nothing outranks the brief.
 */
export function styleCandidatesFromEvidence(evidence: readonly StructuredStyleEvidence[]): ResearchConversion {
  const candidates: StyleCandidate[] = [];
  const gated: ResearchConversion["gated"] = [];
  const counts = { evidence: evidence.length, facts: 0, weak: 0, discarded: 0 };
  for (const e of evidence) {
    const verdict = gateStyleEvidence(e);
    gated.push({ evidence: e, ...verdict });
    if (verdict.gate === "discarded") { counts.discarded += 1; continue; }
    if (verdict.gate === "fact") counts.facts += 1; else counts.weak += 1;
    candidates.push({
      path: e.path,
      value: e.value,
      confidence: e.confidence,
      provenance: "research",
      sourceRefs: e.citations.map((c) => `research:${e.providerId}/${c.title}${c.locator ? `#${c.locator}` : ""}`),
      rationale: e.rationale,
    });
  }
  return { candidates, gated, counts };
}

/** Ask every provider; a failing provider is a report line, never a crash. */
export async function runStyleResearch(
  providers: readonly StyleResearchProvider[],
  query: StyleResearchQuery,
): Promise<{ evidence: StructuredStyleEvidence[]; providers: Array<{ id: string; evidence: number; error?: string }> }> {
  const evidence: StructuredStyleEvidence[] = [];
  const reports: Array<{ id: string; evidence: number; error?: string }> = [];
  for (const provider of providers) {
    try {
      const found = await provider.research(query);
      evidence.push(...found.map((e) => ({ ...e, providerId: e.providerId || provider.id })));
      reports.push({ id: provider.id, evidence: found.length });
    } catch (error) {
      reports.push({ id: provider.id, evidence: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { evidence, providers: reports };
}

// ---------------------------------------------------------------------------
// Live provider seam — interface, state, env; no transport
// ---------------------------------------------------------------------------

/**
 * The env a live provider would need. Documented here and in the tracker so
 * wiring it is a transport task, not a design task:
 *   STYLE_RESEARCH_PROVIDER  which transport ("http" | "openai" | ...);
 *   STYLE_RESEARCH_API_URL   the endpoint that answers a StyleResearchQuery with StructuredStyleEvidence[];
 *   STYLE_RESEARCH_API_KEY   its credential (never logged);
 *   STYLE_RESEARCH_MODEL     optional model / index name.
 */
export const LIVE_STYLE_RESEARCH_ENV = {
  provider: "STYLE_RESEARCH_PROVIDER",
  url: "STYLE_RESEARCH_API_URL",
  key: "STYLE_RESEARCH_API_KEY",
  model: "STYLE_RESEARCH_MODEL",
} as const;

export const LIVE_STYLE_RESEARCH_REQUIRED_ENV: readonly string[] = [
  LIVE_STYLE_RESEARCH_ENV.provider, LIVE_STYLE_RESEARCH_ENV.url, LIVE_STYLE_RESEARCH_ENV.key,
];

export type LiveStyleResearchState =
  | { state: "not_configured"; missing: string[]; requiredEnv: readonly string[]; reason: string }
  | { state: "configured_unwired"; provider: StyleResearchProvider; reason: string };

export function liveStyleResearchProvider(env: Record<string, string | undefined> = process.env): LiveStyleResearchState {
  const missing = LIVE_STYLE_RESEARCH_REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length) {
    return {
      state: "not_configured",
      missing,
      requiredEnv: LIVE_STYLE_RESEARCH_REQUIRED_ENV,
      reason: `live style research is not configured (missing ${missing.join(", ")}); the resolver runs without research`,
    };
  }
  const id = `style-research-live/${env[LIVE_STYLE_RESEARCH_ENV.provider]}`;
  return {
    state: "configured_unwired",
    reason: "the live transport is not wired in B-09 (no live calls in this stream); research() rejects rather than pretend",
    provider: {
      id,
      async research() {
        throw new Error(`${id}: live style research transport is not wired (B-09 ships the interface, the fixture provider and the converter only)`);
      },
    },
  };
}
