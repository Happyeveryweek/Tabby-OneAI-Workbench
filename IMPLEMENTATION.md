# TabbyOneAi 实施方案

保留官方 Tabby 作为终端宿主。插件使用 TypeScript 与宿主的 Angular 运行时。界面以 `DESIGN.md` 和 `prototype.html` 为验收基准。先用本机安装的官方 Tabby 验证，再以本地安装包交付。

## 阶段 0 与 v0.1

1. 初始化 Git 与文档。读取安装的 Tabby 版本，按其 API 构建插件，通过独立配置目录加载并记录宿主版本。
2. 实现左侧项目树与标签下方的任务状态栏。将两处 DOM 挂载和必要的宿主样式集中在布局适配器。工具栏可以打开同一工作台面板，作为布局变动时的入口。
3. 保存项目目录和运行环境。Windows 任务在 PowerShell 7 环境选择可执行的 CLI，WSL 任务指定发行版和 Linux 路径，在发行版内检测命令。项目可以通过配置的命令启动自定义 CLI。
4. 通过 `ProfilesService.openNewTabForProfile()` 打开原生终端。插件任务 ID 对应实际终端分屏，切换时选中父标签并聚焦分屏。监听进程退出、终端移除、分屏焦点和后台输出事件。启动失败保留可重试的状态。
5. 状态栏显示任务名、运行环境和运行、退出或失败状态。状态色在插件组件内部应用。后台产生新输出时追加「待查看」，聚焦后清除。会话恢复、账号、Tokens 和额度进入 v0.2。
6. 构建并验证本地安装包。验收包含双任务并行、Windows 与 WSL 路径、双向聚焦、分屏、单任务退出、侧栏开关、原生标签可用和项目重启后仍可查看。

## v0.2 与后续

先为 Codex 接入 Windows 与各 WSL 发行版独立的账号目录、历史恢复、摘要、账号额度、会话 Tokens 和推理档位。恢复使用明确的会话 ID，新任务只有确认归属才显示会话级数据。按实际可验证的数据源扩展 Claude Code、Kimi Code、Pi、Antigravity 等能力。

若复用 OneAI 源代码，保留对应 MIT 版权及许可。在 Codex 适配完成前，优先验证本地日志解析与账号隔离。

## 上游依据

- [Tabby 插件加载与入口](https://github.com/Eugeny/tabby/blob/v1.0.238/HACKING.md#plugins)
- [Tabby Profile 启动接口](https://github.com/Eugeny/tabby/blob/v1.0.238/tabby-core/src/services/profiles.service.ts)
- [Tabby 分屏焦点](https://github.com/Eugeny/tabby/blob/v1.0.238/tabby-core/src/components/splitTab.component.ts)
