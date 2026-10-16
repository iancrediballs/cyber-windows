<#
.SYNOPSIS
  NEON//OS Neural Link - turns real Windows navigation into Hack Points for the wallpaper.

.DESCRIPTION
  Runs a tiny HTTP endpoint on http://localhost:<Port>/state that the NEON//OS wallpaper polls.
  Tracks, locally and only in aggregate:
    switches  - foreground window changes
    launches  - new windowed app instances
    apps      - distinct app executables ever seen      (names stored)
    folders   - distinct File Explorer folders visited  (stored as SHA-256 hashes only)
  No keystrokes, window titles, or file contents are read. State: %LOCALAPPDATA%\NeonOS\link-state.json

.PARAMETER Port
  Listening port (default 47777). Must match the wallpaper's "Neural Link port" property.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File .\neural-link.ps1
#>
[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)][int]$Port = 47777,
    [ValidateRange(250, 10000)][int]$PollMs = 1000
)

Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'

# Hidden runs have no console, so log everything to %LOCALAPPDATA%\NeonOS\neural-link.log
$logPath = Join-Path $env:LOCALAPPDATA 'NeonOS\neural-link.log'
New-Item -ItemType Directory -Force -Path (Split-Path $logPath) | Out-Null
try { Start-Transcript -Path $logPath -Force | Out-Null } catch { }
trap { Write-Host "FATAL: $_"; Write-Host $_.ScriptStackTrace; try { Stop-Transcript | Out-Null } catch { }; exit 1 }

# ---------- single instance ----------
$mutex = New-Object System.Threading.Mutex($false, "Local\NeonOS.NeuralLink.$Port")
if (-not $mutex.WaitOne(0)) { Write-Host "Neural Link already running on port $Port."; exit 0 }

# ---------- Win32 ----------
if (-not ('NeonOS.Win32' -as [type])) {
    Add-Type -Namespace NeonOS -Name Win32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint pid);
'@
}

# ---------- persistence ----------
$dataDir   = Join-Path $env:LOCALAPPDATA 'NeonOS'
$statePath = Join-Path $dataDir 'link-state.json'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$state = [ordered]@{ switches = 0; launches = 0; apps = @(); folderHashes = @() }
if (Test-Path $statePath) {
    try {
        $loaded = Get-Content $statePath -Raw | ConvertFrom-Json
        $state.switches     = [int]$loaded.switches
        $state.launches     = [int]$loaded.launches
        $state.apps         = @($loaded.apps)
        $state.folderHashes = @($loaded.folderHashes)
    } catch { Write-Warning "link-state.json unreadable, starting fresh: $_" }
}
$apps    = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$folders = New-Object 'System.Collections.Generic.HashSet[string]'
$state.apps         | Where-Object { $_ } | ForEach-Object { [void]$apps.Add($_) }
$state.folderHashes | Where-Object { $_ } | ForEach-Object { [void]$folders.Add($_) }

$dirty = $false
function ConvertTo-StringArray($set) { $arr = New-Object string[] $set.Count; $set.CopyTo($arr); , $arr }
function Save-State {
    $out = [ordered]@{
        switches     = $state.switches
        launches     = $state.launches
        apps         = ConvertTo-StringArray $apps
        folderHashes = ConvertTo-StringArray $folders
    }
    $tmp = "$statePath.tmp"
    $out | ConvertTo-Json -Depth 3 -Compress | Set-Content -Path $tmp -Encoding UTF8
    Move-Item -Force $tmp $statePath
}

# ---------- event ring ----------
$events = New-Object System.Collections.Generic.List[object]
$seq = 0
function Add-LinkEvent([string]$type, [string]$name) {
    $script:seq++
    $events.Add([ordered]@{ seq = $script:seq; type = $type; name = $name; t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() })
    while ($events.Count -gt 20) { $events.RemoveAt(0) }
}

# ---------- sensors ----------
$ignore = @('ApplicationFrameHost','TextInputHost','SearchHost','SearchApp','ShellExperienceHost','StartMenuExperienceHost',
            'LockApp','Lively','livelywpf','Lively.UI.WinUI','SystemSettings','dwm','Idle','powershell','pwsh','conhost')
$hash = [System.Security.Cryptography.SHA256]::Create()
function Get-Sha([string]$s) {
    -join ($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($s.ToLowerInvariant())) | ForEach-Object { $_.ToString('x2') })
}

$lastFgPid = 0
$knownPids = New-Object 'System.Collections.Generic.HashSet[int]'
$switchTimes = New-Object System.Collections.Generic.Queue[datetime]
$shell = $null
try { $shell = New-Object -ComObject Shell.Application } catch { Write-Warning 'Shell.Application unavailable - folder tracking disabled.' }
$firstScan = $true

