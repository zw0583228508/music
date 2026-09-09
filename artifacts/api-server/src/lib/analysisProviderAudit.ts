/**
 * Analysis provider audit ladder (PR-80, `analysis-provider-live-audit`).
 *
 * Every analysis provider the platform names is placed on one rung of a
 * six-step ladder, and a rung may be claimed only when the proof for it — and
 * for every rung below it — is present in the evidence file. The ladder is
 * cumulative on purpose: a provider that is scheduled by default in the
 * analyzer's fusion but has never been scored against a truth set is not
 * PROMOTED, it is whatever its highest fully-proven rung is, with a note.
 *
 *   MANIFEST_ONLY  named in a catalogue / manifest / enum only
 *   CODE_WIRED     an adapter exists and typechecks
 *   DEPLOYED       a reachable endpoint or worker answered a health probe
 *   LIVE_SMOKE     one real inference on the real-audio fixture (PR-46's)
 *   BENCHMARKED    scored against a truth set, with an evidence file
 *   PROMOTED       default in the analyzer's fusion, with the code path cited
 *
 * "UNKNOWN" is an admissible value for a cost or a latency: it says the number
 * was not measured, which is more accurate than a guess. It is never an
 * admissible substitute for a proof field.
 *
 * This module is pure: it types the evidence document and validates it. The
 * live probes that produced the document live outside the API server.
 */

export const AUDIT_RUNGS = [
  "MANIFEST_ONLY",
  "CODE_WIRED",
  "DEPLOYED",
  "LIVE_SMOKE",
  "BENCHMARKED",
  "PROMOTED",
] as const;

export type AuditRung = (typeof AUDIT_RUNGS)[number];

export const UNKNOWN = "UNKNOWN" as const;
export type Unknown = typeof UNKNOWN;

/** Where the provider is named. Required on every rung. */
export type ManifestProof = {
  file: string;
  symbol: string;
};

/** The adapter that speaks to it, and where (if anywhere) it is scheduled. */
export type CodeWiredProof = {
  adapter: string;
  /** The scheduling call site, or null when nothing ever calls the adapter. */
  scheduledIn: string | null;
  typecheck: "green" | Unknown;
};

export type HealthObservation = {
  httpStatus: number;
  status: string;
  modelVersion: string;
  checksum: string;
  requestId: string;
  latencyMs: number;
  probedAt: string;
};

export type DeployedProof = {
  modalApp: string;
  modalAppId: string | Unknown;
  /** The environment variable the adapter reads to find it. */
  endpointEnv: string;
  health: HealthObservation;
};

export type LiveSmokeProof = {
  fixture: { path: string; sha256: string; bytes: number };
  requestId: string;
  latencyMs: number;
  outputBytes: number;
  outputSummary: string;
  modelVersion: string;
  checksum: string;
  costUsd: number | Unknown;
  smokedAt: string;
  /** The evidence file that holds the full request/response record. */
  evidence: string;
};

export type BenchmarkedProof = {
  evidenceFile: string;
  truthSet: string;
  metric: string;
  score: number | Unknown;
};

export type PromotedProof = {
  /** The fusion call site that consumes this provider by default. */
  codePath: string;
  reliabilityDomains: Record<string, number>;
};

export type ProviderAuditProof = {
  manifest?: ManifestProof;
  codeWired?: CodeWiredProof;
  deployed?: DeployedProof;
  liveSmoke?: LiveSmokeProof;
  benchmarked?: BenchmarkedProof;
  promoted?: PromotedProof;
};

export type ProviderAuditEntry = {
  id: string;
  family: string;
  capabilities: string[];
  rung: AuditRung;
  proof: ProviderAuditProof;
  /**
   * Evidence that was true once and is not now (a stopped Modal app, a smoke
   * from a deployment that no longer answers). Kept apart from `proof` so it
   * can never lift a rung.
   */
  historical?: Record<string, unknown>;
  nextRung: AuditRung | null;
  whatWouldMoveItUp: string;
  costUsd: number | Unknown;
  latencyMs: number | Unknown;
  notes: string[];
};

export type AnalysisProviderAudit = {
  title: string;
  date: string;
  ladder: readonly string[];
  providers: ProviderAuditEntry[];
};

