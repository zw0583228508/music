# vst3-render-worker on a Windows cloud VM (PR-95)

Two PowerShell scripts that turn a rented Windows VM into a host for the
worker one directory up, plus the reasoning for why and when that is allowed.

| file | role |
| --- | --- |
| `bootstrap-vm.ps1` | one-shot bootstrap: data disk, Python 3.11 + Git + NSSM + overlay via winget, clone, venv, asset dirs, **prompted** `VST3_RENDER_TOKEN` stored DPAPI-protected, generated `run-worker.ps1` launcher, NSSM service (or at-startup scheduled task), one firewall rule (TCP 8022 from `100.64.0.0/10` only). No public port. |
| `verify-vm.ps1` | post-bootstrap / post-smoke check: service running, listener not on `0.0.0.0`, no unrestricted firewall rule, Tailscale up, `/health` refuses without a token, `/health` healthy with it, **every expected asset attested** (`smokeEvidence.passed`, `nativeHostAttested`). Exit 1 on any failure; `-Json` for evidence. |

**Status: syntax-checked with PSParser, never executed against a cloud.** No
account was created, no VM provisioned, no money spent in PR-95. Both scripts
support `-WhatIf` for a dry run once you do have a VM.

Read, in this order:

1. `docs/model-discovery/proprietary-libraries-cloud-rights.md` — which
   libraries may run on a private single-user VM at all, and why none may be
   offered to other users.
2. `docs/model-discovery/windows-render-vm-runbook.md` — provider comparison
   with list prices, the step-by-step runbook, the owner's manual steps on the
   VM, cost-control rules, and what changes for a multi-user deployment.
3. `../README.md` — the worker itself (fail-closed contract, `discover.py`,
   `make_manifest.py --append`, `smoke.py`).

Design choices worth knowing before editing:

- The token is never a parameter, never in the registry as plain text, never
  in a log. `bootstrap-vm.ps1` prompts (`Read-Host -AsSecureString`), protects
  it with DPAPI `LocalMachine` scope, ACLs the file to SYSTEM + Administrators,
  and the launcher unprotects it in-process into `$env:VST3_RENDER_TOKEN`.
- The worker binds to the **Tailscale IPv4 address** (or `127.0.0.1` for
  cloudflared/none), so even a mistaken provider firewall rule exposes nothing.
- Content libraries are the owner's: Native Access / Spitfire App / SINE / iLok
  sign-ins happen in his RDP session; the scripts never touch a vendor account.
- `verify-vm.ps1` derives the expected asset list from the manifest so a
  library that silently failed smoke (`audible: false` — content instruments
  without a preset) shows up as a FAIL instead of being quietly "not offered".
