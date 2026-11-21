# Tabby-OneAI-Workbench 项目规则

东东维护本项目。`DESIGN.md` 和 `prototype.html` 是界面与交互基准，`IMPLEMENTATION.md` 记录实施计划，`ROADMAP.md` 记录实际进度与验证。

- 根目录为独立 Tabby 插件包。实现放在 `src/`，构建结果放在 `dist/`，实机验收记录放在 `docs/`。
- 原生终端、PTY、标签及分屏由官方 Tabby 管理。宿主布局选择器集中在布局适配器，挂载失败时保留工具栏打开工作台的入口。
- 只在独立 Tabby 配置中验证。项目数据按运行环境隔离，密钥、凭据和终端正文禁止写入项目文件与日志。
- 文件删除、用户数据覆盖或重置、密钥或 CI/CD 修改、数据迁移、全局依赖或系统配置变更、发布部署及高风险 Git 操作均须东东确认。
- 提交前验证构建和受影响的工作流。在 Windows `E:\Project\.tmp\Tabby-OneAI-Workbench` 保存一次性验证中间文件。
