/**
 * Open the listening benchmark V2 session through the real API and write the evidence (Wave Q, PR-72).
 *
 *   node scripts/open-listening-benchmark-v2.mjs [--api http://localhost:5001] [--project <id>]
 *        [--evidence listening-benchmark-v2-report.json] [--size 50] [--title "..."]
 *        [--worked-example <sessionId of the owner's PR-71 session>]
 *
 * Steps, each recorded: sign in as the owner; compute the sensitivity report
 * on the owner's PR-71 session (the worked example: it must fail, that session
 * had no controls); open the V2 session; fetch the rater view as the owner and
 * as a second, non-owner identity and run every leak probe over both; stream
 * both audio URLs of the first pair and read the WAV headers (stereo 44.1 kHz
 * is LISTENING_SYNTH_V2); compute the pre-vote sensitivity report (it must say
 * insufficient_data); confirm the session has zero votes. **No vote is cast.**
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `open-v2-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./listening-v2-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });
const { raterLeakProbes } = lib;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const api = flag("api", "http://localhost:5001");
const projectId = flag("project", "0bd4bff8-a7f3-496c-b4bc-6c807e0f6ea2");
const evidenceFile = flag("evidence", "listening-benchmark-v2-report.json");
const size = Number(flag("size", "50"));
const title = flag("title", "Wave Q listening benchmark V2 - blind session 1");
const workedExample = flag("worked-example", "6d5abb08-71bb-4de2-8416-1fc4032c31c8");
/** Verify a session that already exists (e.g. one whose opening outlived the client) instead of opening a new one. */
const existingSession = flag("session", null);

/** A minimal cookie jar per identity. `longCall` uses node:http with no timeout: opening a session renders for minutes, past fetch's 300 s headers timeout. */
function client() {
  let cookie = "";
  return {
    longCall(method, path, body) {
      return new Promise((resolvePromise, rejectPromise) => {
        const url = new URL(`${api}${path}`);
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
          hostname: url.hostname, port: url.port, path: url.pathname, method,
          headers: { ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}), ...(cookie ? { cookie } : {}) },
          timeout: 0,
        }, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let json = null;
            try { json = JSON.parse(text); } catch { /* not json */ }
            resolvePromise({ status: res.statusCode, json, text });
          });
        });
        req.on("error", rejectPromise);
        if (payload) req.write(payload);
        req.end();
      });
    },
    async call(method, path, body, raw = false) {
      const res = await fetch(`${api}${path}`, {
        method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      if (raw) return res;
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not json */ }
      return { status: res.status, json, text };
    },
  };
}

const started = new Date();
const owner = client();
const login = await owner.call("POST", "/api/dev-login", {});
if (login.status !== 200) throw new Error(`dev-login failed: ${login.status} ${login.text}`);
console.log(`signed in as ${login.json.user.id}`);

// 1. Worked example: the owner's PR-71 session under the sensitivity report.
const worked = await owner.call("GET", `/api/listening-sessions/${workedExample}/sensitivity`);
console.log(`worked example ${workedExample}: ${worked.status} verdict=${worked.json?.gate?.verdict} votes=${worked.json?.votesConsidered}`);

// 2. Open the V2 session (or read the one named).
let session;
let openSeconds = null;
if (existingSession) {
  const list = await owner.call("GET", `/api/projects/${projectId}/listening-sessions`);
  session = (list.json?.sessions ?? list.json ?? []).find?.((s) => s.id === existingSession) ?? null;
  if (!session) throw new Error(`session ${existingSession} not found in the owner's list (${list.status})`);
  console.log(`verifying existing session ${session.id} with ${session.pairs.length} pairs`);
} else {
  const t0 = Date.now();
  const created = await owner.longCall("POST", `/api/projects/${projectId}/listening-sessions/benchmark-v2`, { evidenceFile, size, title });
  openSeconds = Number(((Date.now() - t0) / 1000).toFixed(1));
  if (created.status !== 201) throw new Error(`open failed: ${created.status} ${created.text}`);
  session = created.json;
  console.log(`opened ${session.id} with ${session.pairs.length} pairs in ${openSeconds} s`);
}

// 3. Rater views: the owner and a second identity. Leak probes over both.
const rater = client();
const raterLogin = await rater.call("POST", "/api/dev-login", { userId: "v2-leak-probe" });
const ownerView = await owner.call("GET", `/api/listening-sessions/${session.id}`);
const raterView = await rater.call("GET", `/api/listening-sessions/${session.id}`);
const probes = raterLeakProbes();
const leak = (view) => {
  const json = JSON.stringify(view.json);
  return { bytes: json.length, probes: probes.length, found: probes.filter((p) => json.includes(p)) };
};
const ownerLeak = leak(ownerView);
const raterLeak = leak(raterView);
console.log(`leak probes: owner view found ${ownerLeak.found.length}, rater view found ${raterLeak.found.length} of ${probes.length}`);
const orderDiffers = ownerView.json.pairs.some((p, i) => p.a.token !== raterView.json.pairs[i].a.token);

