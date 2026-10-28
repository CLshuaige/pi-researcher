# engine 接入与迁移

本包适配了用户提供的 engine。保留 `method.md → 分析 → 计划 → 执行/评审 → results.md` 的局部实验能力；整个研究项目仍由主会话自主选择工作，不强制进入该流程。

## 调用

在分配的实验输出目录中准备 `method.md`，给出问题、资源、运行范围、评价方式和停止条件。模型调用：

```json
{"projectPath":"research/experiments/T-.../attempt-1","timeoutMs":900000,"maxSteps":12,"maxRetries":2}
```

该参数传给 `engine_start`。`maxRetries` 为每个尚未完成步骤在本次调用中的额外尝试次数；模型请求上限是执行阶段 40、只读阶段 20。总时间由 engine 超时及外层 research 超时共同限制。

engine 是可选工具。对一份已有数据做分析、运行一条已知命令、重画一张图，都可以在实验子会话中直接完成。

## 目录与证据

```text
experiment-root/
├── method.md
└── experiments/
    ├── CONTEXT.md
    ├── plan.json
    ├── progress.json
    ├── results.md
    ├── sessions/                    # 内部 SDK 会话
    ├── runs/<invocation-id>/
    │   └── <sequence>-<phase>/
    │       ├── request.md
    │       ├── response.md
    │       └── run.json
    └── ...                         # 代码、指标和其他实际成果
```

运行器确定性记录阶段、开始/结束时间、模型、会话文件、状态和使用量。实验执行 Agent 根据 method.md 保存命令、代码/数据版本、参数和原始测量；它们还需要评审检查，不能仅凭生成的报告认为已验证。

评审会话只提供读取工具，核对真实文件和日志。需要重新运行验证命令时，将该要求交给下一次执行尝试，不给评审者默认写入能力。

## 恢复

`engine_start` 对相同目录自动读取已有计划和进度，跳过已完成步骤。全部步骤完成但缺少 results.md 时，只补总结。对已完成且报告存在的项目，不再调用模型。

在独立 `/engine` 入口中可用 `/engine resume <path>`；行为相同。路径按当前会话 cwd 解析，允许含空格。

研究任务续接会分配新的 attempt 目录。若需恢复先前的 engine，使用之前的实验目录；运行器允许本任务历史 attempt 中的 engine 目录，但不允许调用其他任务的实验目录。新成果交接可说明原实验报告位置，并在 evidence 中引用；需要作为 artifacts 提交时，把新的汇总写入当前 attempt。

旧版 `experiments/plan.json` 的 `{projectPath, steps}` 与 `progress.json` 的步骤状态兼容。首次恢复将进度记录规范化为 version 2，保留已完成步骤。迁移前建议保存原目录副本。没有旧版 methodDigest 的记录无法证明历史方法未变，应人工核对 method.md 与旧成果。

新版本保存 method.md 摘要。开始运行后修改方法，需要创建新的实验目录；不会静默用新方法覆盖旧实验。计划和进度步骤数量/ID 不一致时停止并要求先整理，避免跳过或重复错误步骤。

## 本次适配

- 更新到 `@earendil-works/pi-coding-agent`。
- 状态从模块级单例改为每个 Extension runtime 独立实例。
- SDK 替代不受控的嵌套 Pi 子进程；使用主会话选定的模型连接。
- 取消传播到当前阶段与 Bash 操作，shutdown 负责清理。
- 超时、请求预算耗尽、模型错误、评审失败均返回非成功状态。
- 有效终态后才返回结果，不用一次 `agent_end` 提前判定整个任务完成。
- 增加目录锁、原子进度写入、每次调用记录和使用量统计。
- 使用 CONTEXT.md 保存分析，保留已有 AGENTS.md，不自动覆盖项目指令。
- 计划不再强制每次重装环境；复用已有可用资源。

独立 `/engine` 默认不随 researcher manifest 在主会话注册，以避免与原有入口冲突；实验子会话会自动加载。当前工作区原入口改为导出本包实现，保持原 `/engine` 使用方式。
