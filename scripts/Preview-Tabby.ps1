[CmdletBinding()]
param([string]$TabbyPath)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$projectName = Split-Path -Leaf $projectDirectory
$workspaceDirectory = Split-Path -Parent $projectDirectory
$pluginEntry = Join-Path $projectDirectory 'dist/index.js'
if (!(Test-Path -LiteralPath $pluginEntry)) { throw 'Run npm ci and npm run build first.' }

if (!$TabbyPath) {
    $runningTabby = Get-Process -Name Tabby -ErrorAction SilentlyContinue | Where-Object Path | Select-Object -First 1
    if ($runningTabby) { $TabbyPath = $runningTabby.Path }
}
if (!$TabbyPath -or !(Test-Path -LiteralPath $TabbyPath -PathType Leaf)) {
    throw 'Open installed Tabby first or pass its exe path with -TabbyPath.'
}

$projectTemp = Join-Path (Join-Path $workspaceDirectory '.tmp') $projectName
$profileDirectory = Join-Path $projectTemp ('preview-' + [guid]::NewGuid().ToString('N'))
$pluginDirectory = Join-Path $profileDirectory 'plugins/node_modules/tabby-oneai'
New-Item -ItemType Directory -Path $pluginDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectDirectory 'package.json') -Destination $pluginDirectory
Copy-Item -LiteralPath (Join-Path $projectDirectory 'dist') -Destination $pluginDirectory -Recurse
Set-Content -LiteralPath (Join-Path $profileDirectory 'config.yaml') -Encoding ASCII -Value @'
recoverTabs: false
appearance:
  tabsLocation: top
'@

$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = (Resolve-Path -LiteralPath $TabbyPath).Path
$start.Arguments = '--user-data-dir="' + $profileDirectory + '"'
$start.WorkingDirectory = $projectDirectory
$start.UseShellExecute = $false
$start.EnvironmentVariables['TABBY_CONFIG_DIRECTORY'] = $profileDirectory
$start.EnvironmentVariables['TABBY_PLUGINS'] = ''
$start.EnvironmentVariables['TMP'] = $projectTemp
$start.EnvironmentVariables['TEMP'] = $projectTemp
[Diagnostics.Process]::Start($start) | Out-Null
Write-Output "Preview profile: $profileDirectory"
