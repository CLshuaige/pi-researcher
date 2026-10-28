# 验证范围

验证环境：Pi 1.4.0、Node.js 24.18.0，Linux。开发依赖版本保存在 package-lock.json。

## 0.2.0 检索组合验证（2026-10-28）

- 严格类型检查和 19 项自动化测试通过。新增真实 ModelRuntime → 本地 HTTP 服务测试，分别验证静态 API key 和 OAuth；开启 authHeader 后仍只发送父 runtime 的有效测试认证和自定义 header，不再泄漏 host-managed 占位值。
- 验证全局/项目配置合并、项目空数组关闭继承、第三方工具自动激活后的集合收敛、下载缺省目录与共享目录被阻止。
- 主机 Pi 实际加载三个固定版本扩展、研究 package、原 engine 及现有扩展，`/research capabilities` 无加载错误。
- 实际调用 Exa 网页搜索取得 Meta 的 I-JEPA 页面，fetch_content 提取 arXiv 摘要页；fetch_arxiv 将 1706.03762 源码转成 Markdown，download_pdf 下载有效的约 2.1 MB PDF。
- 学术联合查询返回 Crossref 结果，并明确记录 arXiv 搜索超时。另观察到 arXiv 429；不把某次成功解释为每个数据源始终可用。paper_lookup 按 arXiv ID 查到 Attention Is All You Need。
- 真实 ResearchRunner 文献子会话调用已安装 paper_lookup 并完成交接；真实评审子会话只有指定工具，不含 download_pdf、fetch_arxiv、bash、write、edit。驱动工具调用的是本地确定性 provider，没有发送付费语言模型请求。
- 网络验证确认 Node 原生 fetch 默认未遵循本机代理环境；可选 env-proxy 扩展启用 Node 标准环境代理后请求恢复。

此次是实际公共检索和 SDK 集成验证，不是研究质量评测；没有修改原研究项目的历史任务或证据。

## 已验证

`npm run check` 执行 TypeScript 严格类型检查及 Node 测试。测试使用真实 Pi SDK 和实际文件系统，模型响应由确定性的本地 provider 提供，不调用外部模型 API。

覆盖范围：

- 新建持久化子会话，按确切任务 ID 续接，保留历史成果。
- 每次 attempt 的使用量独立计算；engine 嵌套调用不重复计数。
- 缺少结构化交接为 partial；缺少工具在推理前失败。
- 目标变化标记、模型请求预算、取消信号及任务锁释放。
- 独立评审的实际工具集合不包含 Bash 和递归委派。
- 初始化保留用户文件；路径遍历、工作区外符号链接、无效配置被拒绝。
- engine 通过真实 Bash 工具生成并核对本地指标文件。
- engine 取消停止实际 Bash 操作及其进程树，不留下后续输出或成功报告。
- 旧版 engine 计划/进度恢复、失败评审、已完成步骤避免重复运行。
- research-experiment 真实加载 package 中的 engine 并完成工具调用链。
- Pi 原生 package 发现机制加载七个 Skills、research 命令及工具，没有默认重复注册 engine。
- 所有 Skill frontmatter 通过 skill-creator 的校验器；Skill 引用的资源存在。

另在隔离的真实 Pi TUI 中执行 `/research init TUI smoke test` 和 `/research status`：命令正确注册，研究文件实际生成，状态 widget 正常显示。该测试使用无认证的临时 agent 目录，未发送模型请求。

打包通过 `npm pack --dry-run` 检查分发资源，排除 node_modules、测试运行记录和用户认证文件。发布包包含运行代码、七个 Skills、文档和示例。实际生成的 tgz 已解压到独立临时目录，以宿主 Pi 加载并执行 `/research status`，无扩展加载错误，不依赖源码目录中的 node_modules。现有本机扩展配置的共存加载也已验证。

## 需要实际项目评估的部分

- 你们选择的真实模型对研究任务的理解、证据质量和实验设计能力。
- 外部检索、全文服务、MCP 与各自认证；默认没有配置外部服务。
- 长时间 GPU 作业、第三方工具的取消行为、外部数据与环境的可复现性。
- 不同 Pi 版本的兼容性；目前只对 1.4.0 作出已验证声明。

这些边界不应被本地测试通过掩盖。可按 [增量路线](roadmap.md) 中的实际任务评估选择后续工作。
