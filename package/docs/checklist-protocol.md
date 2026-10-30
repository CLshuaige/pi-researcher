# Checklist 工具使用规范

`research_checklist` 操作结构化状态，不运行研究方法。Skill 是方法指令文件，不是工具名；运行时把当前模块的完整 Skill 内容注入主会话请求，并把选定 Skill 内容提供给子会话。

## 必须遵守的调用顺序

1. `/researcher <指令>` 激活；调用 `read` 查看当前状态。不存在时调用 `init`。
2. `plan` 建立有序模块列表。只要求每项的 id、objective、skills、criteria，dependencies 可省略。
3. `start` 启动返回的 currentModule。只有当前模块允许执行、委派、提交和验收。
4. 执行当前模块，保存真实证据；使用 `update` 更新证据和状态。
5. 逐条核验 criteria，通过 `accept` 完成当前模块，再启动下一个模块。
6. 插入指令要通过 `resolve` 记录处理结果；改变全局目标时在该动作中提交 objective。

一次只提交一个修改动作，等待结果再提交下一次。每次修改使用最新工具结果或请求检查点中的 revision；**不要把多个修改动作放在同一批调用中共用旧 revision**。

## 参数示例

以下 expectedRevision 数字仅为示例，实际必须替换为最新 revision。

读取规范与当前状态：

```json
{"action":"help"}
```

```json
{"action":"read"}
```

初始化：

```json
{"action":"init","objective":"比较方法 A 和 B 的适用条件"}
```

建立计划，顺序就是执行顺序：

```json
{
  "action":"plan",
  "expectedRevision":1,
  "reason":"先核查证据，再撰写报告",
  "modules":[
    {"id":"M1","objective":"核对比较证据","skills":["research-literature"],"criteria":["关键主张能定位到原文"]},
    {"id":"M2","objective":"撰写有证据的报告","skills":["research-report"],"criteria":["结论与证据一致"],"dependencies":["M1"]}
  ]
}
```

不必提供 status、evidence、acceptance、reason、taskIds 等模块执行字段，运行时填充初值。plan 是完整定义列表，不能省略已有 ID；不适用的模块应在轮到它时显式 skipped 并说明理由。重复提交相同定义保留进度；修改或重排某一模块会重新打开该模块及后续模块。依赖必须出现在该模块前面。

启动当前模块：

```json
{"action":"start","expectedRevision":2,"reason":"开始核查证据","moduleId":"M1"}
```

更新部分字段，只使用 moduleId 和顶层字段：

```json
{"action":"update","expectedRevision":3,"reason":"已保存来源摘录","moduleId":"M1","status":"awaiting_acceptance","evidence":["research/evidence/source.md"]}
```

验收以 action=accept 为准，自动设置 completed；不必提交 status，复制过来的冗余 status 会被忽略，但不会绕过证据、逐条说明或活动任务校验：

```json
{"action":"accept","expectedRevision":4,"reason":"已核对原文","moduleId":"M1","acceptance":["原文第二节明确支持该主张"]}
```

该例沿用上次的 evidence；省略 acceptance 也会沿用已保存值，但必须满足验收条件。reason 是审计说明，不能替代 acceptance。acceptance 按 criteria 的顺序提供，一条标准对应一条非空说明。证据可为工作区内文件路径或 http(s) URL，本地文件必须真实存在。当前模块有活动子任务或托管后台进程时不能完成或跳过。重新 plan 或通过 resolve 改变目标前，也必须先结束或取消活动工作。不能在 accept 时改写 criteria、skills 或 objective 来降低验收标准，定义变更须通过 plan。

阻塞与跳过：

```json
{"action":"update","expectedRevision":5,"reason":"缺少用户指定的数据集","moduleId":"M2","status":"blocked"}
```

blocked 模块不会被自动越过。补齐资源后 start 当前模块；确实不适用则 update 为 skipped 并记录具体理由。

处理插入指令：

```json
{"action":"resolve","expectedRevision":6,"instructionId":"I-5-0","reason":"已将延迟约束纳入研究目标","objective":"在延迟不超过 15ms 的约束下比较 A 和 B"}
```

instructionId 必须来自返回的 pendingInstructions；全局目标变化会重新打开模块，旧证据保留但需要重新核验。若只是澄清，省略 objective。

## 常见错误与恢复

| 错误 | 正确动作 |
|---|---|
| Revision conflict | read 获取新 revision，结合最新状态重新提交；不用 repair |
| Module order violation | 操作 currentModule，先完成或明确跳过前面的模块 |
| Start current module | 使用 start，然后在下一次请求执行工具 |
| Delegation must use current module skills | 委派 skills 必须与当前模块声明完全一致；需要不同能力时先 plan 修订 |
| Acceptance rejected | 按 recovery.acceptanceRequirements 查看原始 criteria、所需条数、实际 evidence/acceptance 和具体缺项；保存真实成果并逐条核验后提交 |
| Invalid arguments / 旧 module 参数 | 删除 module，使用 moduleId 和顶层 status/evidence/acceptance；定义变化使用 plan |
| Use plan to change criteria | 先修订计划，再重新执行/验收，不能验收时降低要求 |
| Checklist modified outside protocol | repair 恢复最后提交快照，然后通过工具重新修订 |

执行错误返回 isError 和 recovery，其中包含 nextAction、currentRevision、currentModuleId。参数在 SDK schema 层被拒绝时，依据工具描述或 help 修正参数。不要原样重复失败调用，也不要直接编辑 checklist.json 绕过工具。

## 中断后的输入

Escape 或 pause 后，同一研究会话的下一条普通用户指令会等待取消清理完成、恢复闭环，并进入待处理指令列表。没有新用户输入时不会自动唤醒。

显式 stop、已完成、退出或 reload 后不因普通输入自动重启；使用 `/researcher resume` 明确激活。扩展自动生成的消息不会恢复暂停的闭环。0.4.0 无需迁移现有清单、任务记录和会话文件，但已拒绝旧 `module` 参数（包括 `module.id` 回退）；统一使用 `moduleId` 和顶层部分更新字段。升级后需 `/reload` 重载模型工具，再显式 `/researcher resume`。


## 状态与 Skill 可见性

检查点、清单工具结果和状态命令共用 `initialized`、`revision`、`currentModule`、`nextAction`、`pendingInstructions` 状态投影。`currentModule` 是数组中第一个未跳过、未按当前目标版本验收完成的模块。尚未初始化时 revision/currentModule 为 null，nextAction 为 init。完整审计和已处理指令保留在文件中，普通返回不重复携带。

Skill 全文仅注入隐藏的请求检查点，不放入清单工具结果。TUI 仅显示实际成功加载的 Skill 名称；读取失败会单独报告 Skill 加载错误，不提示修复清单。没有 Skill 时不显示 widget。

0.5.0 新增 `control.state: waiting` 与可选 `wakeAt`；有托管任务时检查点和工具状态还返回精简 jobs。等待只释放主会话，不完成模块，详见 [后台任务与等待](closed-loop.md#托管后台任务与定时唤醒)。

同一 revision 下，相同参数（忽略 reason 文案与顶层字段顺序）连续失败三次，会在 turn_end 暂停研究；read/help 不清除此计数，成功修改或重新激活会重置。暂停保留后台 J。错误结果包含 repeatedAttempts 和 pauseAfterTurn，避免在同一工具循环中无限重试。
