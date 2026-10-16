<#
.SYNOPSIS
  Installs the NEON//OS cyberpunk theme for Windows 11 (current user only, no admin).

.DESCRIPTION
  1. Backs up every setting it touches to %LOCALAPPDATA%\NeonOS\backup.json (uninstall.ps1 restores it).
  2. Dark mode, transparency, neon accent on Start/taskbar/title bars.
  3. Static fallback wallpaper (assets\wallpaper.png).
  4. Windows Terminal "NEON//OS" color scheme + profile (JSON fragment, non-destructive).
  5. Copies the app to %LOCALAPPDATA%\NeonOS\app, registers the Neural Link daemon at logon and starts it.
  6. Packages the interactive wallpaper as a Lively Wallpaper zip and tries to apply it.

.PARAMETER Accent
  Accent hex color. Default #FF2BD6 (neon magenta). Try #00F0FF (cyan) or #FCEE0A (yellow).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\install.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\install.ps1 -Accent '#00F0FF' -RestartExplorer
#>
[CmdletBinding()]
param(
    [ValidatePattern('^#?[0-9A-Fa-f]{6}$')][string]$Accent = '#FF2BD6',
    [ValidateRange(1024, 65535)][int]$Port = 47777,
    [switch]$SkipDaemon,
    [switch]$SkipWallpaper,
    [switch]$SkipTerminal,
    [switch]$RestartExplorer
)

Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'

$repo    = Split-Path -Parent $PSScriptRoot
$home_   = Join-Path $env:LOCALAPPDATA 'NeonOS'
$appDir  = Join-Path $home_ 'app'
$backup  = Join-Path $home_ 'backup.json'
New-Item -ItemType Directory -Force -Path $home_ | Out-Null

function Step([string]$msg) { Write-Host "[NEON//OS] $msg" -ForegroundColor Magenta }

# ---------- Win32 ----------
if (-not ('NeonOS.Native' -as [type])) {
    Add-Type -Namespace NeonOS -Name Native -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool SystemParametersInfo(uint action, uint uParam, string vParam, uint winIni);
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);
'@
}

# ---------- registry with backup ----------
$touched = [ordered]@{}
if (Test-Path $backup) {
    # Never overwrite the ORIGINAL backup on re-install - that would capture NEON values as "original".
    $existing = Get-Content $backup -Raw | ConvertFrom-Json
    foreach ($p in $existing.PSObject.Properties) { $touched[$p.Name] = $p.Value }
}

function Set-Reg([string]$path, [string]$name, $value, [Microsoft.Win32.RegistryValueKind]$kind) {
    $key = "$path|$name"
    if (-not $touched.Contains($key)) {
        $prev = $null; $prevKind = $null
        if (Test-Path $path) {
            $item = Get-Item $path
            if ($item.GetValueNames() -contains $name) {
                $prevKind = $item.GetValueKind($name).ToString()
                $raw = $item.GetValue($name, $null, 'DoNotExpandEnvironmentNames')
                $prev = if ($raw -is [byte[]]) { [Convert]::ToBase64String($raw) } else { $raw }
            }
        }
        $touched[$key] = [ordered]@{ path = $path; name = $name; existed = ($null -ne $prevKind); kind = $prevKind; value = $prev }
    }
    if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
    New-ItemProperty -Path $path -Name $name -Value $value -PropertyType $kind -Force | Out-Null
}

# ---------- colors ----------
$hex = $Accent.TrimStart('#')
$r = [Convert]::ToByte($hex.Substring(0, 2), 16)
$g = [Convert]::ToByte($hex.Substring(2, 2), 16)
$b = [Convert]::ToByte($hex.Substring(4, 2), 16)
# Little-endian byte packing gives exact signed DWORDs (registry DWORDs are written as Int32).
function To-Abgr([byte]$r, [byte]$g, [byte]$b) { [BitConverter]::ToInt32([byte[]]($r, $g, $b, 0xFF), 0) }
function To-Argb([byte]$a, [byte]$r, [byte]$g, [byte]$b) { [BitConverter]::ToInt32([byte[]]($b, $g, $r, $a), 0) }
function Shade([byte]$c, [double]$f) { [byte][math]::Max(0, [math]::Min(255, [math]::Round($c * $f))) }

# AccentPalette: 8 RGBA swatches, light -> dark. Windows picks [3] as the main accent.
$factors = 1.6, 1.35, 1.15, 1.0, 0.75, 0.55, 0.35, 0.2
$palette = New-Object byte[] 32
for ($i = 0; $i -lt 8; $i++) {
    $palette[$i * 4]     = Shade $r $factors[$i]
    $palette[$i * 4 + 1] = Shade $g $factors[$i]
    $palette[$i * 4 + 2] = Shade $b $factors[$i]
    $palette[$i * 4 + 3] = 0
}
$abgr     = To-Abgr $r $g $b
$abgrDark = To-Abgr (Shade $r 0.55) (Shade $g 0.55) (Shade $b 0.55)

