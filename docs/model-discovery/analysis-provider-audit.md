# Analysis providers — live audit (PR-80)

Audited 2026-09-09 with real probes under `MODAL_PROFILE=music-platform`.
Evidence: `docs/evidence/analysis-provider-audit-live.json`, validated by
`artifacts/api-server/src/lib/analysisProviderAudit.ts` (the ladder below is
cumulative: a rung is claimed only when its proof fields and every lower rung's
proof fields are present; anything that was true once and is not now lives
under `historical` and lifts nothing).

Ladder: `MANIFEST_ONLY` → `CODE_WIRED` → `DEPLOYED` → `LIVE_SMOKE` →
`BENCHMARKED` → `PROMOTED`.

## The table

| Provider | Rung | Proof for the rung claimed | Why not one higher |
|---|---|---|---|
| **BASIC_PITCH** | **LIVE_SMOKE** | Modal app `music-ai-worker` (`ap-jQ03IAgtGYp7hCLLsGfali`); authenticated `/health` 200 `ok`, model 0.4.0, checkpoint `b74344cd…`, source rev `9991303b…`, Apache-2.0, `fc-01M23TW8PCFAH2S747B0T4MZX0`, 741 ms; unauthenticated → 401. Real `POST /analyze` on the PR-46 fixture (`real-audio-source.mp3`, 9,199,873 B, sha `ae58781b…`) through the platform's lease surface: **200 in 13,861 ms**, `fc-01M23V1BT1KEPNZHXDVTRDZGZE`, 206,537 B, **1,876 notes**, pitch 26–86, confidence 0.4732 — identical count to PR-46. Cost ≈ $0.01. | No truth-set score exists anywhere in `docs/evidence`. It *is* the default in fusion (`fuseCanonicalNotes`, melody reliability 1.0), but BENCHMARKED comes first. |
| DEMUCS | CODE_WIRED | `parseSeparation("DEMUCS")`, scheduled when `DEMUCS_API_URL` is set. | `DEMUCS_API_URL` is unset. The one worker that names it is built without Torch: `/health?provider=DEMUCS` → **500** (`fc-01M23V1SBC6XVP6QXYFN80K1HH`), `/separate` → 500 (`fc-01M23V1SMFE3ZBF5XNT1K49EA0`), traceback `app.py:1317 import torch → ModuleNotFoundError`. The lease was never fetched. Never deployed (PR-37). |
| BS_ROFORMER | CODE_WIRED | `parseSeparation("BS_ROFORMER")` (fallback separation). | `LICENSE_BLOCKED`: endpoint resolution returns null for it unconditionally. Historical app stopped 2026-09-06; origin 404 today. |
| ALL_IN_ONE | CODE_WIRED | `parseStructure()`, scheduled on every full mix. | `ALL_IN_ONE_API_URL` unset; `windot100--all-in-one-isolated` → 404; not in `modal app list`. Historical live-health (ready, `4b8d00db…`) from 2026-09-06. |
| BEAT_THIS | CODE_WIRED | `parseBeatThis()`, `primary_beat_tracking` on every full mix; signed promotion bundle committed. | `windot100--beat-this` → 404; not deployed. Historical real smoke on **the same fixture** (92 beats, 16 downbeats, 0.945) belongs to a dead deployment. The bundle pins the old app id, so a redeploy needs re-signing. |
| MADMOM | CODE_WIRED | `parseMadmom()`, re-attested before every POST. | `MUSIC_MIR_API_URL` unset; `windot100--music-mir` → 404. MIR worker v5 (2026-09-06) is gone. CC-BY-NC-SA weights limit routing regardless. |
| ESSENTIA | CODE_WIRED | `parseEssentia()` (key evidence). | `MUSIC_MIR_ESSENTIA_API_URL` unset; `windot100--music-mir-essentia` → 404. |
| CHROMA | CODE_WIRED | `parseMirChroma()` (harmony evidence). | Same endpoint as ESSENTIA; 404. |
| TORCHCREPE | CODE_WIRED | `parseTorchCrepe()`, VOCAL_ONLY / SOLO_INSTRUMENT only. | `MUSIC_MIR_API_URL` unset; 404. |
| PYLOUDNORM | CODE_WIRED | `parseLoudness()`. | Same MIR worker; 404. (PR-26's pyloudnorm cross-check ran the *library* locally as a meter reference — not this endpoint.) |
| MT3 | CODE_WIRED | `parseTranscription("MT3")`, promotion record required. | `MT3_API_URL` unset; `windot100--mt3-isolated` → 404. Historical L4 smoke (48 notes). Checkpoint licence NOASSERTION. |
| MR_MT3 | CODE_WIRED | `parseTranscription("MR_MT3")`. | `MR_MT3_API_URL` unset; `windot100--mr-mt3` → 404. |
| YOUR_MT3 | CODE_WIRED | `parseTranscription("YOUR_MT3")`. | Catalogue hard-codes `unavailable`; `windot100--your-mt3` → 404. Another stream's *ephemeral* `yourmt3-worker` app was visible at audit time; not a deployment. |
| SHEETSAGE | CODE_WIRED | `parseSheetSage()` + streamed source. | `SHEETSAGE_LICENSE_AUTHORIZED` unset → endpoint null; `windot100--sheetsage` → 404. Non-commercial weights. |
| MOSS_MUSIC_INSTRUCT / _THINKING | MANIFEST_ONLY | Catalogue entry + health-attestation contract. | No request adapter; never scheduled; `BLOCKED_UPSTREAM` (TorchCodec preflight failure on record). Never had an endpoint. |
| BASS (composite) | CODE_WIRED | `analyzeVerifiedBassStem()` = TORCHCREPE + BASIC_PITCH on a BS_ROFORMER bass stem. | Unreachable by construction: no admissible stem (BS_ROFORMER blocked), no TORCHCREPE endpoint, no BASS worker. |
| CLAMP3 | CODE_WIRED | `clamp3Attestation.ts`; not scheduled by the analyzer. | `windot100--music-clamp3-worker-api` → 404; RESEARCH_ONLY. Not a fusion provider. |
| SONGFORMER | MANIFEST_ONLY | Named only in `providerReliability.ts`. | No adapter; worker `BLOCKED_LICENSE`, app stopped. |

Rung histogram: LIVE_SMOKE 1 · CODE_WIRED 15 · MANIFEST_ONLY 3 (counting the
two MOSS ids) · DEPLOYED 0 · BENCHMARKED 0 · PROMOTED 0.

## What is actually live

One provider. **Basic Pitch** on the CPU Modal worker answers an authenticated
health probe with the exact identity `attestAnalysisProviderHealth` demands,
refuses an unauthenticated caller with 401, fetched the leased fixture once
(exactly 9,199,873 bytes, the only served event on the asset surface) and
returned 1,876 notes in 13.9 s. Every other analysis endpoint recorded in the
repository — the MIR worker (MADMOM, ESSENTIA, CHROMA, TORCHCREPE, PYLOUDNORM),
Beat This, SheetSage, the MT3 family, All-In-One, BS-RoFormer, CLaMP 3 —
answers **404** from `modal-http` today and is absent from `modal app list`;
their volumes and secrets still exist, so redeploying is operations, not
research. Their `READY` / `RESEARCH_READY` classifications in
`services/*/installation-status.json` describe 2026-09-06 deployments that no
longer exist. Consequently a full song analysed on this machine today gets
notes from Basic Pitch and everything else — tempo, meter, key, sections — from
the first-party in-process engines (`LOCAL_SIGNAL_ANALYZER_V1`,
`TRANSCRIPTION_KEY_V1`), exactly as PR-46 recorded.

No provider is `BENCHMARKED`: there is no truth-set evidence file for any of
them, so nothing can honestly be `PROMOTED` on this ladder even though eleven
of them are scheduled by default in `runAnalysisProviders()` and weighted in
`providerReliability.ts`. Default-in-code is not the same as proven-better.

## Spend

≈ $0.03 of Modal, estimated (one 4 vCPU / 8 GiB CPU container for about three
minutes: cold start, five health probes, one analyze, two refused DEMUCS
calls). No GPU started, nothing deployed, nothing trained. Cap was $10.

## Honest limits

- One fixture, one run. This is a smoke of transport and identity, not a
  measurement of quality; 1,876 notes on a full mix is a polyphonic dump, not a
  melody, and the analyzer rightly refuses to call it one.
- "404 from the origin" proves the *recorded* endpoint is gone; it cannot prove
  nobody deployed the same worker under a different name. `modal app list`
  under the `music-platform` profile shows none, and that is the strongest
  statement available.
- The DEMUCS 500 is a worker bug as well as an absence: the health route should
  say `unhealthy`, as its Dockerfile promises, not crash on `import torch`.
- Costs are list-price estimates; Modal does not meter per request.
- The lease surface used here is the platform's own module, bundled verbatim,
  but driven by a script rather than by the API's source-analysis job — so
  this proves the worker and the transport, not the API's job runner (PR-46
  and PR-79 proved that path on the same file).
- Other streams of this wave had ephemeral apps running during the audit; none
  of them is counted.
