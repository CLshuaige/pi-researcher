# Researcher 0.6.0：Pi 生命周期控制

研究控制状态、Pi 是否忙碌、项目/任务所有权分别管理。暂停模型不再等于取消托管进程；等待由工具正常交出执行权实现。默认模型工具仍为 checklist、delegate、job 三个。

## 节点与状态

| Pi 节点 | Researcher 行为 |
|---|---|
| 扩展加载 | 注册工具和事件，不自动恢复旧控制状态。 |
| 命令 / input | 共用 receive，等清理、校验恢复、持久化指令；原生 input 不重复提交。新输入撤销等待，保留 J 事件。 |
| before_agent_start | 追加研究提示，开始活跃计时；重复运行不重置预算。 |
| agent_start | 标记 busy，保留运行上下文。 |
| turn_start | 增加主 turn 计数；第 101 个 turn 请求前暂停并 abort。 |
| context | 注入最新清单、Skill 和待投递事件，记住本请求事件 ID，不提前确认。 |
| tool_call | 顺序/路径/运行许可约束；wait 必须是独立、非嵌套工具批次。 |
| wait execute | 检查指令已 resolve，持久化等待 ID、目标版本、任务集合及截止时间，返回 terminate。 |
| turn_end | 正常完成时确认本请求携带的事件；error/abort 保留重投递。 |
| agent_end | 不在此处认定空闲、释放锁或唤醒；Pi 还可能重试或处理排队消息。 |
| agent_before_settle | 集中决定完成、预算暂停、事件/指令处理、waiting、blocked/无进展暂停或继续。 |
| agent_settled | 停止活跃计时、处理 abort、更新状态，清理完成后释放不再需要的锁，尝试唤醒。 |
| J 回调 / 2 秒本地检查 | 写入去重的终态事件并更新 widget，不直接调用模型；暂停仍观察。 |
| 定时器 | 核对运行代次、等待 ID、Pi 空闲和消息队列后，将到期事件合并成一次唤醒。 |
| session_shutdown | 关闭调度、取消 T/J，等清理并释放所有权；不自动恢复。 |

## 等待与输入

调用 wait 前 resolve 待处理指令；resolve 记录如何处理或安排指令，不等于目标已完成。wait 返回 `waitRequested`，只有 settlement 后才是 waiting。混合批次 wait 不登记等待，返回明确错误。

`wait → terminate → turn_end → agent_end → agent_before_settle → agent_settled` 是正常路径。普通工具结果会让 Pi 自然请求下一轮，`turn_end` 的 `continue:false` 不能阻断它。不要用 abort 实现正常等待。

用户输入优先于自动消息。Pi 忙或有排队消息时暂不自动唤醒，下一次请求读取事件。用户输入取消原一次性等待计划；之后仍需定时检查，应重新 wait。进程自然结束、取消、失败和超时都属于可处理终态，不能自动等同验收。

## 暂停与所有权

Escape、pause、模型错误、预算耗尽暂停模型和唤醒，取消前台 T，但保留 J。任务 widget 保留，Skill widget 清除。有活动 J 时 owner 锁保留，防止另一 runtime 接管；J 全部结束、Pi 已 settled 且清理完成后释放。恢复需要重新取得锁，不能改变到另一个目录同时留下旧工作。

整体 stop、退出、reload 取消全部工作。stop J 仅取消指定任务。迟到的 abort 不能把 stop/shutdown 变为可恢复暂停。命令先封闭新执行，再中断 Pi，最后等待幂等清理。

## 持久化与预算

`control.wait` 保存等待 ID、objectiveRevision、jobIds、可选 wakeAt 及 requested/waiting 状态。`.research/events.json` 保存 J/计时事件；J ID + 终态和 wait ID 分别用作去重键。投递确认在正常 turn_end 完成。异常可以重投递，不承诺模型处理严格一次；科学验收仍由 checklist 完成。

旧记录无新增字段可正常读取。显式恢复核对任务终态；旧 timer 不跨 reload 重建。历史目标事件携带目标版本供核对，不修改清单验收状态。

每次激活：最多 100 个主模型 turn、30 分钟累计活跃时间、20 次自动续跑/唤醒。waiting/paused 不消耗活跃时间；重试产生的新主 turn 计数，子会话与独立压缩请求不计该 turn 限额。J 的 timeoutSeconds 始终按墙钟运行。运行中用户输入不重置预算，暂停后恢复开启新预算但不延长 J。

## 诊断

- wait 后几秒又查日志：先查工具是否成功 terminate、有无混合批次或其他扩展强制续跑。
- 没有 waiting 审计且 continuations 为 0：仍在自然工具循环，不是清单自动续跑。
- 暂停后进程仍运行：0.6.0 预期行为；取消用 stop J 或整体 stop。
- 事件只被注入却无 delivered：请求尚未正常结束，或失败/中断，后续可以重投递。
- 无日志增长：仅代表没有新输出；不会为此额外调用模型。

验证入口：`npm run check`、`npm run test:tui`、`npm run pack:check`。均可离线完成，不操作已有研究工作区。
