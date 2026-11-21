# Tabby-OneAI-Workbench

面向 Windows 桌面 Tabby 的 AI CLI 工作台插件（npm 插件包名：`tabby-oneai`）。按目录组织 AI 任务，通过 Tabby 原生终端运行并切换任务。

- 界面与交互见 [设计方案](DESIGN.md)、[全量界面原型](docs/ui-redesign-prototype.html) 和 [用量统计原型](docs/usage-prototype.html)。
- 开发范围见 [实施方案](IMPLEMENTATION.md)，已验证的能力见 [路线图](ROADMAP.md)。

## 试用 v0.2.12

环境为 Windows、PowerShell 7、Node.js 和官方 Tabby `v1.0.238`。WSL 项目需要已经安装的发行版，AI CLI 在各自运行环境内独立安装。

```powershell
npm.cmd ci
npm.cmd run build
.\scripts\Preview-Tabby.ps1
```

预览脚本会使用正在运行的 Tabby 安装，也可通过 `-TabbyPath` 指定 `Tabby.exe`。默认新建独立的 Tabby 配置，路径会输出到终端。要沿用旧预览的项目和任务，先关闭对应的预览窗口，再传入 `-ProfileDirectory '<上次输出的完整路径>'`。

1. 点「添加项目」选择运行环境。PowerShell 7 打开系统文件夹选择器，WSL 输入所选发行版的 Linux 路径。右键项目可选择已检测到的 CLI，右键 CLI 分组可新建会话。安装新 CLI 后可到「设置 → CLI」重新检测。
2. 在「设置 → CLI 环境与目录」查看 Windows 和各 WSL 发行版的数据路径及存在状态。Codex、Claude Code、Pi、Kimi Code 支持多个目录，可指定默认启动项和刷新历史。Kimi Code 支持读取 `KIMI_CODE_HOME` 和旧版 `KIMI_SHARE_DIR`。
3. 侧栏按项目和 CLI 分组，每组默认显示最新三条会话，点「更多」查看较早的记录。双击可恢复 Codex、Antigravity、Pi、OpenCode、Claude Code 和 Kimi Code 的历史会话，也可聚焦已打开的会话。会话行右侧显示最近活动时间，已打开的会话标题加粗并带强调色。
4. Codex、Antigravity 和 Claude Code 状态栏显示可用的 `Model`、`Context`、累计 `Tokens` 和 5 小时／7 天额度。Antigravity 额度随当前模型切换。已绑定的 Kimi 会话可显示日志中提供的模型、Tokens 和上下文字段。
5. 右键项目或会话可将对应记录从工作台移除。项目可以重新添加原目录，会话可在「设置 → 会话管理」加回。CLI 源文件和已打开的终端由各自应用管理。

Codex 的 `Ready`、`Running` 和 `Waiting` 来自终端标题。Antigravity 的状态与指标来自官方状态栏数据，状态也可从输入区识别。Antigravity 和 Claude Code 的状态栏数据需要当前 CLI 支持 `--settings` 且当前运行环境安装了 Node.js。Pi 和 OpenCode 从 Tabby 的 xterm 读取交互区状态。Claude Code 和 Kimi Code 的活动标签显示 `Online` 和 `Exited`，额度及上下文按 CLI 实际数据展示。

「工作台设置 → 外观」可选择跟随 Tabby、浅色、深色、护眼与编辑器配色，以及独立简体中文 / English 语言切换。默认使用 `Noto Sans SC` 界面字体（数据/数值等宽胶囊采用 `Cascadia Code`）、独立字号 `13 px` 与 `0.0 px` 字间距无需额外微调；同时支持输入/复制或下拉检索切换本机字体，若手动选用 `Maple Mono` 等宽中文字体将自动应用 `-0.9 px` 字间距与中英文词距优化。右侧终端的字体、行距与光标在 Tabby 原生设置中调整。

「历史提示词」从会话状态栏下方展开，可预览、展开或右键复制。「用量统计」显示近 12 个月、本月、本周的 Tokens、会话数和活跃天数，并提供每日热力图和模型明细。会话和项目共用同一尺寸，可按模型与时间筛选。项目视图最多读取近期 100 条会话。

## 本地插件包

构建后执行 `npm.cmd pack --pack-destination artifacts` 可生成 `artifacts/tabby-oneai-0.2.12.tgz`。在 Tabby 的 Settings → Plugins → Open Plugins Directory 下建立 `node_modules/tabby-oneai`，将包内文件解压到该目录，重开 Tabby 即可加载。首次试用可用预览脚本。 [Tabby 插件加载规则](https://github.com/Eugeny/tabby/blob/v1.0.238/HACKING.md#plugins)

项目、任务、移除记录与自定义 CLI 目录保存在当前 Tabby 配置的本地存储。各 CLI 管理自己的登录凭据和历史。用量统计读取 Codex、Claude Code、Kimi Code 和 Pi 的本地记录。 [v0.2 验收记录](docs/v0.2-verification.md)
