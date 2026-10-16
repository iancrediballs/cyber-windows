<#
.SYNOPSIS
  Removes NEON//OS and restores every setting install.ps1 changed.

.PARAMETER Purge
  Also delete %LOCALAPPDATA%\NeonOS (Neural Link history and installed app files).
  Wallpaper progress (HP/levels) lives in Lively's browser storage; wipe it via the wallpaper's "Reset all progress" button.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\uninstall.ps1 -RestartExplorer
#>
[CmdletBinding()]
param([switch]$Purge, [switch]$RestartExplorer)

Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'
$home_  = Join-Path $env:LOCALAPPDATA 'NeonOS'
$backup = Join-Path $home_ 'backup.json'
function Step([string]$msg) { Write-Host "[NEON//OS] $msg" -ForegroundColor Magenta }

if (-not ('NeonOS.Native' -as [type])) {
    Add-Type -Namespace NeonOS -Name Native -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool SystemParametersInfo(uint action, uint uParam, string vParam, uint winIni);
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);
'@
}

# ---------- stop daemon + autostart ----------
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*neural-link.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Step "Stopped Neural Link (PID $($_.ProcessId))" }
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'NEON-OS Neural Link.lnk'
if (Test-Path $lnk) { Remove-Item $lnk -Force; Step 'Removed logon shortcut' }

# ---------- terminal fragment ----------
$frag = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\Fragments\NeonOS'
if (Test-Path $frag) { Remove-Item $frag -Recurse -Force; Step 'Removed Windows Terminal fragment' }

# ---------- registry restore ----------
if (Test-Path $backup) {
    $entries = (Get-Content $backup -Raw | ConvertFrom-Json).PSObject.Properties
    foreach ($e in $entries) {
        $v = $e.Value
        if ($v.existed) {
            $value = if ($v.kind -eq 'Binary') { [Convert]::FromBase64String($v.value) } else { $v.value }
            if (-not (Test-Path $v.path)) { New-Item -Path $v.path -Force | Out-Null }
            New-ItemProperty -Path $v.path -Name $v.name -Value $value -PropertyType $v.kind -Force | Out-Null
        } elseif (Test-Path $v.path) {
            Remove-ItemProperty -Path $v.path -Name $v.name -ErrorAction SilentlyContinue
        }
    }
    Step "Restored $(@($entries).Count) settings"
    $wp = (Get-ItemProperty 'HKCU:\Control Panel\Desktop' -Name WallPaper -ErrorAction SilentlyContinue).WallPaper
    if ($null -ne $wp) { [void][NeonOS.Native]::SystemParametersInfo(0x0014, 0, $wp, 0x03) }
    Remove-Item $backup -Force
} else {
    Write-Warning 'No backup.json found - registry left as is.'
}

$res = [UIntPtr]::Zero
[void][NeonOS.Native]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, 'ImmersiveColorSet', 0x0002, 3000, [ref]$res)

if ($Purge -and (Test-Path $home_)) { Remove-Item $home_ -Recurse -Force; Step "Purged $home_" }
if ($RestartExplorer) { Stop-Process -Name explorer -Force }
Step 'Disconnected. The city will remember you.'