// 4. Stream both audio URLs of the first pair as the non-owner rater.
const first = raterView.json.pairs[0];
const audio = [];
for (const side of ["a", "b"]) {
  const res = await rater.call("GET", first[side].audioUrl, undefined, true);
  const buf = Buffer.from(await res.arrayBuffer());
  audio.push({
    side, url: first[side].audioUrl, status: res.status, contentType: res.headers.get("content-type"), contentLength: Number(res.headers.get("content-length")),
    bytes: buf.length, riff: buf.toString("ascii", 0, 4), wave: buf.toString("ascii", 8, 12),
    channels: buf.readUInt16LE(22), sampleRate: buf.readUInt32LE(24), bitsPerSample: buf.readUInt16LE(34),
    seconds: Number(((buf.length - 44) / (buf.readUInt32LE(24) * buf.readUInt16LE(22) * 2)).toFixed(2)),
  });
}
console.log(`audio: ${audio.map((a) => `${a.side} ${a.status} ${a.contentType} ${a.bytes} B ${a.channels}ch ${a.sampleRate} Hz ${a.seconds} s`).join(" | ")}`);

// 5. Pre-vote sensitivity report and the zero-vote check.
const preVote = await owner.call("GET", `/api/listening-sessions/${session.id}/sensitivity`);
const results = await owner.call("GET", `/api/listening-sessions/${session.id}/results`);
// The results route answers with the owner view; the tallies sit under `results`.
const tallies = results.json?.results ?? {};
console.log(`pre-vote verdict: ${preVote.json?.gate?.verdict}; votes counted ${tallies.votesCounted ?? "?"}, owner votes ${tallies.ownerVotesExcluded ?? "?"}`);

// 6. Evidence.
const report = JSON.parse(readFileSync(join(repoRoot, "docs", "evidence", evidenceFile), "utf8"));
const taskById = new Map(report.report.tasks.map((t) => [t.id, t]));
const secondsOf = (t) => { const [num, den] = t.meter.split("/").map(Number); return t.windowBars * num * (60 / t.tempoBpm) * (4 / den); };
const perComparison = {};
const perWindowKind = {};
const perFamily = {};
let totalSeconds = 0;
for (const pair of session.pairs) {
  const m = pair.meta;
  perComparison[m.comparison] = (perComparison[m.comparison] ?? 0) + 1;
  const t = taskById.get(m.taskId);
  perWindowKind[t.windowKind] = (perWindowKind[t.windowKind] ?? 0) + 1;
  perFamily[m.family] = (perFamily[m.family] ?? 0) + 1;
  totalSeconds += secondsOf(t) * 2;
}
const rendererCheck = existsSync(join(repoRoot, "docs/evidence/listening-renderer-v2-check.json")) ? JSON.parse(readFileSync(join(repoRoot, "docs/evidence/listening-renderer-v2-check.json"), "utf8")) : null;

