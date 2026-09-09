import assert from "node:assert/strict";
import { test } from "node:test";
import { amtScore } from "./amtBenchmark";
import {
  YOUR_MT3_CODE_REVISION,
  YOUR_MT3_MOE_SHA256,
  YOUR_MT3_MODEL_REVISION,
  adaptYourMt3Result,
  proposeYourMt3Registration,
  yourMt3NotesToAmtNotes,
  toTranscriptionAnalysisResult,
  yourMt3NotesToTranscribedNotes,
  yourMt3ResultRefusal,
} from "./yourMt3ResultAdapter";
import {
  YourMt3HttpError,
  yourMt3Endpoint,
  yourMt3EndpointRefusal,
  yourMt3Health,
  yourMt3Transcribe,
  type YourMt3Identity,
  type YourMt3TranscribeResult,
} from "./yourMt3Client";

const identity = (over: Partial<YourMt3Identity> = {}): YourMt3Identity => ({
  provider: "YOUR_MT3",
  codeRevision: YOUR_MT3_CODE_REVISION,
  modelRevision: YOUR_MT3_MODEL_REVISION,
  checkpoints: {
    verified: true,
    checkpoints: { "YPTF.MoE+Multi": { verified: true, sha256: YOUR_MT3_MOE_SHA256 } },
  },
  ...over,
});

const result = (over: Partial<YourMt3TranscribeResult> = {}): YourMt3TranscribeResult => ({
  variant: "YPTF.MoE+Multi",
  noteCount: 3,
  notes: [
    { onset: 0, offset: 0.5, pitch: 60, program: 0, isDrum: false },
    { onset: 0, offset: 1, pitch: 40, program: 33, isDrum: false },
    { onset: 0.25, offset: 0.3, pitch: 36, program: 0, isDrum: true },
  ],
  seconds: { total: 4.2 },
  realtimeFactor: 7.1,
  identity: identity(),
  ...over,
});

// --- client -----------------------------------------------------------------

test("endpoint refusal names the variable an operator has to set", () => {
  assert.match(yourMt3EndpointRefusal({} as NodeJS.ProcessEnv)!, /YOURMT3_API_URL is not set/);
  assert.match(
    yourMt3EndpointRefusal({ YOURMT3_API_URL: "https://x.modal.run" } as NodeJS.ProcessEnv)!,
    /YOURMT3_API_TOKEN is not set/,
  );
  assert.match(
    yourMt3EndpointRefusal({ YOURMT3_API_URL: "not a url", YOURMT3_API_TOKEN: "t" } as NodeJS.ProcessEnv)!,
    /is not a URL/,
  );
});

test("a bearer token may not travel over plain http, except to localhost", () => {
  assert.match(
    yourMt3EndpointRefusal({ YOURMT3_API_URL: "http://example.com", YOURMT3_API_TOKEN: "t" } as NodeJS.ProcessEnv)!,
    /must be https/,
  );
  assert.equal(
    yourMt3EndpointRefusal({ YOURMT3_API_URL: "http://localhost:8012", YOURMT3_API_TOKEN: "t" } as NodeJS.ProcessEnv),
    null,
  );
});

test("the shared worker token is not accepted as a fallback", () => {
  // One provider, one credential: MUSIC_AI_WORKER_TOKEN must not satisfy this.
  const refusal = yourMt3EndpointRefusal({
    YOURMT3_API_URL: "https://x.modal.run",
    MUSIC_AI_WORKER_TOKEN: "shared",
  } as NodeJS.ProcessEnv);
  assert.match(refusal!, /YOURMT3_API_TOKEN is not set/);
});

test("endpoint strips trailing slashes so paths do not double up", () => {
  const endpoint = yourMt3Endpoint({
    YOURMT3_API_URL: "https://x.modal.run///",
    YOURMT3_API_TOKEN: "t",
  } as NodeJS.ProcessEnv);
  assert.equal(endpoint?.baseUrl, "https://x.modal.run");
});

