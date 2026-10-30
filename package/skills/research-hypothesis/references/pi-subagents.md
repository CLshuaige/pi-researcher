# Pi 调用与上下文交接

使用用户已配置的 pi-subagents。以下按本机 0.84.0 接口编写；以实际 schema 和 guide 为准，不修改全局代理、模型或运行上限。

## 调用模式与并行边界

主会话按依赖关系选择两种互斥模式，不能把它们的顶层参数混在一起：

- **一个角色：** 用 `agent`、`task`，可带 cwd、output、options、async；省略 workflow、args、options.script。适用于统一 Critic、Formatter、单个修订方向。
- **独立批次：** 用 `workflow: "parallel"` 和 `args.tasks`，顶层不传 agent、task、action 或 options.script。tasks 每项只接受 agent、task、cwd 和可选 model；本技能不覆盖 model。角色和方向名写入 task，不发明每项的 output、key 或 options 字段。
- 查询用独立 action 调用，不与启动混用，不使用 action: single 或旧版顶层 chain、parallel、tasks、workflowScript、workflowScriptPath。省略不适用字段，不以 false 或 null 替代 workflow。
- 外层 `output: false` 也应用于工作流子任务，关闭自动单文件重定向。子代理显式写自己的完整产物，最终回传交接 JSON；不能只回文件名而未写文件。
- 主会话预建每个子代理独立的 cwd 与成果目录。原项目根目录通过 task/context 显式传入以读取材料；并行子代理只写自己的目录，不同时修改阶段根目录文件。不要用 worktree 来复制研究项目，也不让子代理继续派生代理。

发生 `Structured single-child execution cannot be combined with workflow.` 时，该次请求在启动前被拒绝。先判断本次需要单角色还是批次，再从相应模板重建参数，保留已有产物，只纠正重试一次。批次应去除顶层 agent/task；单角色应去除全部工作流字段，不是反复修改 workflow 的值。已有 run id 或是否启动不明时先查询实际状态，不重复启动；其他运行失败不套用这一参数修复，不切换 CLI 或模型。

## 准备能力

用户或项目指令授权本流程后，仅看到 subagents_enable 时先调用 `subagents_enable({})`，下一次请求再使用 subagent。按需用下面参数查询代理，优先选内置 delegate，并在 task 给出角色参考与全部材料路径。

```json
{"action":"list","options":{"capabilities":true}}
```

delegate 默认继承父模型但不自动继承技能或聊天历史。用 context: fresh，并给出角色与输出参考的实际路径。并行第一轮不传同批其他方向结果；后续批评和整理必须得到所有当前完整产物，而非仅小结。

## 并行批次示例

下面仅示范两个方向。根据项目给出真正不同的探索任务，并将全部占位路径替换为实际目录；第三方向按相同形式追加。主会话先建立 round-01 中的每个工作目录。

```json
{
  "workflow": "parallel",
  "args": {
    "tasks": [
      {
        "agent": "delegate",
        "cwd": "/absolute/project/hypothese/round-01/H1",
        "task": "你是 Proposer，本次方向标识 H1，第 1 轮。项目根目录为 /absolute/project，材料在 /absolute/project/hypothese/context.md；先读 /absolute/skill/research-hypothesis/references/roles.md 的共同输入和 Proposer。方向任务：探索第一种与任务有关的机制或解释角度，实际执行时以主会话根据项目确定的方向为准，不预设结论。只提出一个完整假说。不读取同批其他方向的产物，不启动子代理。只写 /absolute/project/hypothese/round-01/H1/hypothesis.md，不修改原始材料或共享文件；最后回复纯交接 JSON，包含 role、lane_id=H1、round、status、artifacts、summary、open_questions，列出真实产物绝对路径和具体工作小结。"
      },
      {
        "agent": "delegate",
        "cwd": "/absolute/project/hypothese/round-01/H2",
        "task": "你是 Proposer，本次方向标识 H2，第 1 轮。项目根目录为 /absolute/project，材料在 /absolute/project/hypothese/context.md；先读 /absolute/skill/research-hypothesis/references/roles.md 的共同输入和 Proposer。方向任务：探索与第一方向有实质差异的机制或解释角度，实际执行时以主会话根据项目确定的方向为准，不预设结论。只提出一个完整假说。不读取同批其他方向的产物，不启动子代理。只写 /absolute/project/hypothese/round-01/H2/hypothesis.md，不修改原始材料或共享文件；最后回复纯交接 JSON，包含 role、lane_id=H2、round、status、artifacts、summary、open_questions，列出真实产物绝对路径和具体工作小结。"
      }
    ]
  },
  "cwd": "/absolute/project",
  "async": true,
  "output": false,
  "options": {
    "context": "fresh",
    "outputMode": "inline"
  }
}
```

