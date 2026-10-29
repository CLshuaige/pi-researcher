# 验证范围

验证环境：Pi 1.4.0、Node.js 24.18.0，Linux。开发依赖版本保存在 package-lock.json。

## 0.5.0 后台任务验证

`npm run check` 通过严格类型检查与 31 项回归测试。`npm run test:tui` 通过真实 PTY 验证：定时检查、后台任务运行时插入并处理普通输入、任务结束唤醒、Skill 名称切换和最终审计；没有 Skill 正文或隐藏检查点泄漏。

新增真实进程回归：快速返回、活动请求去重、项目内环境、日志尾部限制、顺序与验收约束、非零退出、超时、进程树取消、宿主失联、陈旧 PID 身份、等待期间预算不重置、一次性定时唤醒和过期唤醒抑制。

真实 Pi SDK 的确定性 provider 覆盖：一次定时检查 → 启动真实后台进程 → 等待期间普通输入并回答 → 进程完成唤醒 → 验收与完成审计。该测试不调用付费模型；此前 k3.1-pro 在线结果属于 0.4.0 的验证，不作为新增功能在线验证的证据。

## 0.4.0 主会话与 Skill 验证（2026-10-29）

本次运行 `npm run check`：严格类型检查及 22 项自动化测试通过。覆盖共享状态投影、Skill 成功/失败与名称 widget、隐藏检查点、旧 module 参数拒绝、真实 SDK 的两个主工具注册集合、顺序与依赖、委派 Skill 匹配、验收、目标版本、预算、暂停/stop/shutdown、等待取消清理，以及恢复失败时保存输入并阻止普通提交。

真实 Pi SDK 使用本地确定性 provider，验证普通输入恢复后加载当前 Skill 全文、按模块顺序执行并完成审计；同时验证子 SDK 的完整 Skill 注入。未调用付费模型。

运行 `npm run test:tui`（Linux/Python 3 PTY）：隔离 agent 目录并关闭网络启动、自动扩展和 Skill 发现，实际加载主扩展及离线 provider。终端显示 `Skills: research-task`，切换到 `Skills: research-report`，没有 Skill 路径、正文或隐藏检查点泄漏，最终清单完成并记录审计。名称去重刷新及暂停/完成/shutdown 清除另由控制器回归测试验证。

本次还执行 `npm run pack:check` 与 `npm pack`，生成 0.4.0 分发包。以下子任务、engine 和检索结果是此前的验证记录，不代表本轮重新访问了外部服务。

## 0.4.0 真实模型在线验证（2026-10-29）

显式运行（会调用付费服务，不包含在 `npm test` 中）：

```bash
node --experimental-strip-types tests/online-validation.ts --run-paid --provider kimi-coding --model k3.1-pro
```

脚本通过 `--provider` 和 `--model` 显式选择当前 Pi 配置的模型与账户，在 `/tmp/research-online-<model>-*` 隔离目录内保存 CSV、清单、模型会话和 `online-validation.json`。验证包含普通输入恢复、真实请求中的完整 Skill、两个模块的顺序执行与验收、完成审计，以及独立子会话评审。总请求上限 28，单请求输出上限 2048 tokens，总时限 5 分钟；配置中零价格不能当作免费或实际账单。

`blsc/Kimi-K3` 的首次尝试未通过：当前 Pi 凭据下第 1 次模型请求返回 HTTP 400，服务称模型不可用；返回 0 tokens。同一凭据的 `/v1/models` 返回空列表，按用户要求停止，没有使用备用环境变量凭据。

随后按用户指定改用 **`kimi-coding/k3.1-pro`**，使用当前 Pi 账户完成在线验证：

- 暂停后普通输入恢复，待处理指令通过 resolve 记录处理结果；两个模块依次 start/accept，最终 control.state 为 completed，末条审计为 `All modules accepted`，控制器锁已释放。
- 每次主模型请求核对当前 Skill 的完整正文；独立子会话的完整 research-review Skill 位于 Pi 的结构化 system sections 中，也经实际请求检查。
- 报告准确写出 A：0.80 / 120 ms、B：0.85 / 150 ms，以 130 ms 硬上限推荐 A，并明确合成观测不证明泛化或统计显著性。
- 子会话真实调用 5 次 read 和 1 次 research_finish，完成独立只读评审，未发现数值、约束或结论错误。

完整主会话使用 13 次模型请求，复用其成果的子会话评审使用 2 次。另有 2 次请求用于前期检查脚本调试：修正检查点 JSON 解码，以及对结构化 system sections 的读取；这两处是测试断言问题，无需修改生产扩展。合计 17 次服务端响应、98,960 tokens；SDK 根据目录价格估算约 **US$0.09722**，不是服务商账单。此次验证使用合成 CSV，没有验证公共检索、GPU 实验或真实科研质量。

本机证据目录：`/tmp/research-online-k3.1-pro-iHPXWA/`。`online-validation-summary.json` 汇总结果，`online-validation.json` 保留已完成主会话及原子会话断言失败记录，`online-review-validation.json` 保留单独重跑后的成功评审与用量。只重跑评审可在命令中添加 `--review-root <已完成主会话目录>`；脚本校验该目录的模型及 completed 状态，不重复付费运行主会话。


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
