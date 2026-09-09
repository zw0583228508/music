# Windows render VM — provider comparison and runbook (2026-09-10, not executed)

**Purpose.** Run `services/vst3-render-worker` unchanged on a rented Windows
VM so the owner's free-but-proprietary libraries (Kontakt Player libraries,
Spitfire, SINE, Soundpaint, Ample, SSD5 Free, Decent Sampler / Pianobook, VSL
BBO Free Basics, MT Power Drum Kit, the Steinberg content that comes with his
Cubase 14 licence) render "in the cloud" **for his own private single-user
use**. The licence question is answered per product in
`proprietary-libraries-cloud-rights.md`; this document is the *how*, priced,
with the cost-control rules the licences themselves impose.

**Status.** Nothing here was executed. No cloud account was created, no VM
provisioned, no list price paid. Prices are list prices read on 2026-09-10 from
the URLs given; both PowerShell scripts were syntax-checked (PSParser) only.
The owner runs every step below in his **own** account.

## 1. What the VM has to be

The worker is a Python 3.11 FastAPI process that hosts one VST3 instrument
per render through pedalboard (offline, not real-time) and fails closed
without its token, manifest, host digest and smoke proof (`../../services/vst3-render-worker/README.md`).
Requirements that follow from that and from the libraries:

| need | why | target |
| --- | --- | --- |
| Windows x64 | the worker and every vendor player are Windows/macOS builds; the finding that pedalboard needs the inner `.vst3` binary was made on Windows | Windows Server 2022/2025 Datacenter (pay-as-you-go image) **or** Windows 11 where the provider licenses it (see §2.4) |
| 4–8 vCPU | one plugin instance per render; Kontakt/SINE decode on one or two cores; headroom for the OS and the overlay | 4 vCPU to start, 8 if renders queue |
| 16–32 GB RAM | Kontakt Player libraries preload sample heads into RAM; GLADE/SSO Discover are 5–13 GB on disk | 16 GB; 32 GB only if several large libraries load per render |
| 500 GB–1 TB SSD data disk | Komplete Start + SSO Discover (5.7 GB) + GLADE (12.5 GB) + BFO + Blueprint + SSD5 + Soundpaint + Pianobook picks fit in < 250 GB; 500 GB leaves room, 1 TB is comfort | 512 GB Standard SSD; upgrade to 1 TB when the content list demands it |
| RDP for the owner | Native Access, Spitfire App, SINE, iLok, Soundpaint sign-ins are GUI-only and personal | RDP **over the overlay** (Tailscale) — no public 3389 |
| **no public inbound port** for the worker | PR-41's rule for the API applies to the worker too; the worker's bearer token is the only lock | Tailscale (default) or Cloudflare Tunnel; the worker binds to the Tailscale address or loopback |
| start/stop from the owner's PC | pay per hour; render sessions are bursty | provider CLI + auto-shutdown |
| in-country region | RDP latency; nothing else in the pipeline is latency-bound (renders are batch) | Azure Israel Central, AWS il-central-1, Kamatera Tel Aviv |

## 2. Three providers, list prices (read 2026-09-10)

### 2.1 Microsoft Azure — region `israelcentral`

Source: Azure Retail Prices API, `https://prices.azure.com/api/retail/prices?$filter=armRegionName eq 'israelcentral' …`
(public, no account), fetched 2026-09-10. USD, `priceType = Consumption`.
`effectiveStartDate` 2024-02-01 (Dsv5), 2024-01-01 (Bsv2), Spot rows 2025-09/10.

| SKU | vCPU / RAM | Windows $/h | Linux $/h | Windows Spot $/h | Windows $/month (730 h) |
| --- | --- | --- | --- | --- | --- |
| Standard_D4s_v5 | 4 / 16 GB | **0.408** | 0.224 | 0.075398 | 297.84 |
| Standard_D8s_v5 | 8 / 32 GB | **0.816** | 0.448 | 0.150797 | 595.68 |
| Standard_B4s_v2 (burstable) | 4 / 16 GB | **0.21** | 0.192 | 0.189 | 153.30 |
| Standard_B8s_v2 (burstable) | 8 / 32 GB | **0.42** | 0.383 | 0.378 | 306.60 |

