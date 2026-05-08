# Format Flow

本地提示词与 Codex Skill 工作流管理器。

## 功能

- 提示词 CRUD、标签搜索、变量识别和收藏。
- 提示词支持从备份恢复、导入已有 Markdown/JSON/TXT、从 GitHub 发现并导入。
- 扫描本机 Codex Skill 目录，只读预览 `SKILL.md`，支持自定义标签和摘要覆盖。
- Skill 支持从备份恢复、从 ZIP 安装、导入已有 Skill、从 GitHub 发现并安装。
- 使用流程图编排提示词、Skill 和人工审查节点。
- 顺序运行流程：每个节点先预览任务文本，人工确认后执行，保存输入、输出和状态。
- 顺序运行支持剪贴板连接和浏览器插件连接。浏览器插件位于 `browser-extension/`，可把任务填入主流 AI 网页输入框。
- MCP 管理页支持手动添加 MCP，以及从 JSON/TOML 配置导入已有 MCP。
- Electron 全局快捷键呼出 / 隐藏窗口，默认 `CommandOrControl+Alt+F`。

## 开发命令

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run test
npm.cmd run build
```

数据保存在 Electron `userData` 目录下的 `format-flow-store.json`，可在应用设置页查看。
