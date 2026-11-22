# Installation & Setup Guide

**[English](INSTALL.en.md) | [简体中文](INSTALL.md)** · [Back to README](../README.en.md) · [User Guide & FAQ](USAGE.en.md)

---

## 1. Prerequisites

- **OS**: Windows 10 / 11 (64-bit)
- **Host App**: Official [Tabby](https://tabby.sh/) `v1.0.238+`
- **Shell Runtime**: Windows PowerShell 7 (`pwsh.exe`), plus optional WSL 2 distributions (e.g., `Ubuntu-24.04`)
- **Optional**: `Node.js 18+` is only needed in the target runtime if you use live statusLine bridges for **Antigravity (`agy`)** or **Claude Code (`claude`)**, or if you build from source

---

## 2. Installation

### Option 1: One-Line PowerShell Install (Recommended)

Run the following script in PowerShell to download the pre-built release archive from GitHub and install it directly into Tabby's plugins directory:

```powershell
$plugins = "$env:APPDATA\tabby\plugins\node_modules"
$zip = "$env:TEMP\tabby-oneai-v0.2.13.zip"
New-Item -ItemType Directory -Path $plugins -Force | Out-Null
Invoke-WebRequest -Uri "https://github.com/Happyeveryweek/Tabby-OneAI-Workbench/releases/download/v0.2.13/tabby-oneai-v0.2.13.zip" -OutFile $zip
Expand-Archive -LiteralPath $zip -DestinationPath $plugins -Force
Remove-Item -LiteralPath $zip -Force
```

**Restart Tabby** after running the script. The **AI Workbench (`v0.2.13`)** sidebar will appear on the left.

> To upgrade later, simply replace the version number in the script and re-run it -- your added projects and settings are preserved.

---

### Option 2: Manual Download & Extract

1. Download **`tabby-oneai-v0.2.13.zip`** from [**GitHub Releases**](https://github.com/Happyeveryweek/Tabby-OneAI-Workbench/releases/latest);
2. Press `Win + R`, enter **`%APPDATA%\tabby`**, and press Enter to open Tabby's config directory, then navigate into `plugins` → `node_modules`:
   - **If `plugins` or `node_modules` does not exist yet** (common on a fresh Tabby install), create `plugins` inside `%APPDATA%\tabby`, then create `node_modules` inside `plugins`;
3. **The zip already contains the top-level `tabby-oneai` folder**. Place that `tabby-oneai` folder directly inside `node_modules`:
   - Keep the `tabby-oneai` folder level;
   - **Do not double-nest** (e.g., `node_modules\tabby-oneai-v0.2.13\tabby-oneai` or `node_modules\tabby-oneai\tabby-oneai` will not be loaded by Tabby).

Your final folder structure must look like this:

```text
%APPDATA%\tabby\plugins\node_modules\
└── tabby-oneai\                <-- Must keep this tabby-oneai folder level
    ├── package.json
    ├── THIRD_PARTY_NOTICES.md
    ├── README.md
    ├── README.en.md
    └── dist\
        ├── index.js
        └── ...
```

4. **Restart Tabby**.

---

## 3. Recommended First-Time Tabby Settings

### 1. Enable "Recover tabs on startup" (Required for Automatic Session Recovery)

If you want open AI CLI tabs to automatically reopen and re-attach to the workbench status bar and sidebar when you restart Tabby:

- Open **Tabby Settings (gear icon at top right)** → **Application** → enable **Recover tabs on startup** (or set `recoverTabs: true` in Tabby's `config.yaml`).

### 2. Does Tabby's Default Terminal Profile Affect Session Recovery?

**No.** Tabby's default profile only controls what shell opens when you click the `+` new tab button. Every project in AI Workbench stores its own runtime environment (`pwsh.exe` for Windows projects, `wsl.exe --distribution <distro>` for WSL projects), so launching or recovering both Windows and WSL sessions works identically regardless of your default Tabby profile.

---

## 4. Uninstall

1. Close Tabby completely;
2. Delete `%APPDATA%\tabby\plugins\node_modules\tabby-oneai`;
3. Restart Tabby. Uninstalling the plugin **never deletes** any local CLI session logs.

---

## 5. For Developers: Build from Source & Isolated Preview

Requires **Node.js `18+`**:

```powershell
# 1. Install dependencies and compile TypeScript
npm.cmd ci
npm.cmd run build

# 2. Option A: Launch an isolated sandbox Tabby window (does not touch your daily Tabby profile)
.\scripts\Preview-Tabby.ps1

# To reuse projects/tasks from a previous preview run, close the window and pass the printed path:
.\scripts\Preview-Tabby.ps1 -ProfileDirectory '<full-preview-profile-path>'

# 3. Option B: Sync build output to your local Tabby plugins directory
$target = "$env:APPDATA\tabby\plugins\node_modules\tabby-oneai"
New-Item -ItemType Directory -Path "$target\dist" -Force | Out-Null
Copy-Item -LiteralPath package.json, THIRD_PARTY_NOTICES.md, README.md, README.en.md -Destination $target -Force
Copy-Item -Path dist\* -Destination "$target\dist" -Recurse -Force
```
