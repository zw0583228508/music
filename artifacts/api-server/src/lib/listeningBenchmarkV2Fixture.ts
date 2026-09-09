/** A V2 report fixture shared by the benchmark and sensitivity suites (PR-72). Not a sample of anything. */
import { DEGRADATION_LADDER, degradedProviderId } from "./listeningDegradations";
import type { V2ReportLike } from "./listeningBenchmarkV2";
import { CA2_CONTEXT_SUT, HUMAN_SUT, REFERENCE_SUT } from "./tournamentProviders";

const FAMILIES = ["bass", "keys", "strings", "brass", "reed", "organ", "bass", "keys", "strings", "brass", "reed", "organ"];

/**
 * A V2 report shaped like the runner's: 12 tasks at two window kinds (16 bars
 * and a section), one seed, HUMAN / REFERENCE / CA2+CTX entries plus every
 * control rung derived from the human side. CA2 is absent on the section
 * tasks, as it would be when the section exceeds MAX_LEN.
 */
export function v2Report(options: { ca2OnSections?: boolean } = {}): V2ReportLike {
  const seeds = [7];
  const tasks = FAMILIES.flatMap((family, i) => [
    { id: `t${i}b16`, targetFamily: family, targetInst: 30 + i, windowKind: "bars16" as const, windowBars: 16, section: null },
    { id: `t${i}sec`, targetFamily: family, targetInst: 30 + i, windowKind: "section" as const, windowBars: 12 + (i % 3) * 4, section: { label: "B", startBar: 8, endBar: 24 } },
  ]);
  const entries = tasks.flatMap((task) => seeds.flatMap((seed) => {
    const arms = [HUMAN_SUT, REFERENCE_SUT, ...DEGRADATION_LADDER.map((r) => degradedProviderId(r))];
    if (task.windowKind === "bars16" || options.ca2OnSections) arms.push(CA2_CONTEXT_SUT);
    return arms.map((arm) => ({
      key: `${task.id}:${seed}:${arm}`, taskId: task.id, seed, targetFamily: task.targetFamily, providerId: arm,
      failure: null, midi: `docs/evidence/listening-v2/${task.id}-${seed}-${arm.replace(/[:+]/g, "_")}.mid`,
      judgement: { metrics: { noteCount: 24 } },
    }));
  }));
  return { runId: "v2-run", seeds, tasks, entries };
}