test("health sends the bearer token and returns the body", async () => {
  const seen: Array<{ url: string; auth: string | null }> = [];
  const body = await yourMt3Health(
    { baseUrl: "https://x.modal.run", token: "secret-token" },
    {
      fetchImpl: async (url, init) => {
        seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
        return new Response(JSON.stringify({ healthy: true, ...identity() }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );
  assert.equal(seen[0].url, "https://x.modal.run/health");
  assert.equal(seen[0].auth, "Bearer secret-token");
  assert.equal(body.healthy, true);
});

test("a non-2xx becomes a typed error carrying the status and body, not an empty result", async () => {
  await assert.rejects(
    yourMt3Health(
      { baseUrl: "https://x.modal.run", token: "wrong" },
      { fetchImpl: async () => new Response(JSON.stringify({ detail: "bearer token missing or wrong" }), { status: 401 }) },
    ),
    (error: unknown) => {
      assert.ok(error instanceof YourMt3HttpError);
      assert.equal(error.status, 401);
      assert.equal(error.call, "health");
      return true;
    },
  );
});

test("transcribe posts multipart with the variant and attaches the identity the caller verified", async () => {
  let form: FormData | null = null;
  const out = await yourMt3Transcribe(
    { baseUrl: "https://x.modal.run", token: "t" },
    { wav: new Uint8Array([82, 73, 70, 70]), variant: "YPTF+Single" },
    {
      identity: identity({ codeRevision: YOUR_MT3_CODE_REVISION }),
      fetchImpl: async (_url, init) => {
        form = init?.body as FormData;
        return new Response(JSON.stringify(result({ identity: undefined })), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );
  assert.equal(form!.get("variant"), "YPTF+Single");
  assert.ok(form!.get("audio"), "the WAV must be sent as a file part");
  assert.equal(out.identity?.codeRevision, YOUR_MT3_CODE_REVISION);
});

// --- adapter ----------------------------------------------------------------

test("a result from the audited checkpoint is accepted", () => {
  assert.equal(yourMt3ResultRefusal(result()), null);
});

test("a result from a different revision or a different checkpoint hash is refused", () => {
  assert.match(
    yourMt3ResultRefusal(result({ identity: identity({ modelRevision: "0".repeat(40) }) }))!,
    /model revision 000000000000 is not the audited/,
  );
  assert.match(
    yourMt3ResultRefusal(result({ identity: identity({ codeRevision: "f".repeat(40) }) }))!,
    /code revision ffffffffffff is not the audited/,
  );
  assert.match(
    yourMt3ResultRefusal(
      result({
        identity: identity({
          checkpoints: { verified: true, checkpoints: { "YPTF.MoE+Multi": { sha256: "a".repeat(64) } } },
        }),
      }),
    )!,
    /hashes to aaaaaaaaaaaa/,
  );
});

test("a container that could not verify its own checkpoints is refused", () => {
  assert.match(
    yourMt3ResultRefusal(result({ identity: identity({ checkpoints: { verified: false } }) }))!,
    /could not verify its checkpoint checksums/,
  );
});

test("a result from another provider is refused", () => {
  assert.match(yourMt3ResultRefusal(result({ identity: identity({ provider: "BASIC_PITCH" }) }))!, /not YOUR_MT3/);
});

test("adapting keeps the instrument, which is the whole point of this model", () => {
  const adapted = adaptYourMt3Result(result());
  assert.equal(adapted.notes.length, 3);
  assert.deepEqual(adapted.account.instrumentClasses.sort(), ["bass", "drums", "keys"]);
  const drum = adapted.notes.find((n) => n.isDrum);
  assert.equal(drum?.instrumentClass, "drums");
  assert.equal(drum?.program, 0, "a drum note's program is meaningless and is normalised away");
  assert.equal(adapted.notes.find((n) => n.pitch === 40)?.instrumentClass, "bass");
});

test("the flat melody shape is lossy, and the adapter says so instead of hiding it", () => {
  const adapted = adaptYourMt3Result(result());
  // Only the most populated non-drum class survives the flat shape.
  assert.ok(adapted.melody.length < adapted.notes.length);
  assert.match(adapted.account.informationLoss.join(" "), /flat melody shape carries only/);
  assert.match(adapted.account.informationLoss.join(" "), /velocity is not measured/);
});

test("the caller may choose which instrument class becomes the flat melody", () => {
  const adapted = adaptYourMt3Result(result(), { melodyInstrumentClass: "bass" });
  assert.equal(adapted.melody.length, 1);
  assert.equal(adapted.melody[0].pitch, 40);
});

test("degenerate notes are dropped and counted, never silently kept", () => {
  const { notes, droppedDegenerate } = yourMt3NotesToTranscribedNotes([
    { onset: 0, offset: 0, pitch: 60, program: 0, isDrum: false },
    { onset: 1, offset: 1.001, pitch: 61, program: 0, isDrum: false },
    { onset: 2, offset: 2.5, pitch: 62, program: 0, isDrum: false },
  ]);
  assert.equal(notes.length, 1);
  assert.equal(droppedDegenerate, 2);
});

test("provenance is `fallback`, not `ready`, when the container could not verify its checkpoints", () => {
  const verified = adaptYourMt3Result(result());
  assert.equal(verified.provenance.status, "ready");
  const unverified = adaptYourMt3Result(result({ identity: identity({ checkpoints: { verified: undefined } }) }));
  assert.equal(unverified.provenance.status, "fallback");
  assert.equal(unverified.provenance.provider, "YOUR_MT3");
  assert.equal(unverified.provenance.capability, "transcription");
});

test("adapting refuses rather than returning half a result", () => {
  assert.throws(
    () => adaptYourMt3Result(result({ identity: identity({ provider: "MT3" }) })),
    /YourMT3 result refused/,
  );
});

test("the adapter's note shape grades directly against the benchmark metric", () => {
  // The point of `yourMt3NotesToAmtNotes`: no second conversion between the
  // worker and the grader, so a units bug cannot hide between them.
  const truth = yourMt3NotesToAmtNotes(result().notes);
  assert.equal(amtScore(truth, truth, "instrument_onset_offset").f1, 1);
  assert.equal(truth[2].program, 0);
  assert.equal(truth[2].isDrum, true);
});

test("the narrowed view is a TranscriptionAnalysisResult, and its confidence is verification not skill", () => {
  const adapted = adaptYourMt3Result(result());
  const narrowed = toTranscriptionAnalysisResult(adapted);
  assert.equal(narrowed.providerId, "YOUR_MT3");
  assert.deepEqual(narrowed.notes, adapted.melody);
  assert.match(narrowed.version, /^YPTF\.MoE\+Multi@/);
  // 1 because the container verified its checkpoints — not because the model
  // said it was sure. It says nothing at all.
  assert.equal(narrowed.confidence, 1);
  // `verified: false` is refused outright, so the 0 case is a worker that
  // reported no verification state at all — configured, but not attested.
  const unverified = toTranscriptionAnalysisResult(
    adaptYourMt3Result(result({ identity: identity({ checkpoints: { verified: undefined } }) })),
  );
  assert.equal(unverified.confidence, 0);
});

// --- registration proposal --------------------------------------------------

test("a winning benchmark alone does not unblock registration, and never changes routing", () => {
  const proposal = proposeYourMt3Registration({
    measuredF1: 0.51,
    incumbent: { name: "MT3", f1: 0.2 },
    tier: "SYNTHETIC_EXACT",
    realAudioTierMeasured: false,
    codeLicenceResolved: false,
    trainingDataTermsRead: false,
  });
  assert.equal(proposal.routing, "no_change");
  assert.equal(proposal.satisfied.length, 1);
  assert.equal(proposal.blockers.length, 3);
  assert.match(proposal.blockers.join(" "), /GPL-3.0/);
  assert.match(proposal.blockers.join(" "), /synthetic-timbre tier cannot predict/);
});

test("losing the benchmark is itself a blocker", () => {
  const proposal = proposeYourMt3Registration({
    measuredF1: 0.1,
    incumbent: { name: "MT3", f1: 0.2 },
    tier: "SYNTHETIC_EXACT",
    realAudioTierMeasured: true,
    codeLicenceResolved: true,
    trainingDataTermsRead: true,
  });
  assert.equal(proposal.routing, "no_change");
  assert.equal(proposal.blockers.length, 1);
  assert.match(proposal.blockers[0], /does not beat MT3/);
});

test("even with everything satisfied the proposal still refuses to route", () => {
  const proposal = proposeYourMt3Registration({
    measuredF1: 0.9,
    incumbent: { name: "MT3", f1: 0.2 },
    tier: "REAL_AUDIO",
    realAudioTierMeasured: true,
    codeLicenceResolved: true,
    trainingDataTermsRead: true,
  });
  assert.equal(proposal.blockers.length, 0);
  // Promotion is a decision, not a consequence of a passing test.
  assert.equal(proposal.routing, "no_change");
  // The measured choice, not the leaderboard's: YPTF+Single placed 3rd on the
  // 2025 AMT Challenge and YPTF.MoE+Multi placed 2nd, and on our own benchmark
  // that order reverses. Pinning this stops a future edit from quietly
  // reverting to the published ranking.
  assert.equal(proposal.proposed.defaultVariant, "YPTF+Single");
});