同一批次只含相互独立的任务。不能把依赖这些结果的 Critic 或 Formatter 加入该 tasks 数组；它们由主会话在收齐结果后另行调用。运行时并发不足可排队或分批，不改变其上限。若实际接口在启动前明确不支持 parallel，可按同一分工使用单角色调用顺序执行，保持独立输入并说明退化；不要在已运行批次后再整批启动一次。

## 单子代理示例

```json
{
  "agent": "delegate",
  "cwd": "/absolute/project/hypothese/round-01/critic",
  "task": "你是 Critic，方向标识 all，第 1 轮。项目根目录为 /absolute/project。读取 /absolute/project/hypothese/context.md 和 /absolute/skill/research-hypothesis/references/roles.md 的共同输入及 Critic。读取已完成的 /absolute/project/hypothese/round-01/H1/hypothesis.md、/absolute/project/hypothese/round-01/H2/hypothesis.md，统一比较并逐项给出意见。只写 /absolute/project/hypothese/round-01/critic/critique.md，评审产物末尾按规则给出结束标记；不启动子代理。最终回复包含 role、lane_id、round、status、artifacts、summary、open_questions 的交接 JSON。",
  "output": false,
  "options": {
    "context": "fresh",
    "outputMode": "inline"
  }
}
```

Formatter 同样单独调用，cwd 使用本次成果目录下的 formatter/，完整 JSON 写该目录的 formatter.json。主会话读取后再生成阶段根目录的最终产物；后续轮次使用新目录。

## 子代理交接

每名子代理先写完整产物，再以纯 JSON 最终回复下面的交接约定；这不是 subagent 的参数，也不是 research_finish 调用。

```json
{
  "role": "Proposer",
  "lane_id": "H1",
  "round": 1,
  "status": "completed",
  "artifacts": [
    "/absolute/project/hypothese/round-01/H1/hypothesis.md"
  ],
  "summary": "说明本方向实际生成的假说或方案、关键依据及待确认条件；修订轮次说明实质变化。",
  "open_questions": []
}
```

role 是职责，lane_id 是方向标识；统一 Critic 使用 all，Formatter 使用 final。round 是本轮批评计数对应的轮次。status 使用 completed、partial、blocked 表示角色任务完成度，不表示科学结论成立。artifacts 是本次真实完整文件的绝对路径，summary 是工作小结，open_questions 是缺口；没有产物时返回空数组并解释。

## 批次读取与恢复

默认异步启动只返回回执。等待原生完成通知，不循环轮询或用 bg_wait。批次结果包含多个 children，每个 child.output 才是该子代理的最终交接；不要把聚合结果当作一个交接 JSON，也不要只读第一个 child。按 lane_id 关联方向，主会话逐项保存交接文件，再打开全部实际产物。工具展示被截断时读取实际运行记录，保留工作流和子任务 ID。

外层成功或失败均需检查每个 child 的运行结果及交接 status。一个失败可能使整批标为失败，成功子任务的真实成果仍保留；只对失败方向处理，不重跑已完成方向。运行中、暂停或缺少终态的任务不能当成不存在后再次派发。缺口会影响阶段结论时明确交付范围，不把少了某方向说成已经全面比较。

| 工作 | 完整产物 | 主会话保存的交接 |
| --- | --- | --- |
| 第 N 轮 Proposer，方向 H1 | round-NN/H1/hypothesis.md | round-NN/H1/handoff.json |
| 第 N 轮统一 Critic | round-NN/critic/critique.md | round-NN/critic/handoff.json |
| Formatter | formatter/formatter.json | formatter/handoff.json |

原生子任务只在指定目录工作；完整评审中的结束标记用于 Critic 产物，不从 summary 路由。三个职责沿用父模型，不自行检索、实现或实验。research_delegate 是另一套接口，不能接收上述参数；已经处于其禁止继续委派的子会话时只完成指定角色，不能运行并行编排。

参考：[pi-subagents 工具参考](https://github.com/nicobailon/pi-subagents/blob/main/docs/tool-reference.md)、[Pi 技能说明](https://pi.dev/docs/latest/skills)。