Step "Dark mode, transparency, accent $Accent"
$personalize = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
$dwm         = 'HKCU:\Software\Microsoft\Windows\DWM'
$accentKey   = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Accent'
Set-Reg $personalize 'AppsUseLightTheme'   0 DWord
Set-Reg $personalize 'SystemUsesLightTheme' 0 DWord
Set-Reg $personalize 'EnableTransparency'  1 DWord
Set-Reg $personalize 'ColorPrevalence'     1 DWord
Set-Reg $dwm 'ColorPrevalence'       1 DWord
Set-Reg $dwm 'AccentColor'           $abgr DWord
Set-Reg $dwm 'AccentColorInactive'   $abgrDark DWord
Set-Reg $dwm 'ColorizationColor'     (To-Argb 0xC4 $r $g $b) DWord
Set-Reg $dwm 'ColorizationAfterglow' (To-Argb 0xC4 $r $g $b) DWord
Set-Reg $accentKey 'AccentPalette'   $palette Binary
Set-Reg $accentKey 'AccentColorMenu' $abgr DWord
Set-Reg $accentKey 'StartColorMenu'  $abgrDark DWord

# ---------- static wallpaper ----------
if (-not $SkipWallpaper) {
    $png = Join-Path $repo 'assets\wallpaper.png'
    if (Test-Path $png) {
        Step 'Static fallback wallpaper'
        $dest = Join-Path $home_ 'wallpaper.png'
        Copy-Item $png $dest -Force
        Set-Reg 'HKCU:\Control Panel\Desktop' 'WallPaper'      $dest String
        Set-Reg 'HKCU:\Control Panel\Desktop' 'WallpaperStyle' '10' String   # Fill
        Set-Reg 'HKCU:\Control Panel\Desktop' 'TileWallpaper'  '0' String
        [void][NeonOS.Native]::SystemParametersInfo(0x0014, 0, $dest, 0x03)   # SPI_SETDESKWALLPAPER, update+broadcast
    }
}

# persist backup before anything that can fail late
$touched | ConvertTo-Json -Depth 4 | Set-Content -Path $backup -Encoding UTF8

# ---------- copy app ----------
Step "Installing app files -> $appDir"
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
foreach ($dir in 'wallpaper', 'daemon', 'installer', 'terminal', 'assets') {
    $src = Join-Path $repo $dir
    if (Test-Path $src) { Copy-Item $src (Join-Path $appDir $dir) -Recurse -Force }
}

# ---------- Windows Terminal fragment ----------
if (-not $SkipTerminal) {
    $frag = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\Fragments\NeonOS'
    New-Item -ItemType Directory -Force -Path $frag | Out-Null
    Copy-Item (Join-Path $repo 'terminal\neon-os.json') (Join-Path $frag 'neon-os.json') -Force
    Step 'Windows Terminal: scheme + "NEON//OS Shell" profile added (restart Terminal)'
}

