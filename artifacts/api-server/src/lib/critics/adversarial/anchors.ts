/**
 * Anchor arrangements for the adversarial critic's tests and evidence
 * (Brain B-05b): the reference composer run through the real orchestrator on
 * the synthetic benchmark corpus. Deterministic (fixed `now`, one candidate),
 * memoised per case because each module's test generates the same anchors.
 */
import { BENCHMARK_CORPUS, buildBenchmarkSongModel, type BenchmarkCase } from "../../benchmarkCorpus";
import { orchestrateArrangement } from "../../arrangementOrchestrator";
import type { CriticInput } from "../types";

export const ANCHOR_NOW = new Date("2026-01-01T00:00:00.000Z");

export type Anchor = { id: string; spec: BenchmarkCase; input: CriticInput; composer: string; noteCount: number };

/** The corpus cases used as anchors: vocal pop, instrumental 3/4 orchestral, cinematic, rock, jazz, ballad. */
export const ANCHOR_CASE_IDS = ["pop-full", "orchestral-midi", "cinematic-midi", "rock-full", "jazz-full", "ballad-piano-vocal"] as const;

const cache = new Map<string, Anchor>();

export function anchorFor(caseId: string): Anchor {
  const cached = cache.get(caseId);
  if (cached) return cached;
  const spec = BENCHMARK_CORPUS.find((c) => c.id === caseId);
  if (!spec) throw new Error(`unknown benchmark case ${caseId}`);
  const songModel = buildBenchmarkSongModel(spec);
  const result = orchestrateArrangement({ songModel, candidateCount: 1, render: false, now: ANCHOR_NOW });
  const candidate = result.candidates[0];
  if (!candidate) throw new Error(`the orchestrator produced no candidate for ${caseId}`);
  const anchor: Anchor = {
    id: caseId, spec,
    input: { songModel, plan: result.plan, trackModels: candidate.trackModels },
    composer: result.composer, noteCount: candidate.noteCount,
  };
  cache.set(caseId, anchor);
  return anchor;
}

export function anchors(ids: readonly string[] = ANCHOR_CASE_IDS): Anchor[] {
  return ids.map(anchorFor);
}