export function rungIndex(rung: string): number {
  return AUDIT_RUNGS.indexOf(rung as AuditRung);
}

export function isAuditRung(value: unknown): value is AuditRung {
  return typeof value === "string" && rungIndex(value) >= 0;
}

export function nextRungAfter(rung: AuditRung): AuditRung | null {
  const index = rungIndex(rung);
  return index >= 0 && index < AUDIT_RUNGS.length - 1 ? AUDIT_RUNGS[index + 1] : null;
}

/** Each rung's proof key and the fields that key must carry, dotted. */
const PROOF_REQUIREMENTS: Readonly<Record<AuditRung, { key: keyof ProviderAuditProof; fields: readonly string[] }>> = {
  MANIFEST_ONLY: { key: "manifest", fields: ["file", "symbol"] },
  CODE_WIRED: { key: "codeWired", fields: ["adapter", "typecheck"] },
  DEPLOYED: {
    key: "deployed",
    fields: [
      "modalApp", "modalAppId", "endpointEnv",
      "health.httpStatus", "health.status", "health.modelVersion",
      "health.checksum", "health.requestId", "health.latencyMs", "health.probedAt",
    ],
  },
  LIVE_SMOKE: {
    key: "liveSmoke",
    fields: [
      "fixture.path", "fixture.sha256", "fixture.bytes",
      "requestId", "latencyMs", "outputBytes", "outputSummary",
      "modelVersion", "checksum", "costUsd", "smokedAt", "evidence",
    ],
  },
  BENCHMARKED: { key: "benchmarked", fields: ["evidenceFile", "truthSet", "metric", "score"] },
  PROMOTED: { key: "promoted", fields: ["codePath", "reliabilityDomains"] },
};