Managed disks, same region and source (per month, LRS):

| disk | size | $/month |
| --- | --- | --- |
| E20 Standard SSD | 512 GB | 46.08 |
| E30 Standard SSD | 1 TB | 92.16 |
| P20 Premium SSD | 512 GB | 79.872 |
| P30 Premium SSD | 1 TB | 147.456 |
| snapshots (Standard HDD-backed) | per GB | 0.06 |
| snapshots (Premium-backed) | per GB | 0.144 |

RDP: yes (Windows image; open 3389 only to the overlay — leave the NSG with no
inbound rules once Tailscale is up). Start/stop: `az vm start` /
`az vm deallocate`; **Auto-shutdown** is a per-VM setting (portal → Operations
→ Auto-shutdown, or `az vm auto-shutdown -g <rg> -n <vm> --time 18:00`;
Microsoft Learn `virtual-machines/auto-shutdown-vm`, updated 2026-06-24). A
deallocated VM stops compute billing; disks and snapshots keep billing.
Windows 11 images: only for Visual Studio subscribers / multitenant hosting
rights (Microsoft Learn `virtual-machines/windows/client-images`, updated
2025-11-20) — the pay-as-you-go path is Windows Server.
Latency from Israel: in-country region; not measured here.

### 2.2 Amazon Web Services — region `il-central-1` (Israel, Tel Aviv)

Source: the JSON the EC2 pricing page itself loads,
`https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/Israel%20(Tel%20Aviv)/Windows/index.json`,
publication date `2026-09-09T16:49:38Z`, fetched 2026-09-10. USD, on-demand,
Windows licence included.

| instance | vCPU / RAM | Windows $/h | $/month (730 h) |
| --- | --- | --- | --- |
| m6i.xlarge | 4 / 16 GiB | **0.4087** | 298.35 |
| m7i.xlarge | 4 / 16 GiB | 0.4199 | 306.53 |
| r6i.xlarge | 4 / 32 GiB | 0.4801 | 350.47 |
| t3.2xlarge (burstable) | 8 / 32 GiB | 0.5306 | 387.34 |
| m6i.2xlarge | 8 / 32 GiB | **0.8174** | 596.70 |
| m7i.2xlarge | 8 / 32 GiB | 0.8399 | 613.13 |

(For scale: m7i.2xlarge Windows in eu-central-1 Frankfurt is 0.8510 from the
same source.) **EBS gp3 for il-central-1 was not fetched** — the EBS pricing
page renders prices with JavaScript and quotes only an illustrative "$0.08 per
GB-month"; budget 500 GB gp3 at roughly $40–50/month and confirm in the
console before creating the volume. Snapshots are billed per GB-month on the
same page.

RDP: yes (Windows AMI; security group with **no** inbound rules once the
overlay is up; the AMI's generated Administrator password is retrieved with
the key pair). Start/stop: `aws ec2 stop-instances` / `start-instances`; while
stopped you pay EBS, not instance hours; schedule with Instance Scheduler on
AWS or EventBridge + Lambda (AWS docs `AWSEC2/latest/UserGuide/Stop_Start.html`).
Latency from Israel: in-country region; not measured here.

### 2.3 Kamatera — data centre "Israel, Tel Aviv"

Source: `https://www.kamatera.com/pricing/` read in a browser 2026-09-10. The
page is a JavaScript calculator; it lists **Windows Server 2016–2025
(Standard/Datacenter) and Windows Desktop 10/11 images**, the Tel Aviv data
centre, "Includes cost of licenses", "Hourly servers are billed by the
minute", "Additional storage is only $0.05 per GB per month", and a minimal
configuration at **$10.00/month ($0.014/h)**. The calculator's price for
4 vCPU / 16 GB / 500 GB / Windows in Tel Aviv could not be read without
driving its hidden dropdowns, so **no figure for the target spec is quoted
here** — open the calculator and read it (one minute, no account).

