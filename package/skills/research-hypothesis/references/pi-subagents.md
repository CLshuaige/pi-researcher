# Pi 调用与上下文交接

本流程使用 `pi-subagents` 的普通模型工具调用，不需要新增扩展或把角色安装到全局 agent 目录。以下按已安装的 0.84.0 接口编写；其他版本以实际工具 schema 和其 `guide` 为准。

## 确认能力

用户或项目指令授权本流程后，如果仅看到 `subagents_enable`，先调用 `subagents_enable({})`，下一次模型请求再使用 `subagent`。启用工具不等于已经启动子任务。

需要查看可用角色时调用：

```json
{"action":"list","options":{"capabilities":true}}
```

需要查接口时调用 `subagent({ action: "guide", options: { topic: "tool-reference/execution-parameters" } })`。配置异常可用 `subagent({ action: "doctor" })`；不要仅因安装了扩展就假定子会话可以搜索。

优先用内置 `delegate` 承载全部三个角色：它默认继承父模型，且不会自动加载父会话完整历史或技能。通过 task 传入角色提示即可，不需要名为 IdeaProposerAgent 等的 Pi agent。若项目覆盖了 delegate，先检查其实际能力，选择能够读输入和返回角色结果的现有代理。

## 一次调用示例

下面是传给 `subagent` 的参数示例。路径必须替换为本次研究项目、技能安装位置和运行目录的真实绝对路径；task 中应带上对应角色提示正文或精确的参考文件与章节。

```json
{
  "agent": "delegate",
  "cwd": "/absolute/project",
  "task": "你是本次假说构建的 Proposer，只完成第 1 轮提出，不启动子代理。读取 /absolute/skill/research-hypothesis/references/roles.md 的共同输入及 Proposer 部分并执行。初始材料在 /absolute/project/research/hypotheses/run-name/context.md；这是第一轮，无历史讨论。返回 2–3 个完整候选，说明依据、组成和潜在价值。只将完整角色结果写到指定 output 文件，不修改共享状态或其他文件。",
  "output": "/absolute/project/research/hypotheses/run-name/round-01-proposer.md",
  "options": {"context":"fresh"}
}
```

调用前由主会话建好本次成果目录。`output` 才是运行时的文件输出绑定，不能只在 task 中提文件名。子代理可以写指定输出；若只返回完整正文，运行时也可保存。完成后以工具返回的实际输出位置为准，路径被映射时更新交接列表。

`subagent` 默认异步，启动回执不包含最终角色结论。等待原生完成通知后读取完整输出，再执行依赖它的下一步；等待期间可以准备下一角色任务，不能提前启动依赖尚未完成提案的批评。普通子任务不循环轮询或调用 `bg_wait`。只有确需阻塞的调用才使用 `async: false`。

## 三角色的材料传递

三个角色都可以使用新的 `delegate` 子会话，显式传文件恢复原有共享讨论上下文，不依赖它们自动广播消息或保留上次对话。

| 调用 | 必须提供的材料 | 指定输出 |
| --- | --- | --- |
| 第 1 轮 Proposer | context、Proposer 提示 | round-01-proposer.md |
| 第 1 轮 Critic | context、本轮提案、Critic 提示 | round-01-critic.md |
| 第 N 轮 Proposer | context、第 1 至 N−1 轮全部提案与批评、Proposer 提示 | round-NN-proposer.md |
| 第 N 轮 Critic | context、此前全部讨论、本轮提案、Critic 提示 | round-NN-critic.md |
| Formatter | context、全部提案与批评、实际轮数、Formatter 提示、输出约定 | formatter.json |

每次 task 明确列出实际路径，不仅提供成果目录让子代理自行猜测。主会话读取 Critic 正文后按 SKILL.md 的字符串条件决定下一步，循环后再单独调用 Formatter。不使用旧版顶层 `chain`、`parallel` 或 `tasks` 参数，也不需要额外的工作流脚本。

这三个逻辑角色均沿用父模型，不需要指定 `model`，不自动挑选不同模型。它们默认只分析给定材料；内置 delegate 的严格工具白名单不包含环境中的任意检索扩展。需要补查时由主会话使用已有检索能力或另行明确委派，保存资料后补入共同输入。

## 与本项目研究工作区配合

`research_workspace` 可按需查看现有状态或能力；它不是构建假说的前置阶段。`research_delegate` 是本包另一套有界子任务接口，与 `subagent` 的字段、输出目录和 `research_finish` 交接不同，不把上述调用参数原样传给它。本流程优先复用用户已配置的 `pi-subagents`，无需修改 research.json。

若未提供 subagent 工具，说明当前无法运行三子会话流程。用户允许主会话直接推演时，可以沿用相同角色顺序和评分方式，但应说明是单会话推演。启动失败或结果缺失时保留已完成文件并报告实际失败，不把启动回执、半段输出或空文件当成角色完成。

接口参考：[pi-subagents 工具参考](https://github.com/nicobailon/pi-subagents/blob/main/docs/tool-reference.md)、[Pi 技能说明](https://pi.dev/docs/latest/skills)。
