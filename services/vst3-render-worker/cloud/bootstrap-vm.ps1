<#
.SYNOPSIS
  Turn a fresh Windows cloud VM into a services/vst3-render-worker host.

.DESCRIPTION
  PR-95 (proprietary-libraries-cloud-rights-and-vm-runbook). This script was
  syntax-checked with PSParser but has NOT been executed against any cloud
  provider; nothing in the repository provisions a VM. Read
  docs/model-discovery/windows-render-vm-runbook.md first.

  What it does, in order:
    1. (optional) initialises and formats a raw data disk as $DataDriveLetter
    2. installs Python 3.11, Git, NSSM and the chosen overlay (Tailscale or
       cloudflared) with winget - or tells you what to install by hand when
       winget is absent (Windows Server images often ship without it)
    3. clones the repository (or fast-forwards an existing clone)
    4. creates a virtualenv and installs services/vst3-render-worker/requirements.txt
    5. creates the asset/state/log/secret directories on the data disk and
       sets VST3_RENDER_ASSET_MANIFEST / VST3_RENDER_STATE_DIR machine-wide
    6. PROMPTS for VST3_RENDER_TOKEN (never a parameter, never echoed, never
       logged) and stores it DPAPI-protected (LocalMachine scope) in
       $InstallRoot\secrets\vst3-render-token.bin, ACL: SYSTEM + Administrators
    7. writes run-worker.ps1, a launcher that unprotects the token in-process
       and starts uvicorn bound to the Tailscale address (or 127.0.0.1)
    8. registers the launcher as a Windows service (NSSM) or an at-startup
       scheduled task running as SYSTEM
    9. adds ONE inbound firewall rule: TCP $Port from 100.64.0.0/10 (the
       Tailscale range) only. No rule is added for the public interface and no
       provider-side port is opened by this script - keep it that way.

  Content libraries, vendor sign-ins, make_manifest.py and smoke.py are the
  owner's manual steps on the VM (runbook section 5); this script deliberately
  does none of them because every vendor account is personal.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File bootstrap-vm.ps1 -DataDiskNumber 1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File bootstrap-vm.ps1 -Overlay cloudflared -ServiceMode scheduledtask -WhatIf
#>
#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$RepoUrl = 'https://github.com/zw0583228508/music.git',
    [string]$Branch = 'main',
    [string]$InstallRoot = 'D:\music',
    # -1 = do not touch disks. Otherwise the Get-Disk Number of the RAW data disk to initialise.
    [int]$DataDiskNumber = -1,
    [ValidatePattern('^[D-Z]$')][string]$DataDriveLetter = 'D',
    [ValidateSet('tailscale', 'cloudflared', 'none')][string]$Overlay = 'tailscale',
    [ValidateSet('nssm', 'scheduledtask')][string]$ServiceMode = 'nssm',
    [string]$ServiceName = 'vst3-render-worker',
    [ValidateRange(1024, 65535)][int]$Port = 8022,
    [string]$PythonWingetId = 'Python.Python.3.11',
    # Assume Python/Git/NSSM/overlay are already installed; skip winget entirely.
    [switch]$SkipWinget
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- helpers ---

function Write-Step {
    param([string]$Message)
    Write-Host ('==> ' + $Message) -ForegroundColor Cyan
}

function Update-ProcessPath {
    # winget installs update the registry PATH, not this process's PATH.
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = ($machine, $user -join ';')
}

function Test-CommandPresent {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-WingetPackage {
    param([string]$Id, [string]$Probe)
    if ($Probe -and (Test-CommandPresent $Probe)) {
        Write-Host ('    ' + $Id + ' already present (' + $Probe + ')')
        return
    }
    if ($PSCmdlet.ShouldProcess($Id, 'winget install')) {
        & winget install --id $Id --exact --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw ('winget install ' + $Id + ' failed with exit code ' + $LASTEXITCODE) }
        Update-ProcessPath
    }
}

function Initialize-DataDisk {
    param([int]$Number, [string]$Letter)
    $disk = Get-Disk -Number $Number
    if ($disk.PartitionStyle -ne 'RAW') {
        Write-Host ('    disk ' + $Number + ' already initialised (' + $disk.PartitionStyle + '); leaving it alone')
        return
    }
    if ($PSCmdlet.ShouldProcess(('disk ' + $Number), ('initialise GPT, one NTFS volume as ' + $Letter + ':'))) {
        Initialize-Disk -Number $Number -PartitionStyle GPT -PassThru |
            New-Partition -UseMaximumSize -DriveLetter $Letter |
            Format-Volume -FileSystem NTFS -NewFileSystemLabel 'music-data' -Confirm:$false | Out-Null
    }
}

