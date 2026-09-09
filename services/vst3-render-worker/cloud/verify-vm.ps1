<#
.SYNOPSIS
  Verify a bootstrapped render VM: the worker is up, fails closed, attests
  every expected asset, and listens only where the overlay can reach it.

.DESCRIPTION
  PR-95. Syntax-checked (PSParser), NOT executed against any cloud. Run it on
  the VM after bootstrap-vm.ps1 and after every make_manifest.py / smoke.py
  round. Exit code 0 = every check passed, 1 = at least one failed.

  Checks:
    service      the NSSM service or scheduled task exists and is running
    listener     TCP $Port is listening on a Tailscale (100.64/10) or loopback
                 address - never 0.0.0.0 / ::
    firewall     no inbound allow rule for $Port with an unrestricted remote address
    overlay      tailscale status reports Running (when tailscale is installed)
    no-token     GET /health without a token is refused (401; 503 = token unset)
    health       GET /health?provider=VST3 with the token: healthy = true, provider = VST3
    assets       every expected asset id (from -ExpectedAssetIds, else the
                 manifest) appears in health.assets[] with smokeEvidence.passed = true
                 and nativeHostAttested = true
    host         health.host identity and digest are present

  The token is read from the DPAPI blob bootstrap-vm.ps1 wrote (or prompted
  without echo) and is never printed.
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$BaseUrl = '',
    [ValidateRange(1024, 65535)][int]$Port = 8022,
    [string]$TokenBlobPath = 'D:\music\secrets\vst3-render-token.bin',
    [string]$ManifestPath = 'D:\music\assets\asset-manifest.json',
    [string[]]$ExpectedAssetIds = @(),
    [string]$ServiceName = 'vst3-render-worker',
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$results = New-Object System.Collections.Generic.List[object]
function Add-Result {
    param([string]$Check, [bool]$Passed, [string]$Detail)
    $results.Add([pscustomobject]@{ check = $Check; passed = $Passed; detail = $Detail })
}

function Get-Token {
    if (Test-Path $TokenBlobPath) {
        Add-Type -AssemblyName System.Security
        $blob = [IO.File]::ReadAllBytes($TokenBlobPath)
        $bytes = [Security.Cryptography.ProtectedData]::Unprotect(
            $blob, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
        try { return [Text.Encoding]::UTF8.GetString($bytes) }
        finally { [Array]::Clear($bytes, 0, $bytes.Length) }
    }
    $secure = Read-Host -Prompt 'VST3_RENDER_TOKEN (not stored)' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Invoke-Health {
    param([string]$Url, [hashtable]$Headers)
    try {
        $response = Invoke-WebRequest -Uri $Url -Headers $Headers -UseBasicParsing -TimeoutSec 30
        return @{ status = [int]$response.StatusCode; body = $response.Content }
    }
    catch [System.Net.WebException] {
        $resp = $_.Exception.Response
        if ($resp) { return @{ status = [int]$resp.StatusCode; body = '' } }
        return @{ status = 0; body = $_.Exception.Message }
    }
}

# ---------------------------------------------------------------- service ---

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
    Add-Result 'service' ($service.Status -eq 'Running') ('NSSM service ' + $service.Status)
}
else {
    $task = Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
    if ($task) { Add-Result 'service' ($task.State -eq 'Running') ('scheduled task ' + $task.State) }
    else { Add-Result 'service' $false ('neither a service nor a scheduled task named ' + $ServiceName) }
}

# --------------------------------------------------------------- listener ---

$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -eq 0) {
    Add-Result 'listener' $false ('nothing listens on TCP ' + $Port)
    $bindAddress = $null
}
else {
    $addresses = @($listeners | ForEach-Object { $_.LocalAddress } | Sort-Object -Unique)
    $public = @($addresses | Where-Object { $_ -eq '0.0.0.0' -or $_ -eq '::' })
    $allowed = @($addresses | Where-Object { $_ -eq '127.0.0.1' -or $_ -eq '::1' -or $_ -like '100.*' })
    $ok = ($public.Count -eq 0) -and ($allowed.Count -eq $addresses.Count)
    Add-Result 'listener' $ok ('listening on ' + ($addresses -join ', '))
    $bindAddress = $addresses | Where-Object { $_ -ne '::1' } | Select-Object -First 1
}
if (-not $BaseUrl) {
    $host_ = if ($bindAddress) { $bindAddress } else { '127.0.0.1' }
    $BaseUrl = 'http://' + $host_ + ':' + $Port
}

# --------------------------------------------------------------- firewall ---

$openRules = @()
foreach ($rule in @(Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -ErrorAction SilentlyContinue)) {
    $portFilter = $rule | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
    if (-not $portFilter) { continue }
    if (($portFilter.Protocol -ne 'TCP') -or (@($portFilter.LocalPort) -notcontains [string]$Port)) { continue }
    $addrFilter = $rule | Get-NetFirewallAddressFilter -ErrorAction SilentlyContinue
    $remote = @($addrFilter.RemoteAddress)
    if ($remote -contains 'Any' -or $remote -contains '*') { $openRules += $rule.DisplayName }
}
Add-Result 'firewall' ($openRules.Count -eq 0) ($(if ($openRules.Count -eq 0) { 'no unrestricted inbound rule for ' + $Port } else { 'UNRESTRICTED inbound rule(s): ' + ($openRules -join '; ') }))

