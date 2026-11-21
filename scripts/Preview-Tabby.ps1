[CmdletBinding()]
param([string]$TabbyPath, [string]$ProfileDirectory)

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
if ($ProfileDirectory) {
    $ProfileDirectory = (Resolve-Path -LiteralPath $ProfileDirectory).Path
    $previewRoot = (Resolve-Path -LiteralPath $projectTemp).Path
    if ((Split-Path -Parent $ProfileDirectory) -ne $previewRoot -or (Split-Path -Leaf $ProfileDirectory) -notmatch '^preview-[a-f0-9]{32}$') {
        throw 'Use a Preview profile path printed by this script.'
    }
    $openPreview = Get-CimInstance Win32_Process -Filter "Name='Tabby.exe'" | Where-Object {
        $_.CommandLine -and $_.CommandLine.IndexOf($ProfileDirectory, [StringComparison]::OrdinalIgnoreCase) -ge 0
    }
    if ($openPreview) { throw 'Close this preview window before updating its plugin.' }
} else {
    $ProfileDirectory = Join-Path $projectTemp ('preview-' + [guid]::NewGuid().ToString('N'))
}
$pluginDirectory = Join-Path $profileDirectory 'plugins/node_modules/tabby-oneai'
New-Item -ItemType Directory -Path $pluginDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectDirectory 'package.json') -Destination $pluginDirectory
Copy-Item -LiteralPath (Join-Path $projectDirectory 'dist') -Destination $pluginDirectory -Recurse -Force
$configuration = Join-Path $profileDirectory 'config.yaml'
if (!(Test-Path -LiteralPath $configuration)) {
    Set-Content -LiteralPath $configuration -Encoding ASCII -Value @'
recoverTabs: false
appearance:
  tabsLocation: top
'@
}

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
