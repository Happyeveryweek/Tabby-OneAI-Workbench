# TabbyOneAi 路线图

## 当前阶段

- `v0.2.11` 本地试用。官方 Tabby `v1.0.238` 已通过隔离窗口回归，覆盖字号、项目入口、目录状态、历史抽屉、用量筛选及 Claude Code 和 Kimi Code 数据接入。
- `v0.2.12` 已修复在 `enableWelcomeTab: false`（`StartPageComponent`）配置下 `WorkbenchLayout` 的 `MutationObserver`/`ResizeObserver` 运行在 `NgZone` 内导致的启动白屏卡死问题；补齐全仓稳定性加固与玻璃透明模式下悬浮层不透明底色修复；重构「添加项目」为统一弹窗；修复 `OpenCode`、`Pi`（全 CLI 手动中断归为 `Ready`）、`Grok Build`（`OSC 9;4` + 标题 + 屏幕三路状态）与 `Claude Code` / `Kimi Code` 实时状态；顶部标签栏改为仅保留底部状态条（隐藏重复顶部活跃指示条，移除闪烁圆点并在 `Running`/`Waiting` 状态为底部 `.colorbar` 施加动态流光与脉动效果）、侧栏会话行动态状态徽章、隐藏普通终端多余大图标、全局圆角主题化悬停提示 `.oneai-tooltip`；修复 Tabby `recoverTabs` 启动恢复标签页时 `SplitTabComponent.initialized$` 异步挂载、重复/裁剪任务重建、`status.json` 持久化重连及 Antigravity/Pi 状态栏与 Token/Model/Ctx 指标自动恢复；项目右键菜单新增「打开项目文件夹」（支持 Windows 与 WSL 映射路径）；工作台字体默认首选 `Maple Mono NF CN` 并分离独立回退栈（切换非等宽字体时中英文与系统 UI 同步回退不再锁定 Maple Mono）、默认独立字号 `13 px`、内联字体选择框点击展开即保留全量列表并高亮滚动定位当前已选字体、「工作台字间距」默认设为字体感知自适应（`Maple Mono` 自动 `-0.9 px` 并按比例收紧中英文空格词距，未安装等宽字体或选择比例字体时自动回退 `0.0 px`）且补齐全部按钮/输入框的字间距/词距继承与数值等宽徽章 `0 px` 隔离；侧栏默认宽度收窄至 `252 px` 并持久化拖拽宽度；增加关闭窗口/标签时对运行中会话的二次确认防误中断弹窗；同步更新 `docs/ui-redesign-prototype.html` 与 `docs/usage-prototype.html` 设计原型。已完成 `tsc`、单测及隔离 Tabby CDP 验证并更新本地打包 `artifacts/tabby-oneai-0.2.12.tgz`。

## 已完成

