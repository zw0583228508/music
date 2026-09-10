/**
 * Brain B-12: evidence recording for the property tests.
 *
 * A test records what it measured (seeds, pass/fail counts, the observed
 * behaviour of every known failure). When `B12_EVIDENCE_DIR` is set the
 * record is written as `<dir>/<invariant>.json`; the evidence file under
 * `docs/evidence/` is assembled from those records, never typed by hand.
 * Without the variable nothing is written, so the suites stay side-effect
 * free in the focused runner.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type SeedOutcome = {
  seed: number;
  passed: boolean;
  violations: Array<{ code: string; detail: string; count?: number }>;
  notes?: Record<string, number | string | boolean | null | string[]>;
};

export type InvariantRecord = {
  invariant: string;
  description: string;
  seeds: number[];
  passed: number;
  failed: number;
  status: "pass" | "known_failure";
  knownFailure?: string;
  violationCodes: Record<string, number>;
  outcomes: SeedOutcome[];
  extra?: Record<string, unknown>;
};

export function summarizeOutcomes(input: {
  invariant: string;
  description: string;
  outcomes: SeedOutcome[];
  knownFailure?: string;
  extra?: Record<string, unknown>;
}): InvariantRecord {
  const violationCodes: Record<string, number> = {};
  for (const outcome of input.outcomes) {
    for (const violation of outcome.violations) violationCodes[violation.code] = (violationCodes[violation.code] ?? 0) + 1;
  }
  const failed = input.outcomes.filter((o) => !o.passed).length;
  return {
    invariant: input.invariant,
    description: input.description,
    seeds: input.outcomes.map((o) => o.seed),
    passed: input.outcomes.length - failed,
    failed,
    status: failed === 0 ? "pass" : "known_failure",
    ...(failed && input.knownFailure ? { knownFailure: input.knownFailure } : {}),
    violationCodes,
    outcomes: input.outcomes.map((o) => ({ ...o, violations: o.violations.slice(0, 12) })),
    ...(input.extra ? { extra: input.extra } : {}),
  };
}

export function recordEvidence(record: InvariantRecord | { invariant: string; [key: string]: unknown }): void {
  const dir = process.env.B12_EVIDENCE_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${record.invariant}.json`), JSON.stringify(record, null, 2));
}

/** Seeds 1..n - fixed so a failure is reproducible by number, never by clock. */
export const seedsUpTo = (count: number, offset = 0): number[] => Array.from({ length: count }, (_, i) => offset + i + 1);
