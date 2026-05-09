# Format Flow Browser Bridge

Chrome / Edge 加载方式：

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 打开“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择本目录：`G:\songyu\format-flow\browser-extension`。

使用方式：

1. 打开一个支持的 AI 网页，例如 ChatGPT、Claude、Gemini、DeepSeek、Kimi、Qwen、Perplexity、Poe 或 Grok。
2. 打开 Format Flow 网页审查版或桌面版。
3. 在“顺序运行”里选择“浏览器插件连接”。
4. 点击“发送当前任务”，插件只会把内容填入已经打开的 AI 页面输入框。
5. AI 输出会同步回 Format Flow 的“节点输出”；如果结果不满意，在“人工审查意见”框继续发送修改意见。

插件只把任务填入输入框，不自动点击发送，避免绕过人工审查。

注意：

- 桌面版 Format Flow 会在本机 `127.0.0.1:48174` 启动本地桥接服务，扩展会自动连接这个服务，不需要把 Format Flow 再放到浏览器标签页里。
- 网页审查版仍然需要在已经加载本扩展的 Chrome 或 Edge 中打开 `http://127.0.0.1:5174/`。
- Codex 的 in-app browser 不能加载 Chrome/Edge 扩展，只能用于普通网页审查，不能代表真实扩展连接状态。

连通性测试：

```powershell
npm.cmd run extension:test
```

测试会自动启动一个临时 Chrome 实例，加载 `browser-extension`，打开本地 Format Flow 测试页和模拟 AI 页，验证状态查询、任务注入、输出同步三条链路。