# ---------------------------------------------------------------- overlay ---

if (Get-Command tailscale -ErrorAction SilentlyContinue) {
    try {
        $status = (& tailscale status --json 2>$null) | ConvertFrom-Json
        $running = $status.BackendState -eq 'Running'
        $ipText = if ($status.TailscaleIPs) { ($status.TailscaleIPs -join ', ') } else { 'no address' }
        Add-Result 'overlay' $running ('tailscale ' + $status.BackendState + ' (' + $ipText + ')')
    }
    catch { Add-Result 'overlay' $false ('tailscale status failed: ' + $_.Exception.Message) }
}
else {
    Add-Result 'overlay' $true 'tailscale not installed (cloudflared/none mode) - not checked'
}

# --------------------------------------------------------------- no token ---

$noToken = Invoke-Health -Url ($BaseUrl + '/health?provider=VST3') -Headers @{}
$refused = ($noToken.status -eq 401)
$detail = 'status ' + $noToken.status
if ($noToken.status -eq 503) { $detail += ' (VST3_RENDER_TOKEN is unset in the worker process - the launcher did not deliver it)' }
Add-Result 'no-token' $refused $detail

# ----------------------------------------------------------------- health ---

$token = Get-Token
$headers = @{ Authorization = ('Bearer ' + $token) }
$token = $null
$health = Invoke-Health -Url ($BaseUrl + '/health?provider=VST3') -Headers $headers
$headers = $null
$body = $null
if ($health.status -eq 200 -and $health.body) {
    try { $body = $health.body | ConvertFrom-Json } catch { $body = $null }
}
if (-not $body) {
    Add-Result 'health' $false ('status ' + $health.status + ' - no JSON body')
}
else {
    $healthy = ($body.healthy -eq $true) -and ($body.provider -eq 'VST3')
    Add-Result 'health' $healthy ('healthy=' + $body.healthy + ' provider=' + $body.provider + ' worker=' + $body.worker.name + '@' + $body.worker.version)

    # ------------------------------------------------------------- host ---
    $hostOk = $false
    $hostDetail = 'no host block'
    if ($body.PSObject.Properties.Name -contains 'host' -and $body.host) {
        $h = $body.host
        $hostOk = [bool]($h.PSObject.Properties.Name -contains 'sha256') -and [bool]$h.sha256
        $hostDetail = ('host ' + $h.name + ' ' + $h.version + ' sha256 ' + $(if ($h.sha256) { $h.sha256.Substring(0, 12) + '...' } else { 'missing' }))
    }
    Add-Result 'host' $hostOk $hostDetail

    # ----------------------------------------------------------- assets ---
    $expected = @($ExpectedAssetIds)
    if ($expected.Count -eq 0 -and (Test-Path $ManifestPath)) {
        $manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
        if ($manifest.PSObject.Properties.Name -contains 'assets' -and $manifest.assets) {
            $expected = @($manifest.assets | ForEach-Object { $_.id })
        }
        elseif ($manifest.PSObject.Properties.Name -contains 'id') {
            $expected = @($manifest.id)
        }
    }
    $offered = @()
    if ($body.PSObject.Properties.Name -contains 'assets' -and $body.assets) { $offered = @($body.assets) }
    if ($expected.Count -eq 0) {
        Add-Result 'assets' $false 'no expected asset ids (pass -ExpectedAssetIds or point -ManifestPath at the manifest)'
    }
    else {
        foreach ($id in $expected) {
            $asset = $offered | Where-Object { $_.id -eq $id } | Select-Object -First 1
            if (-not $asset) {
                Add-Result ('asset ' + $id) $false 'not offered by /health (smoke failed or manifest mismatch - see smoke.py output)'
                continue
            }
            $ev = $asset.smokeEvidence
            $passed = ($ev -and $ev.passed -eq $true)
            $attested = ($ev -and $ev.nativeHostAttested -eq $true)
            $audible = if ($ev) { $ev.audible } else { $null }
            Add-Result ('asset ' + $id) ($passed -and $attested) ('smoke passed=' + $passed + ' hostAttested=' + $attested + ' audible=' + $audible + ' identity=' + $asset.identity)
        }
        $extra = @($offered | Where-Object { $expected -notcontains $_.id } | ForEach-Object { $_.id })
        if ($extra.Count -gt 0) { Add-Result 'assets-extra' $true ('also offered: ' + ($extra -join ', ')) }
    }
}

# ---------------------------------------------------------------- report ---

$failed = @($results | Where-Object { -not $_.passed })
if ($Json) {
    [pscustomobject]@{
        baseUrl = $BaseUrl
        checkedAt = (Get-Date).ToUniversalTime().ToString('o')
        passed = ($failed.Count -eq 0)
        checks = $results
    } | ConvertTo-Json -Depth 5
}
else {
    $results | Format-Table -AutoSize -Property @{ n = 'ok'; e = { if ($_.passed) { 'PASS' } else { 'FAIL' } } }, check, detail | Out-String -Width 200 | Write-Host
    if ($failed.Count -eq 0) { Write-Host ('verify-vm: all ' + $results.Count + ' checks passed at ' + $BaseUrl) -ForegroundColor Green }
    else { Write-Host ('verify-vm: ' + $failed.Count + ' of ' + $results.Count + ' checks FAILED') -ForegroundColor Red }
}
if ($failed.Count -gt 0) { exit 1 }
exit 0
