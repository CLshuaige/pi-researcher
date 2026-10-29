# 架构与交接

完整的事件流程、工具范围、模块与子会话关系、后台唤醒、状态文件及排障入口见 [框架理解与维护指南](framework-guide.md)。本文保留架构和交接协议的简要说明。

项目级闭环保留三个职责边界：Controller 处理事件与生命周期，ChecklistStore/操作函数管理状态与持久化，Runner 执行子任务和托管进程，Controller 合并进程事件与一次性定时唤醒。modules.ts 仅映射 Skill 资源，不引入额外管理器。详见 [闭环协议](closed-loop.md)。下述子任务执行机制继续保留。

七个 Skill 定义方法，Research Extension 定义执行边界，独立会话承载一次具体子任务。主会话保留整体目标和采纳决定；子会话不接收父会话完整历史。

## 执行协议

`research_delegate` 输入：

```json
{
  "moduleId": "literature",
  "objective": "寻找现有假设的反例并核对其适用范围",
  "skills": ["research-literature"],
  "inputs": ["research/hypotheses/H003.md"],
  "doneWhen": ["给出来源与原文位置", "列出证据冲突与覆盖缺口"]
}
```

BRIEF.md、STATE.md 自动加入输入列表，其余输入必须是工作区内已有文件。只传文件路径，Agent 按需读取。扩展给每次执行分配唯一输出目录。

子任务通过 `research_finish` 提交 `status, summary, artifacts, evidence, openQuestions, nextActions`。成果文件必须存在于当前分配目录。该工具仅在子会话提供，不污染主会话工具列表。默认只回传交接及路径，原始过程保存在 Pi JSONL 会话。

交接中的 `completed` 是任务的自评完成；运行器验证结构与文件位置，不能机械证明科学有效性。报告结论仍应逐级关联文献原文或实验运行。评审在关键决策点使用，避免每个小步骤都增加第二次模型调用。

## 状态和一致性

- BRIEF.md 是目标与约束；STATE.md 是主会话维护的当前认识。
- 子会话写自己的目录，共享状态由主会话整合。Write/Edit 工具会检查写入范围；Bash、扩展工具依赖工作约定，不是沙箱。
- 每次委派记录开始时 BRIEF.md 的 SHA-256；运行期间文件变化会标记 staleBrief，并将原 completed 结果降为 partial。通过清单协议改变全局目标须先结束或取消活动任务，再重开模块验收。
- task.json 保存最新状态；每次 attempt 有独立记录与 handoff.md。锁保护同一任务被并发续接。
- Pi 会话与研究成果分开保存。恢复同一会话不回滚文件；不能用 `/tree` 当作实验代码回滚。
- 模型、工具配置和 Skills 改变时使用新任务，让新旧成果通过文件关联。
- 费用和 token 使用量从会话记录取得，并作为工具使用量回传；engine 的嵌套调用只聚合一次。

## 生命周期

前台委派创建 SDK AgentSession，装配显式资源，绑定扩展，执行 prompt，等待真正完成，然后释放会话。取消信号向下传播；shutdown 等待活动调用清理，记录失败/取消状态。原始 SDK 会话仍留在磁盘。

普通子任务不加载通用 subagent 扩展，也不允许继续委派。experiment 子会话可以调用 engine；engine 内部沿用专门的分析/计划/执行/评审/总结调用，每次使用独立 SDK 会话，受同一取消信号和外层时间限制。它是明确的实验工具内部行为，不是自由递归的 Agent 团队。

主会话只在已初始化的研究项目中获得简短调配说明。无需修改 Pi 默认系统提示文件，不自动覆盖用户 AGENTS.md。

## 实现入口

| 文件 | 职责 |
|---|---|
| extensions/researcher/index.ts | TUI 命令、主会话工具、研究指导 |
| controller.ts | 请求检查点、Skill 名称 widget、统一输入接收、结束边界与清理 |
| checklist.ts / checklist-tool.ts | 清单持久化、状态投影与受控操作 |
| runner.ts | 托管进程、进程组取消、任务隔离、交接、续接、取消、目标版本检查 |
| process-worker.mjs | Linux 进程执行、日志、实际退出记录、宿主失联清理 |
| sdk.ts | 受控资源加载、主模型连接转发、SDK 生命周期 |
| store.ts | 配置、路径校验、任务记录与锁 |
| usage.ts | 原生使用量聚合 |
| extensions/engine/index.ts | 适配原有实验 engine |
| skills/ | 七类研究方法 |

## 设计依据

[Pi Skills](https://pi.dev/docs/latest/skills)、[Extensions](https://pi.dev/docs/latest/extensions)、[SDK](https://pi.dev/docs/latest/sdk)、[Packages](https://pi.dev/docs/latest/packages) 提供原生机制。

[官方子代理示例](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/subagent) 与 [pi-subagents](https://github.com/nicobailon/pi-subagents) 提供上下文隔离和任务展示参考；本实现没有依赖其完整编排协议。

[pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) 提供领域 Skill / 通用实验设施分离和文件化恢复的实践参考。第一版并未引入它的自动保留/回滚策略，因为科研负结果同样值得保留。
