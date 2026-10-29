# Pi 调用与上下文交接

本流程复用用户已配置的 `pi-subagents`，通过普通模型工具调用执行。以下按已安装的 0.84.0 接口编写；其他版本以实际 schema 和 `guide` 为准，无需修改扩展或全局 agent 配置。

## 确认能力

用户或项目指令授权本流程后，若只看到 `subagents_enable`，先调用 `subagents_enable({})`，下一次模型请求再使用 `subagent`。启用工具不等于启动子任务。

按需查看已有代理：

```json
{"action":"list","options":{"capabilities":true}}
```

接口帮助使用 `subagent({ action: "guide", options: { topic: "tool-reference/execution-parameters" } })`，配置异常可用 `subagent({ action: "doctor" })`。

优先用内置 `delegate` 承载三个逻辑角色，沿用父模型，以 task 区分角色。每次使用新的会话，显式提供从项目 Markdown/JSON 整理的 `context.md` 和已有讨论，不依赖父会话历史或自动加载技能。项目覆盖了 delegate 时，先检查其实际读取与写入能力。

## 一次调用示例

下面是传给 `subagent` 的参数。将项目、技能和运行目录替换为真实绝对路径，主会话先建立本次成果目录。task 指定完整产物路径，`output: false` 关闭扩展的单文件输出重定向；交接文件由主会话在收到最终回复后保存。

```json
{
  "agent": "delegate",
  "cwd": "/absolute/project",
  "task": "你是本次假说构建的 Proposer，只完成第 1 轮提出，不启动子代理。读取 /absolute/skill/research-hypothesis/references/roles.md 的共同输入及 Proposer 部分并执行。context.md 位于 /absolute/project/research/hypotheses/run-name/context.md，包含主会话从项目 Markdown/JSON 提取的目标和背景；这是第一轮，无历史讨论。将本轮完整候选（包括依据、组成和潜在价值）写入 /absolute/project/research/hypotheses/run-name/round-01-proposer.md。只写该产物，不修改原始材料、共享状态或其他文件，不检索或运行实验。完成后最终回复纯 JSON，按子代理交接约定提供 role、round、status、artifacts、summary、open_questions，其中 artifacts 列出实际产物绝对路径，summary 是本次工作小结；主会话收到后将交接 JSON 保存到 /absolute/project/research/hypotheses/run-name/round-01-proposer.handoff.json。",
  "output": false,
  "options": {
    "context": "fresh",
    "outputMode": "inline"
  }
}
```

子代理通过写入工具将完整产物保存到 task 指定的位置，最终只回复下面约定的交接 JSON，将小结和实际文件地址直接带回主会话。主会话把该 JSON 保存为本次角色对应的 `.handoff.json`；子代理不需要另写交接文件。

保持 `output: false`：当前扩展对指定 output 会附加“忽略其他输出路径”的单文件指令，与“完整产物写入任务指定文件，最终回复交接小结”冲突。关闭该绑定后，任务中的产物路径通过子代理实际写入生效，而非依赖运行时自动保存。不得只回复文件名而不创建完整产物。

## 子代理交接

所有角色完成后最终回复如下形状的纯 JSON，不加 Markdown 围栏或前后解释。这是本技能的交接约定，不是新增 Pi 工具参数或 `research_finish` 调用。示例中的工作内容仅演示小结写法，实际必须按本轮真实工作填写。

```json
{
  "role": "Proposer",
  "round": 1,
  "status": "completed",
  "artifacts": [
    "/absolute/project/research/hypotheses/run-name/round-01-proposer.md"
  ],
  "summary": "围绕任务提出了三个机制不同的候选，分别整理证据位置、预期观察和最小区分实验；数据访问条件仍待确认，已列为可行性缺口。",
  "open_questions": [
    "数据访问方式和可用规模尚未确认"
  ]
}
```

- `role` 与 `round` 指明角色和当前轮次；Formatter 的 round 填实际完成的辩论轮数。
- `status` 为 `completed`、`partial` 或 `blocked`，表示本次角色工作是否完成，不表示科学结论通过验证。
- `artifacts` 列出本次真实写入的完整产物绝对路径，不能只给目录、设想文件或 session 地址。没有生成产物时返回空数组并解释原因。
- `summary` 是简短的工作小结，说明做了什么、得到什么、相对上一轮改了什么；不只写“已完成”，也不复制整份产物。
- `open_questions` 列出未解决问题和受阻原因，没有则为空数组。失败或部分完成时同样返回小结与已生成文件。

主会话等待原生完成通知，从子代理最终输出取得交接 JSON，保存为表中对应的交接文件，阅读小结和 artifacts，再打开完整产物，记录角色、轮次及可用的 run id。工具的状态包装、日志引用不属于该 JSON 字段；不要把整段工具展示文本当成 JSON 直接解析。以真实文件位置为准，发现缺失文件或内容不符时先报告，不把交接自报完成当成科研有效性。

## 材料与调用顺序

| 调用 | 必须提供的材料 | 完整产物 | 交接文件 |
| --- | --- | --- | --- |
| 第 1 轮 Proposer | context、Proposer 提示 | round-01-proposer.md | round-01-proposer.handoff.json |
| 第 1 轮 Critic | context、本轮提案、Critic 提示 | round-01-critic.md | round-01-critic.handoff.json |
| 第 N 轮 Proposer | context、第 1 至 N−1 轮全部提案与批评、Proposer 提示 | round-NN-proposer.md | round-NN-proposer.handoff.json |
| 第 N 轮 Critic | context、此前全部讨论、本轮提案、Critic 提示 | round-NN-critic.md | round-NN-critic.handoff.json |
| Formatter | context、全部提案与批评、实际轮数、Formatter 提示、输出约定 | formatter.json | formatter.handoff.json |

表中的交接文件由主会话保存。每次 task 明确列出完整输入路径、产物路径和交接要求。后续角色读取完整产物，不能只读取工作小结。Critic 的结束标记只写在评审产物中，主会话从该产物执行路由。Formatter 将完整候选 JSON 写入 `formatter.json`，工作小结另行交接，不把两类 JSON 混在一起。

`subagent` 默认异步，启动回执不是角色结果。等待期间可以准备后续任务，但不能提前启动依赖未完成产物的角色。普通子任务不循环轮询或调用 `bg_wait`；只有确需阻塞时才设 `async: false`。不使用旧版顶层 `chain`、`parallel` 或 `tasks` 参数，无需新增工作流脚本。

三个角色不指定 `model`，默认只分析提供的材料。内置 delegate 不自动继承任意检索扩展，需要额外核查时由主会话按用户需要收集材料。重跑使用新目录，旧历史仅在显式提供后作为输入。

## 与研究工作区配合

`research_workspace` 可按需查看已有状态或能力，不是本流程的前置阶段。`research_delegate` 是另一套有界任务接口，输入、输出目录和 `research_finish` 交接不同，不混用本文件参数。无需修改 research.json 或创建固定名称的研究目标与状态文件。

若没有 subagent 工具，说明当前不能运行三子会话流程；用户允许直接推演时可沿用相同角色顺序，但需明确是单会话工作。启动失败时保留已有产物并报告失败，不用启动回执代替工作小结。

接口参考：[pi-subagents 工具参考](https://github.com/nicobailon/pi-subagents/blob/main/docs/tool-reference.md)、[Pi 技能说明](https://pi.dev/docs/latest/skills)。