function Read-SecretPlain {
    # Prompt without echo; return the plain string for in-process use only.
    param([string]$Prompt)
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Protect-SecretToFile {
    # DPAPI, LocalMachine scope: readable by SYSTEM and administrators on this VM only.
    param([string]$Plain, [string]$Path)
    Add-Type -AssemblyName System.Security
    $bytes = [Text.Encoding]::UTF8.GetBytes($Plain)
    try {
        $blob = [Security.Cryptography.ProtectedData]::Protect(
            $bytes, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
        [IO.File]::WriteAllBytes($Path, $blob)
    }
    finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
    }
    & icacls $Path /inheritance:r /grant:r 'SYSTEM:(F)' 'Administrators:(F)' | Out-Null
}

# ------------------------------------------------------------------ paths ---

$repoDir = Join-Path $InstallRoot 'repo'
$workerDir = Join-Path $repoDir 'services\vst3-render-worker'
$venvDir = Join-Path $InstallRoot 'venv'
$assetsDir = Join-Path $InstallRoot 'assets'
$stateDir = Join-Path $assetsDir 'state'
$presetsDir = Join-Path $assetsDir 'presets'
$contentDir = Join-Path $InstallRoot 'content'
$logDir = Join-Path $InstallRoot 'logs'
$secretsDir = Join-Path $InstallRoot 'secrets'
$tokenBlob = Join-Path $secretsDir 'vst3-render-token.bin'
$manifestPath = Join-Path $assetsDir 'asset-manifest.json'
$launcher = Join-Path $InstallRoot 'run-worker.ps1'

# ------------------------------------------------------------ 0. preflight ---

Write-Step 'Preflight'
$os = Get-CimInstance Win32_OperatingSystem
Write-Host ('    ' + $os.Caption + ' build ' + $os.BuildNumber)
if ($os.Caption -match 'Server') {
    Write-Warning 'Windows Server image: Native Access, the Spitfire App, SINE and iLok list Windows 10/11, not Server. Test them on a trial hour before installing content (runbook 4.0).'
}

# -------------------------------------------------------- 1. data disk -------

if ($DataDiskNumber -ge 0) {
    Write-Step ('Data disk ' + $DataDiskNumber + ' -> ' + $DataDriveLetter + ':')
    Initialize-DataDisk -Number $DataDiskNumber -Letter $DataDriveLetter
}
if (-not (Test-Path ($DataDriveLetter + ':\'))) {
    throw ('Drive ' + $DataDriveLetter + ': does not exist. Attach a data disk (500 GB-1 TB) and pass -DataDiskNumber, or set -InstallRoot to an existing volume.')
}

# ------------------------------------------------------- 2. prerequisites ----

Write-Step 'Prerequisites'
if ($SkipWinget) {
    Write-Host '    -SkipWinget: assuming Python 3.11, Git, NSSM and the overlay are installed'
}
elseif (-not (Test-CommandPresent 'winget')) {
    Write-Warning 'winget is not available on this image. Install by hand, then re-run with -SkipWinget:'
    Write-Host '      Python 3.11 (x64)  https://www.python.org/downloads/windows/'
    Write-Host '      Git for Windows    https://git-scm.com/download/win'
    Write-Host '      NSSM               https://nssm.cc/download'
    Write-Host '      Tailscale          https://tailscale.com/download/windows'
    Write-Host '      cloudflared        https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'
    throw 'winget missing'
}
else {
    Install-WingetPackage -Id $PythonWingetId -Probe 'py'
    Install-WingetPackage -Id 'Git.Git' -Probe 'git'
    if ($ServiceMode -eq 'nssm') { Install-WingetPackage -Id 'NSSM.NSSM' -Probe 'nssm' }
    switch ($Overlay) {
        'tailscale' { Install-WingetPackage -Id 'tailscale.tailscale' -Probe 'tailscale' }
        'cloudflared' { Install-WingetPackage -Id 'Cloudflare.cloudflared' -Probe 'cloudflared' }
        default { }
    }
}
Update-ProcessPath

# --------------------------------------------------------- 3. repository -----

Write-Step ('Repository ' + $RepoUrl + ' (' + $Branch + ')')
foreach ($d in @($InstallRoot, $assetsDir, $stateDir, $presetsDir, $contentDir, $logDir, $secretsDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
}
& icacls $secretsDir /inheritance:r /grant:r 'SYSTEM:(OI)(CI)(F)' 'Administrators:(OI)(CI)(F)' | Out-Null

if (Test-Path (Join-Path $repoDir '.git')) {
    if ($PSCmdlet.ShouldProcess($repoDir, 'git pull --ff-only')) {
        & git -C $repoDir fetch --depth 1 origin $Branch
        & git -C $repoDir checkout -q $Branch
        & git -C $repoDir pull --ff-only
    }
}
elseif ($PSCmdlet.ShouldProcess($repoDir, 'git clone')) {
    & git clone --branch $Branch --depth 1 $RepoUrl $repoDir
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
}
if (-not (Test-Path (Join-Path $workerDir 'app.py'))) {
    throw ('services/vst3-render-worker/app.py not found under ' + $repoDir)
}

# ---------------------------------------------------- 4. python environment --

Write-Step 'Python 3.11 virtualenv'
$venvPython = Join-Path $venvDir 'Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    if ($PSCmdlet.ShouldProcess($venvDir, 'python -m venv')) {
        if (Test-CommandPresent 'py') { & py -3.11 -m venv $venvDir }
        else { & python -m venv $venvDir }
        if ($LASTEXITCODE -ne 0) { throw 'venv creation failed' }
    }
}
if ($PSCmdlet.ShouldProcess('requirements.txt', 'pip install')) {
    & $venvPython -m pip install --quiet --upgrade pip
    & $venvPython -m pip install --quiet -r (Join-Path $workerDir 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }
    & $venvPython -c 'import pedalboard, fastapi, uvicorn; print("    pedalboard", pedalboard.__version__)'
}

# ------------------------------------------------ 5. machine environment -----

Write-Step 'Machine environment (paths only - never the token)'
if ($PSCmdlet.ShouldProcess('HKLM environment', 'set VST3_RENDER_ASSET_MANIFEST / VST3_RENDER_STATE_DIR')) {
    [Environment]::SetEnvironmentVariable('VST3_RENDER_ASSET_MANIFEST', $manifestPath, 'Machine')
    [Environment]::SetEnvironmentVariable('VST3_RENDER_STATE_DIR', $stateDir, 'Machine')
}

# --------------------------------------------------------- 6. the token ------

Write-Step 'VST3_RENDER_TOKEN'
if (Test-Path $tokenBlob) {
    Write-Host ('    existing protected token found at ' + $tokenBlob + ' - keeping it (delete the file to re-enter)')
}
elseif ($PSCmdlet.ShouldProcess($tokenBlob, 'store DPAPI-protected token')) {
    Write-Host '    Enter the shared secret the API will present as Bearer token.'
    Write-Host '    Generate it on your PC, e.g.  python -c "import secrets; print(secrets.token_urlsafe(32))"'
    Write-Host '    It is stored DPAPI-protected on this VM only and is never printed.'
    $plain = Read-SecretPlain -Prompt 'VST3_RENDER_TOKEN'
    if ([string]::IsNullOrWhiteSpace($plain) -or $plain.Length -lt 24) {
        throw 'refusing an empty or short token (< 24 characters)'
    }
    Protect-SecretToFile -Plain $plain -Path $tokenBlob
    $plain = $null
}

# ---------------------------------------------------------- 7. launcher ------

Write-Step ('Launcher ' + $launcher)
$launcherTemplate = @'
# Generated by bootstrap-vm.ps1 - starts services/vst3-render-worker with the
# DPAPI-protected token. Do not add the token to this file.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$blob = [IO.File]::ReadAllBytes('__TOKEN_BLOB__')
$bytes = [Security.Cryptography.ProtectedData]::Unprotect($blob, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
$env:VST3_RENDER_TOKEN = [Text.Encoding]::UTF8.GetString($bytes)
[Array]::Clear($bytes, 0, $bytes.Length)
$env:VST3_RENDER_ASSET_MANIFEST = '__MANIFEST__'
$env:VST3_RENDER_STATE_DIR = '__STATE_DIR__'
$bind = '127.0.0.1'
if ('__OVERLAY__' -eq 'tailscale') {
    $ip = $null
    for ($i = 0; $i -lt 30 -and -not $ip; $i++) {
        try { $ip = (& tailscale ip -4 2>$null | Select-Object -First 1) } catch { $ip = $null }
        if (-not $ip) { Start-Sleep -Seconds 2 }
    }
    if (-not $ip) { throw 'tailscale has no IPv4 address yet; refusing to bind anywhere else' }
    $bind = $ip.Trim()
}
Set-Location '__WORKER_DIR__'
& '__VENV_PYTHON__' -m uvicorn app:app --host $bind --port __PORT__ --log-level info
'@
$launcherBody = $launcherTemplate.
    Replace('__TOKEN_BLOB__', $tokenBlob).
    Replace('__MANIFEST__', $manifestPath).
    Replace('__STATE_DIR__', $stateDir).
    Replace('__OVERLAY__', $Overlay).
    Replace('__WORKER_DIR__', $workerDir).
    Replace('__VENV_PYTHON__', $venvPython).
    Replace('__PORT__', [string]$Port)
if ($PSCmdlet.ShouldProcess($launcher, 'write')) {
    Set-Content -Path $launcher -Value $launcherBody -Encoding UTF8
}

# ------------------------------------------------------- 8. the service ------

Write-Step ('Service (' + $ServiceMode + ')')
$psExe = Join-Path $PSHOME 'powershell.exe'
$psArgs = '-NoProfile -ExecutionPolicy Bypass -File "' + $launcher + '"'
if ($ServiceMode -eq 'nssm') {
    if ($PSCmdlet.ShouldProcess($ServiceName, 'nssm install')) {
        $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($existing) { & nssm stop $ServiceName | Out-Null; & nssm remove $ServiceName confirm | Out-Null }
        & nssm install $ServiceName $psExe $psArgs
        & nssm set $ServiceName AppDirectory $workerDir
        & nssm set $ServiceName DisplayName 'VST3 render worker (music platform)'
        & nssm set $ServiceName Description 'services/vst3-render-worker behind the overlay network; fails closed without its token.'
        & nssm set $ServiceName Start SERVICE_AUTO_START
        & nssm set $ServiceName AppStdout (Join-Path $logDir 'worker.out.log')
        & nssm set $ServiceName AppStderr (Join-Path $logDir 'worker.err.log')
        & nssm set $ServiceName AppRotateFiles 1
        & nssm set $ServiceName AppRotateBytes 10485760
        & nssm set $ServiceName AppExit Default Restart
        & nssm set $ServiceName AppRestartDelay 5000
        & nssm start $ServiceName
    }
}
else {
    if ($PSCmdlet.ShouldProcess($ServiceName, 'Register-ScheduledTask (AtStartup, SYSTEM)')) {
        $action = New-ScheduledTaskAction -Execute $psExe -Argument $psArgs -WorkingDirectory $workerDir
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 365)
        Register-ScheduledTask -TaskName $ServiceName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
        Start-ScheduledTask -TaskName $ServiceName
    }
}

# ------------------------------------------------------- 9. firewall ---------

Write-Step 'Firewall (inbound from the Tailscale range only; nothing public)'
$ruleName = $ServiceName + ' (' + $Port + ') from Tailscale only'
if ($PSCmdlet.ShouldProcess($ruleName, 'New-NetFirewallRule')) {
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    if ($Overlay -eq 'tailscale') {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port `
            -RemoteAddress '100.64.0.0/10' -Action Allow -Profile Any | Out-Null
    }
    else {
        Write-Host '    no inbound rule created: the worker listens on 127.0.0.1 and cloudflared (or nothing) reaches it locally'
    }
}

# ------------------------------------------------------- 10. overlay ---------

Write-Step ('Overlay: ' + $Overlay)
switch ($Overlay) {
    'tailscale' {
        Write-Host '    Now, in this RDP session, run:   tailscale up --unattended'
        Write-Host '    It prints a login URL - sign in with YOUR Tailscale account. --unattended keeps'
        Write-Host '    the node up when nobody is logged in (tailscale.com/kb/1088/run-unattended).'
        Write-Host '    Then restart the service so the launcher binds to the Tailscale address.'
    }
    'cloudflared' {
        if ($PSCmdlet.ShouldProcess('cloudflared', 'service install with a prompted tunnel token')) {
            Write-Host '    Paste the tunnel token from Zero Trust -> Networks -> Tunnels (never stored by this script).'
            $tunnelToken = Read-SecretPlain -Prompt 'cloudflared tunnel token'
            if ([string]::IsNullOrWhiteSpace($tunnelToken)) { throw 'empty tunnel token' }
            & cloudflared.exe service install $tunnelToken
            $tunnelToken = $null
            Write-Host ('    Point the tunnel public hostname at http://127.0.0.1:' + $Port + ' in the Cloudflare dashboard.')
        }
    }
    default {
        Write-Host '    none: the worker listens on 127.0.0.1 only; reach it through your own tunnel.'
    }
}

# ------------------------------------------------------------ summary --------

Write-Step 'Done - what is left is yours (runbook section 5)'
Write-Host ('    install root      ' + $InstallRoot)
Write-Host ('    content goes to   ' + $contentDir + '  (Native Access / Spitfire App / SINE / others: choose this location)')
Write-Host ('    manifest          ' + $manifestPath + '  (make_manifest.py --out ' + $manifestPath + ' [--append])')
Write-Host ('    smoke state       ' + $stateDir)
Write-Host ('    logs              ' + $logDir)
Write-Host ('    verify            powershell -File ' + (Join-Path $workerDir 'cloud\verify-vm.ps1'))
Write-Host '    the token was not printed and is not in any log; the API needs the same value in .env.local as PEDALBOARD_VST3_API_TOKEN'