function Update-Foreground {
    $fg = [NeonOS.Win32]::GetForegroundWindow()
    if ($fg -ne [IntPtr]::Zero) {
        [uint32]$fgPid = 0
        [void][NeonOS.Win32]::GetWindowThreadProcessId($fg, [ref]$fgPid)
        if ($fgPid -ne 0 -and $fgPid -ne $script:lastFgPid) {
            if ($script:lastFgPid -ne 0) {
                $state.switches++; $script:dirty = $true
                $switchTimes.Enqueue([datetime]::UtcNow)
            }
            $script:lastFgPid = $fgPid
        }
    }
    while ($switchTimes.Count -and ([datetime]::UtcNow - $switchTimes.Peek()).TotalSeconds -gt 60) { [void]$switchTimes.Dequeue() }
}

function Update-Apps {
    $current = Get-Process | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $ignore -notcontains $_.ProcessName }
    $alive = New-Object 'System.Collections.Generic.HashSet[int]'
    foreach ($p in $current) {
        [void]$alive.Add($p.Id)
        if ($knownPids.Add($p.Id) -and -not $script:firstScan) { $state.launches++; $script:dirty = $true }
        if ($apps.Add($p.ProcessName)) {
            $script:dirty = $true
            if (-not $script:firstScan) { Add-LinkEvent 'app' $p.ProcessName }
        }
    }
    $knownPids.IntersectWith($alive)
}

function Update-Folders {
    if (-not $shell) { return }
    try {
        foreach ($w in @($shell.Windows())) {
            $path = $null
            try { $path = $w.Document.Folder.Self.Path } catch { continue }
            if (-not $path) { continue }
            if ($folders.Add((Get-Sha $path))) {
                $script:dirty = $true
                $leaf = Split-Path $path -Leaf
                if (-not $leaf) { $leaf = $path }
                Add-LinkEvent 'folder' $leaf
            }
        }
    } catch { <# Explorer restarting; try next tick #> }
}

# Each sensor is isolated so one failing (e.g. Explorer restarting) never blinds the others.
function Invoke-Poll {
    foreach ($sensor in 'Update-Foreground', 'Update-Apps', 'Update-Folders') {
        try { & $sensor } catch { Write-Verbose "$sensor failed: $_" }
    }
    $script:firstScan = $false
}

function Get-StateJson {
    [ordered]@{
        v        = 1
        totals   = [ordered]@{ switches = $state.switches; launches = $state.launches; apps = $apps.Count; folders = $folders.Count }
        activity = [math]::Round([math]::Min(1.0, $switchTimes.Count / 20.0), 2)
        events   = [object[]]$events.ToArray()   # @() on an empty generic List breaks ConvertTo-Json
    } | ConvertTo-Json -Depth 4 -Compress
}

# ---------- HTTP ----------
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch { Write-Error "Cannot bind http://localhost:$Port/ - port in use? $_"; exit 1 }
Write-Host "NEON//OS Neural Link online -> http://localhost:$Port/state  (Ctrl+C to stop)"

$lastSave = [datetime]::UtcNow
try {
    $pending = $listener.GetContextAsync()
    while ($listener.IsListening) {
        if ($pending.Wait($PollMs)) {
            $ctx = $pending.Result
            $pending = $listener.GetContextAsync()
            try {
                $res = $ctx.Response
                $res.Headers.Add('Access-Control-Allow-Origin', '*')
                $res.Headers.Add('Cache-Control', 'no-store')
                if ($ctx.Request.Url.AbsolutePath -eq '/state') {
                    $bytes = [Text.Encoding]::UTF8.GetBytes((Get-StateJson))
                    $res.ContentType = 'application/json'
                } else {
                    $bytes = [Text.Encoding]::UTF8.GetBytes('NEON//OS Neural Link. GET /state')
                    $res.StatusCode = if ($ctx.Request.Url.AbsolutePath -eq '/') { 200 } else { 404 }
                }
                $res.ContentLength64 = $bytes.Length
                $res.OutputStream.Write($bytes, 0, $bytes.Length)
                $res.Close()
            } catch {
                Write-Verbose "request failed: $_"
                try { $ctx.Response.Abort() } catch { }
            }
        }
        Invoke-Poll
        if ($dirty -and ([datetime]::UtcNow - $lastSave).TotalSeconds -ge 10) {
            Save-State; $dirty = $false; $lastSave = [datetime]::UtcNow
        }
    }
} finally {
    if ($dirty) { Save-State }
    $listener.Stop(); $listener.Close()
    $mutex.ReleaseMutex()
}
