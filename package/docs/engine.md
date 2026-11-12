# engine 接入与迁移

本包适配了用户提供的 engine。保留 `method.md → 分析 → 计划 → 执行/评审 → results.md` 的局部实验能力；整个研究项目仍由主会话自主选择工作，不强制进入该流程。

## 调用

在分配的实验输出目录中准备 `method.md`，给出问题、资源、运行范围、评价方式和停止条件。模型调用：

```json
{"projectPath":"research/experiments/T-.../attempt-1","timeoutMs":0,"maxSteps":12,"maxRetries":2}
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


## 已完成研究的咨询与局部修订

`/research` 保持统一入口。只读咨询使用 `resolve` 的 `response` 记录实际答复；未规划科研阶段时，只有指令均有实际答复且已处理，才能作为纯咨询结束，首次科研仍需规划与执行。完成后要求落盘或修改成果，使用 `research_checklist(action: "followup")`，提供真实 `instructionId`、目标原模块 `moduleId`、`kind`、`objective` 和 `criteria`；正式修订还需 `impact`。程序分配 `<阶段>/revisions/<新任务ID>/`，以新模块复用现有 `start`、委派及 `accept`，不重置原模块。

`analysis` 默认不挂载专科 Skill，用于补充评估；`revision` 默认继承目标 Skill。返回的 `currentModule.id` 是后续启动、委派和验收使用的 ID，`followup.outputDir` 覆盖原有默认交付路径，材料仍可从整个项目读取。原已验收证据保存在 `.research/versions/<新任务ID>/baseline/`；验收必须引用新目录中的真实文件，并核对原证据指纹未变。绑定指令在验收时自动关闭，不能先用 prose-only `resolve` 宣称交付；跳过会明确记录取消而不发布。

正式修订验收后，原模块的 `currentVersionId` 指向新模块；模型检查点的 `versions` 提供当前证据入口。下游 `needsReview` 只表示适用性待复核，不自动执行实验或改稿。默认标记传递依赖，显式缩小 `affectedModules` 时需给出影响说明。旧固定路径不会被覆盖或自动切换；Presentation 的版本适配单独处理。`write/edit`、专科子会话和受管作业遵循本次输出范围；Bash 沿用现有协作式目录与缓存约束，不是操作系统沙箱，验收仍核对原证据。这里只快照已登记的验收证据，不复制整个项目、环境或所有未登记文件。

纯咨询的 `response` 用于实际回答，不用于确认收到科研执行指令。局部任务验收/取消或纯咨询结束后，若还有未完成阶段且没有运行中的子任务，管理器保留这些阶段并暂停，而不擅自恢复后续科研；已运行后台任务沿用原有等待/通知机制。


## 网页展板与科研版本

科研修订使用已有模块 ID 标识版本，并以 `versionNumber` 显示 V1、V2 等编号；未带编号的历史记录按同阶段修订顺序兼容读取。Presentation 复用这些编号，不为绘图尝试或节点内栏目建立版本。正式版本与补充分析均归属原阶段节点，切换历史展板只影响查看，不改变科研的有效版本。

网页刷新沿用现有观察入口，但仅在阶段验收、有效修订版本切换或补充分析验收后登记对应展示任务；普通对话、日志、文件写入和 `needsReview` 不触发重新绘图。已有匹配展板直接复用，失败任务不会因刷新无限重试。绘图 Pi 使用原生 `read/edit/write` 修改当前 Workspace 中唯一获授权的 HTML 草稿；发布前核对材料指纹与分支/版本，成功后按科研版本保存到 `.pi/presentation/stages/<阶段>/versions/<版本ID>/index.html`，引用图片保存内容快照。同一科研版本内的绘图更新覆盖原文件，历史版本不跟随变化。绘图不挂载 Research 工作流，也不修改科研材料。

展板首次绘制先保存闭合的样式与布局骨架，再逐块 edit 填入段落和图表。每次成功写入后，宿主校验并清洗完整草稿，在内存保留最新有效预览，通过现有 Presentation SSE 推送预览摘要；前端按摘要读取沙箱文档，保留已显示画面与高度，并显示轻薄蒙版、转圈和当前生成阶段。中间预览不覆盖正式版本，也不创建科研版本；结构无效时保留上一份有效预览并反馈给智能体修复。最终发布后读取正式文档，加载完成再移除蒙版。失败或暂停时丢弃中间预览，恢复上一份正式展板；查看其他历史版本不加生成蒙版。