Why it is still in the table: it is the only one of the three with a
licensed **Windows 11 Desktop** image (the OS every vendor player actually
lists) and per-minute billing, in Tel Aviv. RDP: yes. Start/stop: console
power-off (billing by the minute; API not verified here).

### 2.4 Not chosen, and why

- **Hetzner Cloud** (Falkenstein/Nuremberg/Helsinki): "Hetzner does not offer
  pre-installed Windows images … customers must manually install Windows
  using their own licenses" (docs.hetzner.com `cloud/servers/windows-on-cloud`,
  read 2026-09-10) — bring-your-own Windows licence and a manual ISO install;
  cheapest raw compute but the licence question moves to the owner, and the
  public pricing page renders prices with JavaScript (not captured).
- **Paperspace/DigitalOcean**: the machines pricing page 404s (2026-09-10);
  the docs pricing stub carries no numbers.
- **Vultr, OVHcloud, Contabo**: prices behind JavaScript toggles or outside the
  4–8 vCPU / 16–32 GB band; no Israel region.

### 2.5 A month, priced (Azure D4s_v5 Windows + 512 GB, the default choice)

| pattern | compute | disk | snapshot (512 GB) | total |
| --- | --- | --- | --- | --- |
| 8 h/day × 22 days (176 h) | 176 × 0.408 = 71.81 | 46.08 | 30.72 | **≈ 149 $/month** |
| always on (730 h) | 297.84 | 46.08 | 30.72 | ≈ 375 $/month |
| B4s_v2 burstable, 176 h | 36.96 | 46.08 | 30.72 | ≈ 114 $/month (renders drain CPU credits; verify) |
| Spot D4s_v5, 176 h | 13.27 | 46.08 | 30.72 | ≈ 90 $/month — **only after §7 rule 6 is verified** |

AWS m6i.xlarge at the same 176 h is 71.93 compute + EBS (unfetched). The
snapshot line is the price of never re-installing content or re-spending
activation seats (§7 rule 3).

## 3. Reaching the worker without a public port

The API calls the worker with `PEDALBOARD_VST3_API_URL` and a bearer token
(`artifacts/api-server/src/lib/musicEngines.ts`, `renderRemoteInstrument`,
header `Authorization: Bearer …` only). Two topologies:

**A. API on the owner's PC (today's setup) — Tailscale.** Both machines join
the owner's tailnet; the worker binds to the VM's Tailscale IPv4 address
(`bootstrap-vm.ps1` launcher) and the Windows firewall allows TCP 8022 from
`100.64.0.0/10` only. `.env.local` on the PC:
`PEDALBOARD_VST3_API_URL=http://<vm-magicdns-name>:8022` and
`PEDALBOARD_VST3_API_TOKEN=<the token entered on the VM>`. RDP also goes
over Tailscale (`mstsc /v:<vm-magicdns-name>`), so the provider firewall/NSG
ends with **zero** inbound rules. Tailscale runs unattended on the VM
(`tailscale up --unattended`; tailscale.com/kb/1088). Nothing is public.

**B. API elsewhere (Modal, a future host) — Cloudflare Tunnel.** `cloudflared`
runs as a Windows service on the VM (`cloudflared.exe service install
<token>`; developers.cloudflare.com `…/as-a-service/windows/`), outbound only,
and maps `vst3.<owner-domain>` → `http://127.0.0.1:8022`. The hostname is
public but the worker answers 401 without the bearer token and 503 without its
own configuration — the same posture as the CA2 worker on Modal (PR-58). To
add a second lock (Cloudflare Access service token) the API would need to send
two extra headers; `renderRemoteInstrument` does not today — a small,
separate change. Modal could alternatively join the tailnet from inside the
container; not verified here.

