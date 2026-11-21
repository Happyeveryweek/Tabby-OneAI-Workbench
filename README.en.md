# Tabby-OneAI-Workbench (`tabby-oneai`)

**Turn official Tabby into a project-centric command center for 8 mainstream AI Coding CLIs -- aggregating multi-agent workflows across Windows & WSL 2 with zero compromise on native terminal and TUI features.**

`Version v0.2.13` · `Tabby v1.0.238+` · `Windows (PowerShell 7) & WSL 2` · `MIT License`

**[English](README.en.md) | [简体中文](README.md)**

[Why This Plugin?](#why-tabby-oneai-workbench) · [Supported AI CLIs](#supported-ai-clis-capability-matrix) · [Key Features](#key-features) · [Architecture](#architecture--workflow) · [Quick Start](#installation--quick-start) · [Shortcuts](#default-keyboard-shortcuts)

![Tabby-OneAI-Workbench Main Overview](assets/workbench-overview.png)

---

## Why Tabby-OneAI-Workbench?

Modern AI-assisted engineering rarely relies on a single tool. When you run **Codex**, **Claude Code**, **Antigravity (`agy`)**, **OpenCode**, **GitHub Copilot CLI**, **Pi**, **Kimi Code**, and **Grok Build** across multiple **Windows folders** and **WSL 2 distributions**, you quickly hit a wall between chaotic terminal tabs and restrictive GUI wrappers:

| The Pain Point | How Tabby-OneAI-Workbench Solves It |
| :--- | :--- |
| **Tab Chaos Across Windows & WSL**: Once you open a dozen terminal tabs, it is hard to tell which tab belongs to which repo, WSL distro, or AI CLI. Resuming a session from yesterday means hunting for session IDs and typing `--resume <uuid>`. | **Persistent `Project → CLI → Session` Sidebar Tree**: Automatically organizes live tasks and local CLI session histories under their respective Windows (`PS7`) or Linux (`WSL · <distro>`) project directories. Double-click any item to focus a live pane or resume the exact historical session in place. |
| **GUI Wrappers Break Native CLI Features**: Third-party chat wrappers strip away what makes terminal AI agents powerful -- slash commands, interactive permission prompts (`y/n`), subagent status trees, full-screen diffs, custom keymaps, and native split panes. | **100% Native Tabby Terminal, Zero TUI Compromise**: Every session runs directly inside Tabby's native ConPTY / WSL PTY terminal, living side-by-side with your regular PowerShell 7, WSL `bash`, and SSH tabs. Native split panes (`SplitTabComponent`) and tab recovery work seamlessly. |
| **Blind Background Execution**: When 3--5 agents run in parallel across background tabs, you cannot easily see which one is still thinking, which one is blocked on a tool-approval prompt (`Waiting`), which one stopped on an error (`Error`), or which one finished with unread output. | **Unified Real-Time Status Engine**: Tracks `Running`, `Waiting`, `Ready`, `Error`, and `Exited` across the tab bar's bottom `.colorbar` (soft same-color breathing animation), the session status bar, sidebar CLI group badges, and session rows -- plus smart `New` unread badges and active-task close confirmation. |
| **Opaque Token Burn, Context Saturation & Quotas**: Long agent loops quietly exhaust your context window or hit 5-hour / 7-day rate limits, with no unified view of token consumption across CLIs and models. | **Live Telemetry Bar + `1100 × 800` Usage Dashboard**: Displays real-time `Tokens`, `5h / 7d` remaining quota & reset timers, `Model / Effort`, and a 3-color `Ctx` progress bar below the tab bar. Click to open a 3-tier cascading (`Project → Session → Model`) analytics dashboard with a 52-week heatmap, daily bar charts, and cache-read breakdown tooltips. |

---

## Supported AI CLIs Capability Matrix

The workbench strictly isolates Windows (PowerShell 7) and WSL 2 environments (filtering out mounted `/mnt/*` host binaries inside WSL and VS Code `copilot-shim` stubs while automatically resolving user-level CLI paths such as `~/.opencode/bin`, `~/.local/bin`, `~/.bun/bin`, and `~/.cargo/bin`), showing only the CLIs installed in each project's runtime environment:

| AI CLI | Executable | Session Discovery & Exact Resume | Real-Time Activity (`Running / Waiting / Ready / Error`) | Live Status Bar Metrics (`Model / Ctx / Tokens / Quota`) | Prompt History Drawer & Usage Dashboard | Multi-Directory / Multi-Account Isolation |
| :--- | :---: | :--- | :--- | :--- | :---: | :---: |
| **OpenAI Codex** | `codex` | Local rollout logs + App Server history merge, `codex resume <id>` | Terminal title state + screen idle/interrupt & error verification | `Model/Effort` · `Ctx %` · `Tokens` · `5h/7d` live & local quota | Full Support | Multiple `CODEX_HOME` scopes |
| **Antigravity** | `agy` | `~/.gemini/antigravity-cli` session parser, `agy --conversation <id>` | Official statusLine bridge + editor box + background subagent (`/tasks`) tracking | `Model/Effort` · `Ctx %` · `Tokens` · `5h/7d` dynamic model-family quota | Full Support | Default environment home |
| **Claude Code** | `claude` | `projects/` JSONL transcript scanner, `claude --resume <id>` | Official statusLine bridge + live terminal editor & error detection | `Model/Effort` · `Ctx %` · `Tokens` · `5h/7d` rate limits | Full Support | Multiple `CLAUDE_CONFIG_DIR` scopes |
| **Pi Coding Agent** | `pi` | Session JSONL scanner, `pi --session <id>` | Native `PI_PROGRAM_STATUS=1` (`OSC 7501`) + editor & footer parser | `Model/Effort` · `Ctx %` · `Tokens` (dual JSONL + live footer) | Full Support | Multiple `PI_CODING_AGENT_DIR` scopes |
| **OpenCode** | `opencode` | `opencode session list / export` (v2 schema compatible), `opencode -s <id>` | Terminal prompt & footer tracking (`esc interrupt` / `Permission required` / `Error`) | `Model/Effort` · `Ctx %` · `Tokens` | Full Support | Default environment home |
| **Grok Build** | `grok` | `~/.grok/sessions/` scanner, `grok --resume <id>` | Triple-source `OSC 9;4` progress + terminal title + screen parser | `Model/Effort` · `Ctx %` · `Tokens` | Full Support | Default (`GROK_HOME`) |
| **Kimi Code** | `kimi` | Supports both `KIMI_CODE_HOME` (`wire.jsonl`) and legacy `KIMI_SHARE_DIR` | `OSC 7501` + terminal editor activity & error detection | `Model/Effort` · `Ctx %` · `Tokens` | Full Support | Multiple `KIMI_CODE_HOME` scopes |
| **GitHub Copilot CLI** | `copilot` | `~/.copilot/session-state/` (`events.jsonl`), `copilot --resume <id>` | Terminal editor activity + `session.error` detection | `Model` · `Ctx %` · `Tokens` | Full Support | Default (`COPILOT_HOME`) |

---

## Key Features

### 1. Cross-Environment Project Tree (Windows PowerShell 7 & Multi-Distro WSL 2)
- **3-Tier Rounded Connector Tree**: Organizes `Project → CLI Group → Session` with clean two-level rounded tree connectors, resizable sidebar width, collapsible narrow Rail mode, and instant keyword filtering.
- **Runtime & Git Awareness**: Displays `PS7` or `WSL · <distro>` badges (automatically distinguishing multiple WSL distributions), current Git branch pills, one-click project pinning, and a context-menu action to **Open Project Folder** in Windows Explorer (automatically translating WSL paths to `\\wsl.localhost\...`).
- **Live Binding for New Sessions**: Starting a brand-new session in any supported AI CLI automatically binds to the newly created transcript file on disk as soon as your first turn is recorded, updating the sidebar title, prompt history drawer, and token metrics in real time.
- **Progressive Session Lists & 0ms Global History Search**: Each CLI group shows the latest `2` sessions by default with `+3` step expansion and one-click collapse. Right-click any project or CLI group to open **Search Session History…** with `0 ms` in-memory cached rendering, CLI filter pills, and background incremental scanning.

### 2. Unified Real-Time Status & Lifecycle Protection
- **5 Semantic Runtime States**:
  - `Running` (Emerald `#20b782`): The agent is actively thinking, executing tools, or running background subagents (`1 task(s) · /tasks`). The tab's bottom `.colorbar` displays a calm `2.2s` same-color breathing glow (free of harsh white flashes).
  - `Waiting` (Amber `#cf920c` / `#d99b18`): The CLI is waiting for user confirmation or tool permission (`Allow once`, `[y/n]`).
  - `Ready` / `Online` (Cyan-Blue `#5a9de1`): The session is idle at the prompt waiting for input (with startup-phase protection so newly opened or resumed sessions settle straight into `Ready` without falsely flashing `Running` during MCP initialization or history replay).
  - `Error` / `Failed` (Coral Red `#e26070`): The turn stopped on an API, quota, or authentication error (automatic retries remain `Running` without false red alerts; clears automatically on the next turn).
  - `Exited` (Hollow Grey Ring `#808893`): Historical or closed session. Exiting any CLI via `Ctrl+C`, `Esc`, or `/exit` automatically closes the terminal tab/pane (matching the tab bar's `×` close behavior) and marks the sidebar entry as `Exited`.
- **Seamless In-Place Auto-Restart After CLI Self-Update**: When any AI CLI prompts `Update available -> Update now` (or runs `/update` / `/upgrade`), the workbench automatically switches to `Running` and locks the tab from closing; once the update succeeds and the old CLI process exits, it **automatically relaunches the newly updated CLI in-place inside the same tab** and resumes your session (preserving the terminal output if the update fails).
- **False-Positive-Free `New` (`新输出`) Badges**: Background tabs only light up `New` when genuine background work or an approval prompt occurs while unfocused. Once you have viewed a completed reply, switching away to another AI CLI, WSL shell, or PowerShell tab will never falsely re-trigger `New` from idle ANSI redraws or footer countdown ticks.
- **Active Execution Close Guard**: Closing a tab or the Tabby window while tasks are `Running`, `Waiting`, or `Starting` prompts for confirmation before terminating active agents.

### 3. Dynamic Telemetry Bar & `1100 × 800` Usage Analytics Dashboard
- **Capability-Driven Status Bar**: Mounted directly below Tabby's tab bar, rendering only the metric pills actually supported and populated by the active CLI (zero empty `—` placeholders):
  - `Tokens` cumulative counter (click to jump straight to that session's usage analytics);
  - `5h` / `7d` remaining quota percentage (color-coded green/amber/red) with reset countdowns and one-click online quota refresh for Codex;
  - `Model / Effort` active model and reasoning effort badge;
  - `Ctx` context window utilization percentage with a 3-tier color mini-bar (`<55%` blue, `55%–80%` amber, `≥80%` red).
- **3-Tier Cascading Usage Dashboard**:
  - Filter cascadingly by **Project → Session → Model** across **Last 12 Months / This Month / This Week** (with period token totals on each pill);
  - **4 Core KPI Cards**: Total Tokens, Cache Read Share, Active Sessions, and Active Days;
  - **Adaptive Activity Chart**: 52-week GitHub-style activity heatmap for the 12-month view, automatically switching to daily token bar charts for Monthly and Weekly views;
  - **Model Breakdown & Hover Tooltips**: Hover over any segment of the distribution bar or model table to inspect exact Input, Output, Cache Read, and Cache Write / Reasoning token splits.

![Usage Analytics Dashboard](assets/usage-dashboard.png)

### 4. Slide-Out Prompt History Drawer & Non-Destructive Session Management
- **Prompt History Drawer**: Slides out below the session status bar (avoiding window control buttons), listing all user prompts in reverse chronological order with keyword search, long-prompt expand/collapse, and one-click full-text copy.
- **Non-Destructive Removal & Recovery**: Removing a project or session from the workbench never deletes your underlying CLI transcript files. Visit **Settings → Session Management** to filter removed sessions by project (`PS7` / `WSL`), CLI, or keyword, and restore individual items or entire project groups in one click.

![Global Session Search and Prompt History Drawer](assets/history-search.png)

### 5. Dual-Track Zero-Tuning Typography, 16 Themes & Bilingual UI
- **Dual-Track Font Stack**: Uses `Noto Sans SC` (`13 px`, `0.0 px` letter spacing out of the box) for crisp UI text and `Cascadia Code` for numeric/code badges (`version`, `branch`, `Tokens`, `Ctx`). Supports searching any installed system font and automatically tightens letter spacing (`-0.9 px`) and word spacing when wide CJK monospace fonts (`Maple Mono NF CN`, `Sarasa Mono SC`) are selected.
- **16 Built-In Palettes**: Includes Follow Tabby, Light, Dark, 6 Eye-Care palettes (Bean Green, Lavender, Mist Grey, Nord Blue, Forest Night, Ink Night), and 10 Editor palettes (Darcula, Sublime Material, Monokai, Mariana, Solarized Dark/Light, IntelliJ Light, IDEA Light, Kiro Dark/Light) with opaque backdrop protection for transparent/acrylic Tabby windows.
- **Independent Language & Recordable Hotkeys**: Switch between **简体中文** and **English** independently of Tabby's host language, and record custom hotkeys (`Ctrl-Alt-Shift-H/U/O/B` presets with conflict detection and one-click reset).

![Appearance Themes and Dual-Track Typography Settings](assets/appearance-themes.png)

---

## Architecture & Workflow

```mermaid
flowchart LR
    subgraph UI["Tabby-OneAI-Workbench Plugin Layer (Angular 15)"]
        Sidebar["Project Tree Sidebar\nProjectsComponent"]
        StatusBar["Top Session Telemetry Bar\nStatusComponent"]
        Overlay["Settings / Usage / Global Search\nWorkbenchOverlay & SessionPanel"]
    end

    subgraph Core["Orchestration & Status Engine (WorkspaceService)"]
        Detector["Cross-Env CLI Detection & Cache\ncommands.ts / cli-directories.ts"]
        Activity["Multi-Source Activity Engine\nTitle / OSC 7501 / OSC 9;4 / xterm / Bridge"]
        History["Transcript & Token Analytics\ncodex-data.ts / cli-history.ts / usage-summary.ts"]
    end

    subgraph Host["Official Tabby Host (v1.0.238+)"]
        Profiles["ProfilesService & AppService"]
        SplitTab["SplitTabComponent / TerminalTabComponent"]
        Xterm["Native xterm.js & ConPTY / WSL PTY"]
    end

    Sidebar -->|"Launch / Resume / Focus"| Core
    StatusBar <-->|"Live Metrics / Quota Refresh"| Core
    Overlay <-->|"3-Tier Usage / Prompt History"| History
    Core -->|"openNewTabForProfile\nbehaviorOnSessionEnd: close"| Profiles
    Profiles --> SplitTab --> Xterm
    Xterm -->|"output$ / title$ / input$ / onWriteParsed"| Activity
```

---

## Installation & Quick Start

### Prerequisites

- **OS**: Windows 10 / 11 (64-bit)
- **Host Application**: Official [Tabby](https://tabby.sh/) `v1.0.238`
- **Runtime**: Windows PowerShell 7 (`pwsh.exe`) and optional WSL 2 distributions (e.g., `Ubuntu-24.04`)
- **Build Tooling**: Node.js `18+` (required for building the plugin and running the Antigravity / Claude statusLine bridge)

### Option 1: Build & Install into Your Tabby Plugins Directory (Recommended)

```powershell
# 1. Install dependencies and compile TypeScript
npm.cmd ci
npm.cmd run build

# 2. (Optional) Pack offline tarball artifacts/tabby-oneai-0.2.13.tgz
npm.cmd pack --pack-destination artifacts

# 3. Sync build output to Tabby's plugins directory
$target = "$env:APPDATA\tabby\plugins\node_modules\tabby-oneai"
New-Item -ItemType Directory -Path "$target\dist" -Force | Out-Null
Copy-Item -LiteralPath package.json, THIRD_PARTY_NOTICES.md -Destination $target -Force
Copy-Item -Path dist\* -Destination "$target\dist" -Recurse -Force
```

Restart or reload your Tabby window. The **AI Workbench (`v0.2.13`)** sidebar will appear on the left.

### Option 2: Launch an Isolated Preview Sandbox (Recommended for Development)

To test or develop the plugin without touching your personal Tabby profile, run the included preview script:

```powershell
npm.cmd ci
npm.cmd run build
.\scripts\Preview-Tabby.ps1
```

- The script automatically locates your installed `Tabby.exe` (or accepts `-TabbyPath`) and launches a new Tabby instance with an isolated configuration directory under `.tmp`.
- To reuse projects and session records from a previous preview run, close the preview window first and pass its printed profile path:
  ```powershell
  .\scripts\Preview-Tabby.ps1 -ProfileDirectory '<full-preview-profile-path-printed-previously>'
  ```

---

## Default Keyboard Shortcuts

All hotkeys can be recorded, cleared, or reset to defaults in **Workbench Settings → Shortcuts** (persisted directly to Tabby's `config.store.hotkeys`):

| Action | Default Shortcut |
| :--- | :--- |
| Toggle Prompt History Drawer | `Ctrl-Alt-Shift-H` |
| Open Session / Project Usage Analytics | `Ctrl-Alt-Shift-U` |
| Open Workbench Settings | `Ctrl-Alt-Shift-O` |
| Collapse / Expand Project Sidebar | `Ctrl-Alt-Shift-B` |

---

## Privacy & Security

- **100% Local Read-Only Parsing**: All session histories, prompt drawers, and token usage statistics are parsed locally from your Windows or WSL CLI data directories. No code, prompts, or telemetry are ever sent to any external server.
- **Zero Credential Harvesting**: API keys, OAuth tokens, and login states are managed exclusively by each AI CLI. The plugin never writes secrets, credentials, or terminal scrollback contents into project files or logs.
- **Scoped Persistence**: Project lists, task bindings, appearance settings, and custom CLI directory mappings are stored locally inside the active Tabby profile's `localStorage`.

---

## Credits & License

- Portions of the Codex rollout/usage parser, CLI brand artwork, and appearance color palettes are adapted from [OneAI](https://github.com/Qingxuan365/oneAI) (MIT License). The GitHub Copilot icon is from [GitHub Octicons](https://github.com/primer/octicons) (MIT License). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for full notices.
- Built on top of the official [Tabby](https://github.com/Eugeny/tabby) plugin architecture.
- Released under the **MIT License**.