- 设计方案与可交互浏览器原型，通过 Chrome 桌面与窄窗口检查。
- Windows 和 WSL 项目树、顶部状态栏、CLI 检测、原生终端启动与切换、后台待查看和本地持久化。
- 构建本地插件包，实测并行任务、原生分屏、独立退出、侧栏折叠和挂载失败后的工具栏入口。详见 [v0.1 实机验收](docs/v0.1-verification.md)。
- 接入 Codex 独立账号、精确会话恢复、最近消息、彩色额度栏、按账号与模型统计用量。已通过本机原生启动和受控数据的插件流程检查，详见 [v0.2 验收](docs/v0.2-verification.md) 。
- 侧栏在启动时自动加载各项目的最近会话。实机验证了打开旧配置后自动显示、按目录归属、双击恢复与会话去重。
- 项目加号改为 CLI 启动菜单。项目会话与原生标签按 CLI 显示图标，标签色条随终端状态和分屏焦点更新。实机验证了文件夹入口、设置、历史抽屉与用量弹窗。
- 支持 Windows 与 WSL 识别和 CLI 检测缓存，接入 Codex、Antigravity、Pi、OpenCode、Claude Code、Kimi Code 的会话历史。Codex、Claude Code、Pi、Kimi Code 支持配置多个数据目录及默认启动项。实机样本和受控数据验证范围见 [验收记录](docs/v0.2-verification.md) 。
- 项目树按 CLI 分组，默认最近三条，支持移除、会话管理和重新添加。补齐英文状态、上下文占用、提示词摘要、按会话与项目统计、Tabby 主题跟随，以及标题和图标对齐。
- Codex、Antigravity、OpenCode 已接入就绪、运行和等待状态，Pi 已接入就绪和运行状态。Antigravity 的额度随当前模型切换。
- 外观增加护眼和编辑器配色，以及可搜索的本机字体设置。侧栏分支统一对齐，长名称省略。工作台挂载后隐藏右上角备用入口。
- 工作台字号集中在「外观」，可跟随 Tabby 或独立设置。添加项目时选择 PowerShell 7 或 WSL，目录页显示路径存在状态，历史抽屉避开窗口控制按钮。
- 用量面板按会话或项目显示 Tokens、活跃天数、热力图和模型明细，切换范围时保持尺寸一致。Claude Code 状态栏和 Kimi 新旧日志使用受控样本验收。详见 [v0.2.11 验收](docs/v0.2-verification.md#v0211) 。
- 全量界面 UI 与用量统计重构：用量弹窗扩大为 `1100 × 800` 并改为「项目 → 会话 → 模型」三级圆角下拉级联筛选，增加周期分段胶囊、4 张核心 KPI 卡片、年度热力图与月周柱状图、模型简略胶囊、统计条与模型行悬浮拆分浮层及底部数据仅供参考说明；接入 Antigravity (`agy`) 会话 `transcript.jsonl` 的多模型 Token 明细解析与斜杠命令标题跳过，修复 Windows 下 `agy` 状态栏桥接命令双引号转义失败及 Neon/Argon/第三方模型额度切换，历史提示词按最新倒序排列；侧栏升级两级竖横圆角树形折线与快速筛选，全界面统一运行状态徽章、圆角下拉与等高主题色卡。详见 [全量 UI 原型](docs/ui-redesign-prototype.html) 与 [用量原型](docs/usage-prototype.html) 。
- 项目启动菜单、跨环境 CLI 检测与新会话实时联动优化：移除「系统终端」与「自定义命令与目录…」，右键项目（含新添加的空目录项目）或点 `+` 直接展示当前环境已安装的 AI CLI 列表；严格隔离 Windows 与 WSL CLI 检测（过滤 WSL 挂载的 `/mnt/*` 宿主机路径与 VS Code `copilot-shim` 占位桩）；新建 `codex`、`pi`、`claude`、`opencode`、`kimi`、`agy`、`grok` 会话对话后自动绑定底层新会话日志并实时同步左侧会话标题、右侧历史提示词与用量统计；左侧项目树按最新会话与添加时间动态置顶排序。
- 接入 Grok Build (`~/.grok/sessions/`) 历史会话、提示词、Token 用量与上下文详情解析；修正顶部标签栏图标顺序为「图标 → 序号 → 标题」；左侧会话分组展开「更多会话…」后支持点击「收起会话」折叠回默认 3 条；修复顶部状态栏 `Ctx` 上下文进度条的 `display:block` 渲染与三色阈值（`<55%` 蓝、`55%–80%` 琥珀色、`≥80%` 红色）动态联动。
- 修复 Pi 与各 CLI 运行状态同步、项目置顶与多 WSL 环境适配：修复 `watchEditor` 因 `task.detail` 提前 `return` 导致 Pi 会话卡在 `Running` 或 `Online` 的问题，并为 Pi 注入 `PI_PROGRAM_STATUS=1` 原生解析 `OSC 7501` 状态序列（同时补齐 Grok / Claude / Kimi 的 TUI 状态识别兜底）；移除项目右侧 `+` 按钮并改为项目置顶图钉按钮（支持点击图钉或右键菜单置顶/取消置顶，置顶项目恒排在最上方）；多 WSL 发行版下项目徽章、状态栏与筛选列表自动区分显示 `WSL · <distro>`；修复标签栏自定义图标 flex 覆盖导致原生关闭按钮 `×` 失效的问题。
- 顶部状态栏按 CLI 实际支持指标动态渲染与 Pi / Kimi / Grok / OpenCode 状态栏校准：状态栏各胶囊（`Tokens`、`5h / 7d` 额度、`Model / Effort`、`Ctx` 上下文进度条）改为仅在对应 CLI 支持且存在有效数据时展示，彻底移除不支持额度或无数据时的 `5h — | 7d —` 和 `Ctx —` 空占位；修复 Pi 状态栏模型停留在旧模型与 `Ctx` 为空的问题（同步解析 `.jsonl` 的 `model_change`、`thinking_level_change`、单轮上下文 Token 及终端底部 Footer 实时输出的 `0.5%/1.0M` 与 `(provider) model • effort`）；补齐新版 Kimi `wire.jsonl` 与 Claude / Grok 的上下文占用及模型同步，OpenCode 仅展示其支持的历史提示词入口。
- 适配全量 7 个 AI CLI（`codex`、`claude`、`kimi`、`pi`、`opencode`、`grok`、`agy`）的本轮最终报错停止状态（`Error` / 红色 `#e26070`）：自动重试期间保持绿色 `Running` 不标红，仅当本轮已停止工作并最终停在报错时，顶部标签色条、状态栏胶囊、左侧 CLI 分组及会话圆点同步标红为 `Error`，下一轮发起请求或正常回复后自动恢复。
- 修复 WSL 与 Windows 下 OpenCode 检测与历史/用量同步、项目内 CLI 动态排序及基础主题精简：在 WSL 非交互式 `bash -lc` 执行环境中自动补齐 `$HOME/.opencode/bin`、`~/.local/bin`、`~/.bun/bin` 等用户级 CLI 路径并升级检测缓存签名（实测 WSL `Ubuntu-24.04` 正确检出 `opencode` 及 `KnowVideo` 下的历史会话）；兼容 OpenCode v2 `opencode session export` 消息结构（提取用户历史提示词、模型、推理档位、单轮上下文占用及 Token 用量明细），修复初始占位标题 `OpenCode 会话` 生成真实标题（如 `问候`）后不自动重命名的问题；项目下各 CLI（模型）分组按其最新会话时间动态降序置顶；移除外观设置中「基础主题」的「随系统」选项。
- 升级会话管理按项目分组筛选、侧栏默认 2 条与 `+3` 步进及项目右键「查找历史会话…」弹窗：设置中的「会话管理」支持按项目、CLI 级联筛选与关键词搜索，按所属项目（带 `PS7` / `WSL` 环境标识）分组折叠展示，每行展示 CLI 图标、会话标题、CLI 微标与移除时间并支持单条或按组全部恢复（兼容旧移除记录的 CLI 解析）；侧栏每个 CLI 分组默认展示最新 `2` 条会话，每次点击「更多会话…」增加 `3` 条；项目右键与 CLI 分组右键新增「查找历史会话…」，支持内存缓存 0ms 秒开展示、后台增量刷新、文件级元数据缓存（Codex / Pi / Claude / Antigravity 避免跨 WSL 重复读取）及 `ChangeDetectorRef.detectChanges()` 显式视图更新（实测 WSL `KnowVideo` 项目 99 条历史会话扫描耗时 ~1s 且弹窗可随时关闭）。
- 修复「会话管理」与「查找历史会话…」界面卡死并完成全插件性能优化与独立中英文切换：将 `WorkbenchOverlay` 与 `SessionPanelComponent` 中所有 `*ngFor` 绑定的未缓存 getter 替换为事件/版本驱动的缓存属性并补全 `trackBy`、空图标 `*ngIf` 防护与预格式化时间文本，搜索扫描改为弹窗首帧渲染后异步调度并增加 15s 超时保护；「会话管理」项目组改为多组默认折叠（仅单组或关键词/项目/CLI 筛选时自动展开，支持手动切换），每条已移除会话改用单行紧凑排版展示（图标 + 标题 + CLI 标签 + 时间 + 恢复按钮）；设置中的「快捷键」支持点击按钮直接录制、冲突检测、单条清除与一键「恢复推荐快捷键」，并预置 `Ctrl-Alt-Shift-H/U/O/B` 冷门默认键位（同步读写 Tabby `config.store.hotkeys`）；补齐 GitHub Copilot CLI (`copilot`) 适配（接入 `COPILOT_HOME` / `~/.copilot/session-state/` 历史会话读取与 `--resume` 恢复、`events.jsonl` 提示词/模型/`assistant.usage` & `session.shutdown` Token 用量/`session.usage_info` 上下文占用/`session.error` 报错、状态栏指标与 `copilotActivity` 终端实时状态识别）；在 `WorkspaceService` 增加启动任务裁剪（每项目保留最近 12 条历史任务）、仅轮询运行中任务、`onWriteParsed` 100ms 节流、跳过已绑定会话重复探测与 `treeVersion` 分支/树缓存失效，在 `ProjectsComponent` 实现基于 `treeVersion` 与语言版本的项目树缓存；新增独立于 Tabby 主程序的「简体中文 / English」语言服务（`WorkbenchI18n`，持久化于 `localStorage`）与设置入口，通过 `tsc --noEmit`、完整构建及 Node 单元测试验证。

## 待办

- 在实际登录的账号下验收在线额度手动刷新和长期运行。
- 使用实际登录的 OpenCode、Claude Code 和 Kimi Code 核验历史恢复与运行时数据。Claude Code 和 Kimi Code 当前的活动标签使用进程状态。新版 Kimi 日志缺少可验证的上下文和额度字段。
- 扩展真实 SSH 回归、Tabby 版本兼容及其他标签布局检查。
