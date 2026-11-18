# TabbyOneAi

面向 Windows 桌面 Tabby 的 AI CLI 工作台插件。按目录组织 AI 任务，通过 Tabby 原生终端运行并切换任务。

- 界面与交互见 [设计方案](DESIGN.md) 和 [浏览器原型](prototype.html)。
- 开发范围见 [实施方案](IMPLEMENTATION.md)，已验证的能力见 [路线图](ROADMAP.md)。

## 试用 v0.1

环境为 Windows、PowerShell 7、Node.js 和官方 Tabby `v1.0.238`。WSL 项目需要已经安装的发行版，AI CLI 在各自运行环境内独立安装。

```powershell
npm.cmd ci
npm.cmd run build
.\scripts\Preview-Tabby.ps1
```

预览脚本会使用正在运行的 Tabby 安装，也可通过 `-TabbyPath` 指定 `Tabby.exe`。预览窗口每次使用独立配置，路径会输出到终端。打开后点「添加项目」，选择 PowerShell 7 或 WSL，然后点项目旁的「+」选择已检测到的 CLI。自定义命令参数输入 JSON 字符串数组，例如 `["--version"]`。

## 本地插件包

构建后执行 `npm.cmd pack` 可生成 `tabby-oneai-0.1.0.tgz`。在 Tabby 的 Settings → Plugins → Open Plugins Directory 下建立 `node_modules/tabby-oneai`，将包内 `package.json` 和 `dist/` 解压到该目录，重开 Tabby 即可加载。首次试用推荐预览脚本。Tabby 的 [插件加载规则](https://github.com/Eugeny/tabby/blob/v1.0.238/HACKING.md#plugins) 说明了插件目录和包关键字。

项目与任务元数据保存在当前 Tabby 配置的本地存储。使用 Tabby 的原生标签恢复时，插件会尝试关联带有任务 ID 的终端。本期以单窗口、本机 Windows 和顶部标签布局为验收范围。CLI 用量、额度、历史会话恢复与账号配置进入 `v0.2`。
