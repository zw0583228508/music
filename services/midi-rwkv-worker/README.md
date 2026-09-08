# MIDI-RWKV worker — audited, and refused

The master plan listed this provider as *"MIT code; audit weights/lineage before
any COMMERCIAL_READY claim"*, with the instruction not to lower the bar that
the other workers already meet. This directory is the result of that audit.

## The finding

| layer | licence | commercial use |
|---|---|---|
| MIDI-RWKV code ([`7c94e9e`](https://github.com/christianazinn/MIDI-RWKV/tree/7c94e9e2980d1f3cdb0d3a9ca2780ef0a5af6530)) | MIT | permitted |
| POP909 finetuning data | MIT | permitted |
| **GigaMIDI pretraining data** | **CC-BY-NC-4.0**, gated | **not permitted** |

The repository ships its base weights, `midi_rwkv.pth`, pretrained on GigaMIDI.
Those weights are a derivative of non-commercial data. A permissive licence on
the *code* does not change what the *weights* were trained on, so the
`COMMERCIAL_READY` claim cannot be made and this worker's routing status is
`BLOCKED_LICENSE` — the same fail-closed state as `LADA_BAND` and
`DIFFRHYTHM_2`.

A detail worth having on record: it is the *pretraining* data that blocks, not
the finetuning data. POP909 is MIT. The obvious guess was wrong, and the audit
recorded both the confirmed and the refuted claims in
[`release-evidence/license-review.json`](release-evidence/license-review.json).

## What is here, and why it exists at all

- `license_gate.py` — the fail-closed gate every execution path calls first.
  It reads retained evidence only. Environment variables, endpoints and tokens
  are never authorisation evidence, because none of them can change the
  training data.
- `Dockerfile` — refuses before `apt`, `git clone` or any download. The build
  steps below the gate have never run; they are kept so that authorisation is
  a manifest change rather than a rewrite.
- `modal_app.py` — refuses at import, before `import modal`, so a deploy
  attempt cannot create resources.
- `tests/test_contract.py` — proves the gate is closed, that it closes for the
  stated reason, and that nothing runtime-configurable can open it.

## The path to commercial use

Pretrain from scratch on a corpus whose licence permits commercial derivatives,
retain the corpus licence and training provenance, set
`model.commercialCorpusRetrainEvidenceRetained` to `true` in the review, and
re-audit. The MIT code makes that legitimate. The shipped weights do not.
