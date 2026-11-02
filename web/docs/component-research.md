# 组件调研与选择

版本以 `web/package-lock.json` 为准。官方文档的 latest 与已安装 Pi 的版本可能不同，SDK 实现以项目实际安装的 **1.4.0 文档与类型**为准。

| 候选                                                                                                                                  | 适用范围                                            | 决策                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui)，MIT                                                                      | 完整聊天 primitives、自定义后端 runtime、编辑与分支 | 适合完整聊天产品；其 [ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/overview) 可接 Pi，但需要把 Pi 原生分支、steering 与工具生命周期再映射一层。此次先直接保留 Pi 为会话权威，不引入第二套聊天 runtime。 |
| [Vercel AI Elements](https://elements.ai-sdk.dev/components/prompt-input)，Apache-2.0                                                  | 会话、输入、工具、附件等参考实现                    | 参考常见输入和工具布局。它偏向 AI SDK UIMessage 协议，本次不替换 Pi 后端，也不为外观额外引入整套样式系统。                                                                                                                        |
| [Pi web-ui 的社区延续版本](https://github.com/gallen/pi-web-ui)，MIT                                                                   | Pi Agent Web Components、工具与附件 UI              | 调研时作者说明原包已离开 Pi 主仓库，采用 mini-lit / Tailwind，侧重浏览器 Agent 与 IndexedDB。当前需求使用 Coding Agent SDK 和服务器工作目录；整包复用仍需较多改造，因此不选。                                                     |
| [React Flow](https://reactflow.dev/learn/concepts/built-in-components)，MIT                                                            | 节点、连线、平移、缩放、自定义画布                  | **采用 `@xyflow/react`**；自定义节点只负责研究状态外观，复用成熟画布交互，保留来源标识。                                                                                                                                  |
| [Streamdown](https://github.com/vercel/streamdown)，Apache-2.0                                                                         | 流式 Markdown、未闭合语法、逐字淡入                 | **采用**；使用其 [animated](https://streamdown.ai/docs/animation) 参数，直接接 SDK 文本增量。静态产物预览复用同一组件。                                                                                                      |
| [use-stick-to-bottom](https://github.com/stackblitz-labs/use-stick-to-bottom)，MIT                                                     | 长会话底部跟随与手动滚动脱离                        | **采用**；结合 flex 底部对齐，满足首条消息贴底、回答增长后上移。                                                                                                                                                            |
| [Lucide](https://lucide.dev/guide/packages/lucide-react)，ISC                                                                          | 通用界面图标                                        | **采用**；品牌占位图为本项目的小型烧瓶 SVG，后续可统一替换。                                                                                                                                                                |
| [Express](https://expressjs.com/)，MIT；[Multer](https://github.com/expressjs/multer)，MIT；[Archiver](https://www.archiverjs.com/)，MIT | 本地 HTTP、multipart 上传、ZIP 流                   | **采用**；只补网页需要的通用接入层，不实现同事负责的科研编排。                                                                                                                                                              |

会话交互参考常见 Agent 产品的流式与工具展开模式。技术协议查阅 [Claude Code CLI 参考](https://docs.anthropic.com/en/docs/claude-code/cli-usage) 及 [Pi SDK](https://pi.dev/docs/latest/sdk)；实现没有复刻其他产品的私有 UI 或后端协议。

## 为什么使用 SDK

当前服务本身使用 Node.js / TypeScript。SDK 可在进程内创建和恢复 `AgentSession`、订阅工具和文本事件，并调用 `steer()`、`abort()`；不需要改语言，也不需要再起 RPC 服务。浏览器通过 HTTP + SSE 与这个薄适配层通信，浏览器不会持有模型密钥。

`session.bindExtensions({ mode: 'rpc', uiContext })` 中的 `rpc` 是 Pi 1.4.0 的**扩展 UI 兼容模式**：使 `pi-ask-user` 回退到 select/input 对话框。模型和会话仍直接通过 SDK 运行，没有启动 JSONL RPC 子进程。

## 界面组织

界面组件与样式按职责划分，品牌资产保存在 `src/assets/brand/`。设计原则和维护约定见 [设计说明](design.md)。模型与会话仍由 Pi SDK 管理，UI 组件不持有凭据。

## 文本选区与引用追问

选区浮层采用 [Floating UI 的 virtual elements](https://floating-ui.com/docs/virtual-elements)，将浏览器原生 Selection / Range 作为定位参照，并使用 [inline](https://floating-ui.com/docs/inline)、flip、shift 和 hide 处理跨行、边界与滚动裁剪。只引入定位包 `@floating-ui/react-dom`，不替换已有的 Pi 会话运行时。

引用交互参考 [assistant-ui 的 Quote 结构](https://www.assistant-ui.com/docs/primitives/composer)：引用预览、移除引用、独立问题输入。应用保存 `{ messageId, text }`，发送前在服务端组合为引用上下文和本次请求；界面中的问题原文保持独立。

复制使用 [copy-to-clipboard](https://github.com/sudodoki/copy-to-clipboard)，兼容 Clipboard API 及非 HTTPS 环境的浏览器回退。此处采用公开的通用浏览器实现方式，不推断 ChatGPT 的内部实现。
