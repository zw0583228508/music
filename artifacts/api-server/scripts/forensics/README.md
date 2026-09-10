# Forensic probes (PR-98)

Read-only diagnostics that reproduce, outside the API process, the exact
functions the platform runs, so a bad export can be traced to a stage instead
of guessed at. Each is bundled with esbuild and run with the repo's `.env.local`:

```
./node_modules/.bin/esbuild.CMD scripts/forensics/<name>-probe-entry.ts --bundle --platform=node --format=esm \
  --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
  --outfile=../../.tmp-tests/<name>-probe.mjs --log-level=warning
node --env-file=../../.env.local ../../.tmp-tests/<name>-probe.mjs <args>
```

| probe | what it answers |
|---|---|
| `stage` | RMS envelope after every preview-pipeline stage for a candidate's TrackModels (no DB) |
| `route` | the mix/master revision route's exact render on the real rows, per file envelope |
| `native` | send real TrackModels to the configured PEDALBOARD worker (asset per `ROLE[:instrument]=assetId`), report shape validation, plausibility gate, envelope |
| `plan` | the stored plan of an arrangement: palette, section energy targets, active families, lead role, composer tasks, tracks |
| `tracks` | the project's track rows (muted, trackModel presence) |
| `defs` | which InstrumentDefinition / native capability each planner instrument name resolves to |