# ---------- Neural Link daemon ----------
if (-not $SkipDaemon) {
    $daemon  = Join-Path $appDir 'daemon\neural-link.ps1'
    $psExe   = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $args_   = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$daemon`" -Port $Port"
    $startup = [Environment]::GetFolderPath('Startup')
    $lnk     = Join-Path $startup 'NEON-OS Neural Link.lnk'
    $wsh = New-Object -ComObject WScript.Shell
    $sc  = $wsh.CreateShortcut($lnk)
    $sc.TargetPath = $psExe
    $sc.Arguments = $args_
    $sc.WorkingDirectory = Split-Path $daemon
    $sc.WindowStyle = 7
    $sc.Description = 'NEON//OS Neural Link daemon'
    $sc.Save()
    Start-Process -FilePath $psExe -ArgumentList $args_ -WindowStyle Hidden
    Step "Neural Link daemon started on http://localhost:$Port/state and registered at logon"
}

# ---------- Lively Wallpaper ----------
$zip = Join-Path $home_ 'NEON-OS-lively.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $appDir 'wallpaper\*') -DestinationPath $zip
# Locate Lively's install folder: per-user, machine-wide (x64/x86) or via its Start-menu shortcut.
function Find-LivelyRoot {
    $roots = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Lively Wallpaper'),
        (Join-Path $env:ProgramFiles 'Lively Wallpaper'),
        (Join-Path ${env:ProgramFiles(x86)} 'Lively Wallpaper')
    )
    $lnk = Get-ChildItem "$env:ProgramData\Microsoft\Windows\Start Menu", "$env:APPDATA\Microsoft\Windows\Start Menu" -Recurse -Filter 'Lively*.lnk' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($lnk) { $roots += Split-Path ((New-Object -ComObject WScript.Shell).CreateShortcut($lnk.FullName).TargetPath) }
    $roots | Where-Object { $_ -and (Test-Path (Join-Path $_ 'Lively.exe')) } | Select-Object -First 1
}
$livelyRoot = Find-LivelyRoot

# Enable Lively input forwarding (Mouse + Keyboard) so clicks and typed secrets reach the wallpaper.
# Lively reads Settings.json only at startup, so it is closed, patched, then relaunched.
$livelySettings = @(
    (Join-Path $env:LOCALAPPDATA 'Lively Wallpaper\Settings.json')
    Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter '*LivelyWallpaper*' -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'LocalCache\Local\Lively Wallpaper\Settings.json' }
) | Where-Object { Test-Path $_ }
if ($livelySettings) {
    $livelyProcs = Get-Process -Name 'Lively' -ErrorAction SilentlyContinue
    $livelyExe = $livelyProcs | Select-Object -ExpandProperty Path -First 1 -ErrorAction SilentlyContinue
    $livelyProcs | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    foreach ($f in $livelySettings) {
        try {
            $json = Get-Content $f -Raw | ConvertFrom-Json
            if ($json.PSObject.Properties.Name -notcontains 'InputForward') { Write-Warning "Unrecognized Lively settings format, skipped: $f"; continue }
            Copy-Item $f "$f.neonos.bak" -Force
            $json.InputForward = 2                      # 0 = off, 1 = mouse, 2 = mouse + keyboard
            # Pre-install into Lively's library so NEON//OS appears as a tile on next launch.
            $libRoot = if ($json.PSObject.Properties.Name -contains 'WallpaperDir' -and $json.WallpaperDir) { $json.WallpaperDir } else { Join-Path (Split-Path $f) 'Library' }
            $libDest = Join-Path $libRoot 'wallpapers\NEON-OS'
            New-Item -ItemType Directory -Force -Path $libDest | Out-Null
            Copy-Item (Join-Path $appDir 'wallpaper\*') $libDest -Recurse -Force
            Step "Added NEON//OS to Lively library ($libDest)"
            if ($json.PSObject.Properties.Name -contains 'MouseInputMovAlways') { $json.MouseInputMovAlways = $true }
            $json | ConvertTo-Json -Depth 20 | Set-Content -Path $f -Encoding UTF8
            Step "Lively input forwarding: Mouse + Keyboard ($f)"
        } catch { Write-Warning "Could not update Lively settings ($f): $_" }
    }
    if (-not $livelyExe -and $livelyRoot) { $livelyExe = Join-Path $livelyRoot 'Lively.exe' }
    if ($livelyExe) { Start-Process $livelyExe; Start-Sleep -Seconds 3 }
    elseif ($livelyProcs) { Write-Host '  >> Reopen Lively Wallpaper from the Start menu to apply input settings.' -ForegroundColor Cyan }
} else {
    if ($livelyRoot) {
        # Installed but never launched: start it once so it writes Settings.json, then ask for a re-run.
        Start-Process (Join-Path $livelyRoot 'Lively.exe')
        Write-Host '  >> Lively was started for the first time. Close its window, then re-run this installer to enable Mouse + Keyboard.' -ForegroundColor Cyan
    } else {
        Write-Host '  >> Lively not found. Install it (winget install rocksdanister.LivelyWallpaper), then re-run this installer.' -ForegroundColor Cyan
    }
}

$candidates = @(
    (Get-Command 'livelycu.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
    $(if ($livelyRoot) { Get-ChildItem $livelyRoot -Recurse -Filter 'livelycu.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName -First 1 })
) | Where-Object { $_ -and (Test-Path $_) }
$applied = $false
if ($candidates) {
    try {
        & $candidates[0] setwp --file (Join-Path $appDir 'wallpaper\index.html') | Out-Null
        $applied = ($LASTEXITCODE -eq 0)
    } catch { $applied = $false }
}
if ($applied) { Step 'Interactive wallpaper applied in Lively' }
else {
    Write-Host ''
    Write-Host '  >> Last step: open Lively, click the NEON//OS tile, then "Set as wallpaper".' -ForegroundColor Cyan
    Write-Host "  >> No tile? Drag this zip onto the Lively window: $zip" -ForegroundColor Cyan
}

# ---------- apply ----------
$res = [UIntPtr]::Zero
[void][NeonOS.Native]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, 'ImmersiveColorSet', 0x0002, 3000, [ref]$res)
if ($RestartExplorer) {
    Step 'Restarting Explorer to apply taskbar accent'
    Stop-Process -Name explorer -Force
}
Write-Host ''
Step 'Jacked in. Wake up, samurai.'