const HEALTHY_STATUSES = new Set(["healthy", "ready", "ok"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const part of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

/** A proof field is present when it is a non-empty string, a finite number, or a non-empty object. */
function proofFieldPresent(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (isRecord(value)) return Object.keys(value).length > 0;
  return false;
}

function measurement(value: unknown): value is number | Unknown {
  return value === UNKNOWN || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

/**
 * Every reason an entry may not claim the rung it claims. An empty list means
 * the claim is proven as far as this document can prove it.
 */
export function validateProviderAuditEntry(entry: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(entry)) return ["entry must be an object"];
  const id = typeof entry.id === "string" && entry.id.trim() ? entry.id : "<no id>";
  const label = (message: string) => `${id}: ${message}`;

  if (id === "<no id>") issues.push("entry is missing its id");
  if (typeof entry.family !== "string" || !entry.family.trim()) issues.push(label("family is required"));
  if (!Array.isArray(entry.capabilities) || !entry.capabilities.length ||
      !entry.capabilities.every((c) => typeof c === "string" && c.trim())) {
    issues.push(label("capabilities must be a non-empty list of strings"));
  }
  if (!isAuditRung(entry.rung)) {
    issues.push(label(`rung must be one of ${AUDIT_RUNGS.join(", ")}`));
    return issues;
  }
  const rung = entry.rung;
  const claimed = rungIndex(rung);
  const proof = isRecord(entry.proof) ? entry.proof : null;
  if (!proof) {
    issues.push(label("proof object is required"));
    return issues;
  }

  // Cumulative: every rung up to and including the claimed one needs its proof.
  for (let index = 0; index <= claimed; index += 1) {
    const step = AUDIT_RUNGS[index];
    const requirement = PROOF_REQUIREMENTS[step];
    const block = proof[requirement.key];
    if (!isRecord(block)) {
      issues.push(label(`rung ${rung} claimed but proof.${requirement.key} (for ${step}) is missing`));
      continue;
    }
    for (const field of requirement.fields) {
      if (!proofFieldPresent(readPath(block, field))) {
        issues.push(label(`rung ${rung} claimed but proof.${requirement.key}.${field} is missing or empty`));
      }
    }
  }
  // Honesty in the other direction: proof for an unclaimed rung belongs in
  // `historical`, or the rung should be claimed.
  for (let index = claimed + 1; index < AUDIT_RUNGS.length; index += 1) {
    const step = AUDIT_RUNGS[index];
    const requirement = PROOF_REQUIREMENTS[step];
    if (proof[requirement.key] !== undefined) {
      issues.push(label(
        `proof.${requirement.key} is present but rung ${rung} is claimed; claim ${step} or move it to historical`,
      ));
    }
  }

  const deployed = proof.deployed;
  if (claimed >= rungIndex("DEPLOYED") && isRecord(deployed) && isRecord(deployed.health)) {
    if (deployed.health.httpStatus !== 200) {
      issues.push(label("DEPLOYED requires a health probe that answered HTTP 200"));
    }
    const status = typeof deployed.health.status === "string" ? deployed.health.status.toLowerCase() : "";
    if (!HEALTHY_STATUSES.has(status)) {
      issues.push(label("DEPLOYED requires a health status of healthy, ready or ok"));
    }
  }
  const liveSmoke = proof.liveSmoke;
  if (claimed >= rungIndex("LIVE_SMOKE") && isRecord(liveSmoke)) {
    if (!measurement(liveSmoke.costUsd)) issues.push(label("liveSmoke.costUsd must be a number or UNKNOWN"));
    if (typeof liveSmoke.outputBytes !== "number" || liveSmoke.outputBytes <= 0) {
      issues.push(label("LIVE_SMOKE requires a non-empty output"));
    }
    if (isRecord(deployed) && isRecord(deployed.health) &&
        typeof liveSmoke.checksum === "string" && typeof deployed.health.checksum === "string" &&
        liveSmoke.checksum !== deployed.health.checksum) {
      issues.push(label("liveSmoke.checksum must equal the checksum the health probe attested"));
    }
  }
  const benchmarked = proof.benchmarked;
  if (claimed >= rungIndex("BENCHMARKED") && isRecord(benchmarked) && !measurement(benchmarked.score)) {
    issues.push(label("benchmarked.score must be a number or UNKNOWN"));
  }

  const expectedNext = nextRungAfter(rung);
  if (entry.nextRung !== expectedNext) {
    issues.push(label(`nextRung must be ${expectedNext ?? "null"} for rung ${rung}`));
  }
  if (expectedNext && (typeof entry.whatWouldMoveItUp !== "string" || !entry.whatWouldMoveItUp.trim())) {
    issues.push(label("whatWouldMoveItUp is required below PROMOTED"));
  }
  if (!measurement(entry.costUsd)) issues.push(label("costUsd must be a number or UNKNOWN"));
  if (!measurement(entry.latencyMs)) issues.push(label("latencyMs must be a number or UNKNOWN"));
  if (!Array.isArray(entry.notes) || !entry.notes.every((n) => typeof n === "string")) {
    issues.push(label("notes must be a list of strings"));
  }
  if (entry.historical !== undefined && !isRecord(entry.historical)) {
    issues.push(label("historical, when present, must be an object"));
  }
  return issues;
}

/** Validates the whole evidence document; an empty list means it may be trusted as far as it goes. */
export function validateAnalysisProviderAudit(document: unknown): string[] {
  if (!isRecord(document)) return ["audit document must be an object"];
  const issues: string[] = [];
  if (typeof document.title !== "string" || !document.title.trim()) issues.push("title is required");
  if (typeof document.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(document.date)) {
    issues.push("date must be YYYY-MM-DD");
  }
  if (!Array.isArray(document.ladder) ||
      document.ladder.length !== AUDIT_RUNGS.length ||
      !document.ladder.every((rung, index) => rung === AUDIT_RUNGS[index])) {
    issues.push(`ladder must be exactly [${AUDIT_RUNGS.join(", ")}] in that order`);
  }
  if (!Array.isArray(document.providers) || !document.providers.length) {
    issues.push("providers must be a non-empty list");
    return issues;
  }
  const seen = new Set<string>();
  for (const entry of document.providers) {
    issues.push(...validateProviderAuditEntry(entry));
    if (isRecord(entry) && typeof entry.id === "string") {
      if (seen.has(entry.id)) issues.push(`${entry.id}: listed more than once`);
      seen.add(entry.id);
    }
  }
  return issues;
}

/** Rung counts, for the summary table. */
export function rungHistogram(document: AnalysisProviderAudit): Record<AuditRung, number> {
  const histogram = Object.fromEntries(AUDIT_RUNGS.map((rung) => [rung, 0])) as Record<AuditRung, number>;
  for (const entry of document.providers) histogram[entry.rung] += 1;
  return histogram;
}