Either way: never tunnel the API's :5000 (PR-41 rule); the *worker* is the only
thing exposed, and only through the overlay.

## 4. Runbook — VM creation (owner's own account)

**4.0 Trial hour first.** Before installing any content: create the VM, RDP
in, install Native Access, the Spitfire App, SINE and the iLok License Manager,
sign in, and confirm they run on the chosen image. The vendors list Windows
10/11; **Windows Server is not in their system requirements** and was not
verified here. If one of them refuses Server, switch to a Windows 11 image
(Kamatera; or Azure with an eligible Visual Studio subscription) before
spending more than the hour.

**4.1 Azure (portal or CLI).** Resource group in `israelcentral` →
Virtual machine: image *Windows Server 2022 Datacenter: Azure Edition* (or
2025), size `Standard_D4s_v5`, username of your choice, **inbound ports: none**
(you will RDP over Tailscale; if you must open 3389 for the first login,
restrict the NSG source to your current public IP and remove the rule after
Tailscale is up), OS disk Standard SSD 128 GB, add a data disk E20 (512 GB),
Auto-shutdown ON at a time you will not be rendering, boot diagnostics off,
no public IP once Tailscale works (keep one for the first login only). Set a
**budget alert** in Cost Management (e.g. $150/month, 80 % e-mail).

**4.2 AWS.** Region `il-central-1` → Launch instance: AMI *Windows_Server-2022-English-Full-Base*,
`m6i.xlarge`, key pair (to decrypt the Administrator password), security
group with **no inbound rules** (or 3389 from your IP for the first login
only), root gp3 60 GB + a second gp3 500 GB volume, enable stop protection off,
termination protection on. Create an AWS Budget with an alert.

**4.3 Kamatera.** Type B (general purpose), 4 cores, 16 GB, 500 GB NVMe,
Windows Desktop 11 (licence included) or Windows Server 2022, data centre
Israel Tel Aviv, hourly billing, no add-ons. Note the price the calculator
shows and put it in the tracker.