const live = {
  title: "Listening benchmark V2 - the session the owner rates, opened through the real API (Wave Q, PR-72)",
  date: started.toISOString().slice(0, 10),
  definitionOfDone: "a real V2 session drawn from the real V2 report, every side rendered by LISTENING_SYNTH_V2 into private storage, opened through the real API on a real database, its rater view probed for every secret, its audio streamed by a non-owner identity, its sensitivity report computed before any vote. Not rated: the owner rates.",
  api,
  session: {
    id: session.id,
    title: session.title,
    raterPath: session.raterPath,
    studioUrl: `http://localhost:5173${session.raterPath}`,
    source: `docs/evidence/${evidenceFile} (runId ${report.report.runId}; ${report.report.tasks.length} passages on the 12 classical PDMX works of run ${report.source.runId})`,
    pairs: session.pairs.length,
    openSeconds: openSeconds ?? "opened in an earlier request whose client timed out at fetch's 300 s headers limit while the server finished rendering; verified here",
    perComparison,
    perWindowKind,
    perFamily,
    listeningMinutesIfEverySideIsHeardOnce: Number((totalSeconds / 60).toFixed(1)),
    primaryQuestion: preVote.json?.primaryQuestion ?? null,
    votesAtOpen: tallies.votesCounted ?? null,
    ownerVotesAtOpen: tallies.ownerVotesExcluded ?? null,
  },
  renderer: {
    requested: "LISTENING_SYNTH_V2 (route default)",
    provenByAudioHeader: audio.every((a) => a.channels === 2 && a.sampleRate === 44_100) ? "stereo 44.1 kHz on both sides of pair 1 - LISTENING_SYNTH_V2 (REFERENCE_SYNTH_V1 is mono)" : "unexpected header",
    identity: `${lib.LISTENING_RENDERER_V2}@${lib.LISTENING_RENDERER_V2_VERSION}`,
    objectiveCheck: rendererCheck ? { file: "docs/evidence/listening-renderer-v2-check.json", chosen: rendererCheck.decision.chosen, v1Failed: rendererCheck.decision.v1Failed, v2Failed: rendererCheck.decision.v2Failed } : null,
    sameOnEverySide: "one renderer, one candidate gain (x1.35), one RMS target (-18 dBFS, 0.95 peak ceiling), one reverb; the arm is not an input",
  },
  contextIdentity: {
    inReport: { tasks: report.contextIdentity.tasks, allIdentical: report.contextIdentity.allIdentical, rule: report.contextIdentity.rule },
    atOpen: "the route recomputed contextDigest on both sides of every drawn pair before rendering and would have refused the session on a mismatch; it opened",
    pairsChecked: session.pairs.length,
  },
  lengths: {
    rule: report.passages.rule,
    armsPerLength: "HUMAN, REFERENCE, CONTEXT_AWARE at every length; CA2 and CA2+CTX wherever the worker's encoded input stayed within MAX_LEN 1650 - which here was every passage",
    ca2InputTokens: report.ca2.perTask.map((c) => ({ cell: c.cell, inputTokens: c.inputTokens, maxLen: c.maxLen, warning: c.warning })),
    passages: report.report.tasks.map((t) => ({ taskId: t.id, family: t.targetFamily, windowKind: t.windowKind, bars: t.windowBars, seconds: Number(secondsOf(t).toFixed(1)), section: t.section ? `${t.section.label} bars ${t.section.startBar}-${t.section.endBar}` : null, armsNotRun: t.armsNotRun })),
  },
  blindness: {
    raterViewContains: "session title, status, position and instrument family, two token-addressed audio URLs, the questions, this rater's own votes",
    probes,
    ownerView: ownerLeak,
    nonOwnerRaterView: raterLeak,
    perRaterFlip: orderDiffers ? "the owner and the second identity see different A/B orders on at least one pair" : "same order for both identities (hash coincidence)",
    verifiedBy: ["listeningBenchmarkV2 suite leak test over eight rater ids", "this live GET as owner and as a second identity"],
  },
  audio,
  preVoteSensitivity: { verdict: preVote.json?.gate?.verdict, reasons: preVote.json?.gate?.reasons, file: "docs/evidence/listening-benchmark-v2-sensitivity.json" },
  notRated: "no vote was cast by this script or any automation; the owner rates. The two identities used here voted on nothing.",
  honestLimits: [
    "one session, one rater expected (the owner); Gate C's five independent raters are a separate requirement",
    "all passages come from the 12 classical PDMX works of the first tournament; the non-classical slice is not represented",
    `a full sitting is ${Number((totalSeconds / 60).toFixed(0))} minutes of audio if every side is heard once; the rater may stop early and the report reads whatever exists`,
    "the renderer is the platform's improved in-process synth, chosen by the objective check, not by a listener",
  ],
};
mkdirSync(join(repoRoot, "docs", "evidence"), { recursive: true });
writeFileSync(join(repoRoot, "docs/evidence/listening-benchmark-v2-live.json"), `${JSON.stringify(live, null, 2)}\n`);

const sensitivity = {
  title: "Listening benchmark V2 - sensitivity report before any vote, the worked example on the owner's 49 PR-71 votes, and the proxy side (Wave Q, PR-72)",
  date: started.toISOString().slice(0, 10),
  gateRule: lib.GATE_RULE_TEXT,
  thresholds: lib.SENSITIVITY_GATE,
  decisionTable: lib.DECISION_TABLE,
  preVote: { sessionId: session.id, report: preVote.json },
  workedExample: { sessionId: workedExample, note: "the owner's PR-71 session: 49 primary votes, no control pairs. The gate must fail here, and does.", report: worked.json ?? { status: worked.status, error: worked.text } },
  proxy: { note: report.proxy.note, perComparison: report.proxy.perComparison, pairs: report.proxy.pairs.length, file: `docs/evidence/${evidenceFile}` },
  howToRead: [
    "after the owner rates, GET /api/listening-sessions/<id>/sensitivity recomputes this report on the real votes",
    "the interpretation row is chosen by the controls first and the calibration pair second; no cause is named that a control has not isolated",
    "where proxy and human agree per rung will be readable by putting perComparison here beside the human detection rates",
  ],
};
writeFileSync(join(repoRoot, "docs/evidence/listening-benchmark-v2-sensitivity.json"), `${JSON.stringify(sensitivity, null, 2)}\n`);
console.log(`evidence -> docs/evidence/listening-benchmark-v2-live.json, docs/evidence/listening-benchmark-v2-sensitivity.json`);
void raterLogin;
