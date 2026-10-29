# Pi 调用与上下文交接

本流程复用用户已配置的 `pi-subagents`，通过普通模型工具调用执行。以下按已安装的 0.84.0 接口编写；其他版本以实际 schema 与 `guide` 为准，无需修改扩展或全局 agent 配置。

## 确认能力

用户或项目指令授权本流程后，若只看到 `subagents_enable`，先调用 `subagents_enable({})`，下一次模型请求再调用 `subagent`。激活工具本身不启动角色。

按需查看已有代理：

```json
{"action":"list","options":{"capabilities":true}}
```

接口帮助使用 `subagent({ action: "guide", options: { topic: "tool-reference/execution-parameters" } })`，配置异常可用 `subagent({ action: "doctor" })`。

三个逻辑角色均可由内置 `delegate` 承载：默认继承父模型，通过 task 接收不同角色提示。不需要存在名为 MethodPlannerAgent、MethodCriticAgent、MethodFormatterAgent 的 Pi agent。若项目覆盖了 delegate，检查实际能力后选择能够读材料和返回角色结果的现有代理。

## 一次调用示例

以下是传给 `subagent` 的参数。将项目、技能和运行目录替换为真实绝对路径，调用前由主会话建好本次成果目录。

```json
{
  "agent": "delegate",
  "cwd": "/absolute/project",
  "task": "你是本次方法设计的 Planner，只完成第 1 轮规划，不启动子代理。读取 /absolute/skill/research-method/references/roles.md 的共同输入与 Planner 部分并执行。初始材料在 /absolute/project/research/methods/run-name/context.md；这是第一轮，无历史讨论。返回完整实验设计，包括基线、对照、测量、步骤、依赖、Engineer/RA 分工、预期产物及资源。仅设计，不实现或运行实验；只将完整角色结果写到指定 output 文件，不修改共享状态或其他文件。",
  "output": "/absolute/project/research/methods/run-name/round-01-planner.md",
  "options": {"context":"fresh"}
}
```

`output` 才是文件输出绑定，不能只在 task 中提文件名。子代理写指定输出或返回完整正文后，由运行时保存；完成后读取工具返回的实际文件位置，发生路径映射时更新交接列表。

默认异步调用返回的是启动回执，等原生完成通知后再读取结果和启动下一角色。期间可以准备后续任务，不提前批评未完成的规划。普通子代理不循环轮询或调用 `bg_wait`；只有确需阻塞时才设置 `async: false`。

## 材料与调用顺序

Pi 子会话不会自动广播组聊消息。每次使用新的 delegate 会话，并显式传递初始材料和讨论文件，即可提供原流程的共同讨论上下文。

| 调用 | 必须提供的材料 | 指定输出 |
| --- | --- | --- |
| 第 1 轮 Planner | context、Planner 提示 | round-01-planner.md |
| 第 1 轮 Critic | context、本轮规划、Critic 提示 | round-01-critic.md |
| 第 N 轮 Planner | context、第 1 至 N−1 轮全部规划与批评、Planner 提示 | round-NN-planner.md |
| 第 N 轮 Critic | context、此前全部讨论、本轮规划、Critic 提示 | round-NN-critic.md |
| Formatter | context、全部规划与批评、实际轮数、Formatter 提示、输出约定 | formatter.json |

每次 task 列出实际文件路径，不只给目录。主会话读 Critic 正文后执行 SKILL.md 中的文本路由，循环后单独调用 Formatter。不使用旧版顶层 `chain`、`parallel` 或 `tasks` 参数，也无需工作流脚本。

三个角色均沿用父模型，无需传 `model`。内置 delegate 不自动继承所有环境扩展工具；本流程只要求读取给定材料与返回设计，不需要搜索工具、engine 或执行代理。角色不自行续接旧运行；重跑使用新的成果目录，历史只在显式提供后作为材料参与。

## 与研究工作区配合

`research_workspace` 可按需查询工作区状态或能力，不是设计的强制前置阶段。`research_delegate` 属于另一套有界研究子任务接口，其输入、输出目录和 `research_finish` 与 `subagent` 不同，不混用上述参数，也不需要为本流程修改 research.json。

若未提供 subagent 工具，说明无法运行三子会话流程；用户允许直接推演时，可以沿用相同角色顺序，但应说明是单会话设计。启动失败或缺少完整结果时，保存已有规划与批评并报告实际失败，不把启动成功当作方法生成完成。

接口参考：[pi-subagents 工具参考](https://github.com/nicobailon/pi-subagents/blob/main/docs/tool-reference.md)、[Pi 技能说明](https://pi.dev/docs/latest/skills)。