**4.4 First login, then bootstrap.** RDP in (first time over the temporary
3389 rule or the provider's console), open an elevated PowerShell, and run:

```powershell
# clone just the two scripts first, or copy them over RDP:
git clone --depth 1 https://github.com/zw0583228508/music.git C:\bootstrap
powershell -ExecutionPolicy Bypass -File C:\bootstrap\services\vst3-render-worker\cloud\bootstrap-vm.ps1 -DataDiskNumber 1 -WhatIf
powershell -ExecutionPolicy Bypass -File C:\bootstrap\services\vst3-render-worker\cloud\bootstrap-vm.ps1 -DataDiskNumber 1
```

What the script does (and what it deliberately does not) is documented in its
header and `services/vst3-render-worker/cloud/README.md`: data disk → winget
(Python 3.11, Git, NSSM, Tailscale) → clone to `D:\music\repo` → venv → asset
dirs → **prompted token, DPAPI-protected** → launcher → NSSM service → one
firewall rule (8022 from the Tailscale range). If the image has no winget
(common on Windows Server) it prints the four download URLs and stops; install
them and re-run with `-SkipWinget`.

**4.5 Overlay.** In the same session: `tailscale up --unattended`, sign in in
the browser it opens, then `Restart-Service vst3-render-worker`. On your PC,
`tailscale status` shows the VM; now remove the temporary 3389 rule / public IP
in the provider console and use `mstsc /v:<vm-name>` from here on.

## 5. The owner's manual steps on the VM (personal accounts — never scripted)

1. **Native Access** (installed in 4.0): sign in, set *Content location* to
   `D:\music\content\NI`, install Kontakt 8 Player, Komplete Start, and the
   Player libraries you actually want first (SSO Discover, GLADE, LUX Strings
   Elements, Tokyo Scoring Strings Free, Blueprint, Shreddage 3 Stratus Free,
   Sonixinema Origins, ProjectSAM Free Orchestra, Emergence Infinite). Each
   consumes one of your NI device slots (EULA §3.3: three; support article:
   two) — this VM is one device.
2. **Spitfire App**: sign in, library folder `D:\music\content\Spitfire`,
   install BBC SO Discover / LABS; SSO Discover arrives through Native Access
   (it is a Kontakt Player library). Two devices concurrently (EULA §5).
3. **SINE**: sign in, content path `D:\music\content\OT`, Berlin Free
   Orchestra + Layers.
4. **iLok License Manager**: sign in, *machine* activation on the VM for VSL
   BBO Free Basics and SSD5.5 Free (3 activations for SSD5; no iLok Cloud).
5. **Soundpaint, Ample, MT Power Drum Kit 2, Decent Sampler**: install to the
   data disk. **Read the Ample EULA §5 note** in the clause table before
   relying on Lite instruments in finished music. Accept each installer's EULA
   yourself — the clause table did not, and could not, read the in-installer
   texts of MT Power, SSD5 and Decent Sampler.
6. **Steinberg**: install Steinberg Download Assistant + Activation Manager,
   sign in, activate Cubase 14 on the VM (one of three simultaneous
   activations), install HALion Sonic / Groove Agent SE + content to the data
   disk. Padshop/Retrologue arrive with it (the worker's proven instruments).
7. **Discover, manifest, smoke** — in `D:\music\repo\services\vst3-render-worker`
   with `D:\music\venv\Scripts\python.exe`:

   ```powershell
   $py = 'D:\music\venv\Scripts\python.exe'
   & $py discover.py                                   # every VST3 pedalboard can host here
   & $py make_manifest.py --plugin "C:\Program Files\Common Files\VST3\Steinberg\Retrologue.vst3" `
       --license-owner "<you>" --license-reference "Steinberg Cubase 14 licence" --out D:\music\assets\asset-manifest.json
   & $py make_manifest.py --plugin "C:\Program Files\Common Files\VST3\Native Instruments\Kontakt 8 Player.vst3" `
       --preset D:\music\assets\presets\sso-discover-violins-1.vstpreset --families strings --roles HARMONIC_BED,MELODY `
       --character orchestral,legato --append --license-owner "<you>" --license-reference "Spitfire SSO Discover (Kontakt Player) - private single-user VM, see proprietary-libraries-cloud-rights.md" `
       --out D:\music\assets\asset-manifest.json
   & $py smoke.py                                      # one proof per asset -> D:\music\assets\state\smoke-proof.json
   Restart-Service vst3-render-worker
   powershell -File cloud\verify-vm.ps1                # every manifest asset must be attested
   ```

   **Content instruments render silence until a program is loaded** (worker
   README): Kontakt Player, HALion Sonic and Groove Agent SE need a
   `.vstpreset` per instrument. On a DAW-less VM there is no tool in the
   repository yet to open the plugin editor and save that preset —
   pedalboard's `show_editor()` is the likely route; until it exists, save the
   presets in Cubase on your PC and copy them to `D:\music\assets\presets`.
   Retrologue needs none.
8. Put the **licence reference** of every asset in the manifest exactly as in
   the clause table row that permits it (`--license-reference`), so the
   API-side evidence names the clause the render rests on.
9. On your PC: `.env.local` gets `PEDALBOARD_VST3_API_URL=http://<vm-name>:8022`
   and `PEDALBOARD_VST3_API_TOKEN=…`; restart the API; the first
   `PEDALBOARD_VST3` render's evidence must echo the VM's asset id and digests.

## 6. `verify-vm.ps1` — what "attested" means here

`/health?provider=VST3` lists only assets whose own smoke proof passed
(worker README). `verify-vm.ps1` therefore fails when an asset that is in the
manifest is *missing* from `/health` (its smoke failed — typically
`audible: false` from an empty program) rather than reporting "healthy" for the
subset that works. It also checks: service running; the listener is on a
Tailscale or loopback address, never `0.0.0.0`; no inbound allow rule for the
port with an unrestricted remote address; `tailscale status` Running; 401
without a token (503 means the launcher did not deliver the token); `healthy`
and `provider == VST3` with it; `host.sha256` present; per asset
`smokeEvidence.passed` and `nativeHostAttested`. `-Json` prints the report for
`docs/evidence/`.

## 7. Cost-control rules (several of them are licence rules)

1. **Auto-shutdown every day** at a fixed hour (Azure setting; AWS
   EventBridge/Lambda or Instance Scheduler; Kamatera console). Start the VM
   from your PC only for a render session (`az vm start …` / `aws ec2
   start-instances …`); the API does not auto-start it (not built).
2. **Budget alert** in the provider at the monthly figure you accept (§2.5).
3. **Snapshot the data disk after content installation** and after each new
   library; at $0.06/GB-month (Azure standard) a 512 GB snapshot is $30.72 —
   cheaper than one afternoon of re-downloads, and it preserves the activated
   state.
4. **Deactivate before you delete.** Steinberg Activation Manager →
   Deactivate; iLok License Manager → deactivate the machine; Spitfire App and
   SINE → sign out / remove the device in the account; Native Access →
   uninstall the products from this machine and check the device list in your
   NI account. Every one of these counts machines, and a deleted VM that was
   not deactivated is a seat lost until support frees it.
5. **Stop, don't delete**, between projects: a stopped/deallocated VM costs
   only its disks (Azure E20: $46.08/month; AWS EBS by the GB).
6. **Spot/low-priority only after a test**: Azure Spot Windows D4s_v5 is
   $0.075/h (5.4× cheaper) but the VM can be evicted; verify on a cheap
   library that activations survive an eviction-and-restart before moving
   the content there.
7. **Never a public port, never the token in a log** — `verify-vm.ps1`
   checks the first; the scripts are written for the second.
8. **Delete the temporary RDP rule / public IP** the moment Tailscale works.

## 8. What changes for a multi-user deployment

Nothing in this runbook may be reused for a platform other people log into.
`proprietary-libraries-cloud-rights.md` gives the per-product answer — no
product is `PERMITTED` for multi-user service; five vendors name a licence
path (NI per-user licences, Orchestral Tools consent, Sonuscore multiuser
licence, Fracture "special arrangements", VSL per-user purchase), the rest
forbid it or are silent (silent = forbidden by platform policy). Q-13's
"licensed instrument catalogue whose every asset passes a cloud-rendering
rights review" (`docs/master-plan.md`) therefore has two shapes: a **private
catalogue** (this VM, the owner only) and a **public catalogue** that today
contains only the open-licence Tier CLOUD assets of `free-sound-libraries.md`
on Modal. Also from the clause table: renders made with Soundpaint, VSL,
Orchestral Tools, Sonuscore, Fracture Sounds or Audio Imperia libraries **must
not enter any training set** regardless of user count.

## 9. Honest limits

- Not executed. The scripts parse; whether `winget` IDs resolve on a given
  image, whether NSSM's registration succeeds under a hardened policy, and
  whether the vendor players run on Windows Server are all untested.
- Prices are list prices from public endpoints on 2026-09-10; Azure VM meters
  carry effective dates from 2024 and AWS's file is dated 2026-09-09, but the
  first invoice is the only proof. AWS EBS for il-central-1 and Kamatera's
  target-spec figure were not captured.
- Latency from Israel was not measured; the three chosen providers have
  in-country regions, which is the only latency claim made.
- The preset problem (§5.7) is real: without a `.vstpreset` per instrument,
  every Kontakt Player library smoke-fails and is not offered; the repository
  has no VM-side preset tool.
- Whether Native Access enforces two or three devices for a Komplete Start
  account was not tested; either way the VM takes one.
- Cloudflare Access as a second lock needs an API change (extra headers) that
  is not in this PR.
- `pedalboard` is GPL-3.0 and runs in its own process behind HTTP on the VM,
  as it does locally (worker README) — unchanged by the move.
