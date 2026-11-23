# 安装与环境配置手册

**[简体中文](INSTALL.md) | [English](INSTALL.en.md)** · [返回首页](../README.md) · [使用手册与常见问题](USAGE.md)

---

## 1. 环境要求

- **操作系统**：Windows 10 / 11（64-bit）
- **宿主终端**：官方 [Tabby](https://tabby.sh/) `v1.0.238+`
- **运行环境**：Windows PowerShell 7（`pwsh.exe`），以及可选的 WSL 2 发行版（如 `Ubuntu-24.04`）
- **可选依赖**：仅当你使用 **Antigravity (`agy`)** 或 **Claude Code (`claude`)** 的实时状态栏桥接，或从源码自行构建插件时，对应环境需要安装 `Node.js 18+`

---

## 2. 安装方式

### 方式一：PowerShell 一键下载安装（推荐，免编译）

打开 PowerShell，直接复制执行以下命令，自动从 GitHub Releases 下载最新预构建包并解压到 Tabby 插件目录：

```powershell
$plugins = "$env:APPDATA\tabby\plugins\node_modules"
$zip = "$env:TEMP\tabby-oneai-v1.0.3.zip"
New-Item -ItemType Directory -Path $plugins -Force | Out-Null
Invoke-WebRequest -Uri "https://github.com/Happyeveryweek/Tabby-OneAI-Workbench/releases/download/v1.0.3/tabby-oneai-v1.0.3.zip" -OutFile $zip
Expand-Archive -LiteralPath $zip -DestinationPath $plugins -Force
Remove-Item -LiteralPath $zip -Force
```

执行完成后**重启 Tabby**，左侧即会出现 **AI 工作台 (`v1.0.3`)** 常驻侧栏。

> 后续升级新版本时，直接将命令里的版本号替换为最新版本重新执行覆盖即可，**不会丢失任何已添加的项目和配置**。

---

### 方式二：图形界面手动下载解压

1. 前往 [**GitHub Releases**](https://github.com/Happyeveryweek/Tabby-OneAI-Workbench/releases/latest) 下载最新版本的 **`tabby-oneai-v1.0.3.zip`**；
2. 按 `Win + R` 打开「运行」，输入 **`%APPDATA%\tabby`** 并回车打开 Tabby 配置根目录，依次进入 `plugins` → `node_modules`：
   - **首次安装 Tabby 插件时，`plugins` 或 `node_modules` 目录可能还不存在**，请先在 `%APPDATA%\tabby` 下手动新建 `plugins` 文件夹，再在 `plugins` 内新建 `node_modules` 文件夹；
3. **压缩包内已自带一层 `tabby-oneai` 文件夹**，请将压缩包里的 `tabby-oneai` 文件夹直接放入 `node_modules` 目录下：
   - 必须保留 `tabby-oneai` 这一层目录；
   - **不要多套一层**（例如 `node_modules\tabby-oneai-v1.0.3\tabby-oneai` 或 `node_modules\tabby-oneai\tabby-oneai` 会导致 Tabby 无法识别插件）。

解压后的最终目录结构应与下方完全一致：

```text
%APPDATA%\tabby\plugins\node_modules\
└── tabby-oneai\                <-- 必须带这一层 tabby-oneai 文件夹
    ├── package.json
    ├── THIRD_PARTY_NOTICES.md
    ├── README.md
    ├── README.en.md
    └── dist\
        ├── index.js
        └── ...
```

4. **重启 Tabby** 即可生效。

---

## 3. 首次安装必做推荐配置

### 1. 开启「启动时恢复上次打开的标签页」（使用会话自动恢复必开）

如果你希望关闭再重新打开 Tabby 后，之前正在打开的 AI CLI 会话标签页能**自动恢复并重新绑定到工作台状态栏与侧栏**，请在 Tabby 中开启原生标签恢复功能：

- **中文界面路径**：点击 Tabby 右上角 **齿轮图标（设置）** → 左侧选择 **「应用程序」** → 找到并开启 **「启动时恢复上次的标签页」**（或 **「恢复标签页」**）。
- **英文界面路径**：**Settings (齿轮图标)** → **Application** → 开启 **Recover tabs on startup**（或 `config.yaml` 中设置 `recoverTabs: true`）。

### 2. Tabby 的「默认启动终端」需要修改吗？

**不需要，完全不影响。**
无论你在 Tabby 设置里把默认启动终端设成 WSL、PowerShell 7、CMD 还是 Git Bash，它只影响你点顶部 `+` 号新建普通终端时的默认 Shell。AI 工作台里的每个项目都独立绑定了自己的运行环境（Windows 项目固定使用 `pwsh.exe`，WSL 项目固定使用 `wsl.exe --distribution <distro>`），无论是恢复 WSL 会话还是 Windows PowerShell 会话都不会互相干扰。

---

## 4. 卸载插件

1. 完全退出 Tabby；
2. 删除目录 `%APPDATA%\tabby\plugins\node_modules\tabby-oneai`；
3. 重新启动 Tabby 即可恢复原状（卸载插件**不会删除**任何本机或 WSL 中各 AI CLI 的原始会话日志）。

---

## 5. 开发者：从源码构建与独立沙箱调试

需要本机已安装 **Node.js `18+`**：

```powershell
# 1. 安装依赖并编译 TypeScript
npm.cmd ci
npm.cmd run build

# 2. 方式 A：使用独立隔离配置启动预览窗口（不影响个人日常 Tabby 配置）
.\scripts\Preview-Tabby.ps1

# 如需复用上一次预览窗口中的项目与任务记录，关闭预览窗口后传入脚本打印的路径：
.\scripts\Preview-Tabby.ps1 -ProfileDirectory '<上次输出的完整预览配置路径>'

# 3. 方式 B：同步构建产物到本机正式 Tabby 插件目录
$target = "$env:APPDATA\tabby\plugins\node_modules\tabby-oneai"
New-Item -ItemType Directory -Path "$target\dist" -Force | Out-Null
Copy-Item -LiteralPath package.json, THIRD_PARTY_NOTICES.md, README.md, README.en.md -Destination $target -Force
Copy-Item -Path dist\* -Destination "$target\dist" -Recurse -Force
```
