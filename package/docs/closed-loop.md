# Researcher 闭环控制

在研究项目目录启动 Pi，执行 `/researcher <目标>` 激活当前会话。仅安装扩展或存在 checklist.json 不会自动运行研究。`/research` 是兼容入口；`init <目标>` 只建立 BRIEF/STATE。

控制器在 before_agent_start 注入研究管理者角色，在每次主推理的 context 钩子读取 checklist，在 agent_before_settle 审计并请求续跑。agent_end 不用于重启。Escape、模型错误、shutdown、pause/stop 都不会触发自动复活。重新启动 Pi 后需显式 resume。

## 命令

- `/researcher <指令>`：开始或追加要求；已有预算不会因追加指令重置。
- `/researcher -- <文本>`：输入与保留命令同名的要求。
- `/researcher resume`：暂停后激活并获得新一轮预算；运行中调用不重置预算。
- `/researcher pause`、`stop`：取消活动子任务和托管进程、清除定时器并保留记录。
- `/researcher status`、`capabilities`、`inspect <任务ID>`：只读查看。
- `/researcher stop <任务ID>`：兼容原有单任务取消。

每轮默认 30 分钟，最多 20 次自动续跑，连续三次无实质进展暂停。模块状态、证据引用、任务终态和目标版本参与进展判断，文字说明和审计长度不参与。全部剩余模块阻塞时暂停。预算耗尽不代表研究完成。Escape/pause 后，同一研究会话收到新的普通用户指令会恢复闭环；没有新输入不会自动唤醒。stop、完成、退出/reload 后须显式 resume。

普通输入和命令输入共用同一个接收函数；只有命令入口额外调用 `sendUserMessage`。普通输入顺序如下：

```text
用户输入 → 等待取消清理完成 → 判断当前会话是否允许恢复
→ 记录并持久化待处理指令 → pi 原生提交消息
→ 请求前注入最新检查点和 Skill → 模型处理指令并 resolve
→ 结束边界决定完成、暂停、等待或继续
```

恢复失败时保留输入并明确报告原因，阻止该指令进入无闭环控制的普通推理。运行中插入指令不重置预算；未处理指令阻止整体完成。改变目标必须通过 resolve 增加目标版本，保留旧证据并重新打开模块。

## 清单接口

完整 JSON 示例和纠错流程见 [Checklist 工具规范](checklist-protocol.md)。工具支持 `action: "help"`。所有更新遵循模块数组顺序；请求中明确标出 currentModule 并加载其完整 Skill 指令。

主会话注册 research_checklist、research_delegate 和 research_job 三个模型工具；research_workspace 已移除。状态、能力和任务详情保留命令入口；不能通过 write/edit 直接改 checklist.json 或 .research 运行记录。

- `read`：读取最新清单和 revision。
- `init`：提供 objective，建立空清单；下一步必须 plan。
- `plan`：提供 expectedRevision、reason、modules；每项只需 id/objective/skills/criteria，已有 ID 必须保留。相同定义保留进度，改变定义或顺序会重新打开受影响模块及后续模块。
- `start`：提供 expectedRevision、reason、moduleId，启动当前模块。
- `update`：提供 expectedRevision、reason、moduleId 及要改的 status/evidence/acceptance；省略字段保留。设计变化使用 plan。
- `accept`：提供 expectedRevision、reason、moduleId，可补充 evidence/acceptance，自动设置 completed。必须先 start，证据存在、验收说明逐条对应，且无活动子任务或托管进程。
- `resolve`：提供 expectedRevision、reason、instructionId，记录如何处理插入指令；必要时同时提供新 objective。
- `repair`：保留异常文件并恢复最后提交快照；之后通过受控操作重新修订。没有任何快照的外来清单需人工备份移走，不能自动覆盖。

模块字段为 id、objective、dependencies、skills、criteria、status、evidence、acceptance、reason。运行时添加 taskIds 和 acceptedRevision。状态包括 pending、running、awaiting_acceptance、completed、blocked、skipped。变更 objective 增加目标版本并重新打开完成/跳过模块。改变验收要求后需要重新验收。

代码强制的是状态转换、顺序、委派 Skill 匹配及工具入口约束。未启动当前模块时允许读取和清单管理，阻止研究执行工具；blocked 必须解决或显式跳过。通用 Bash、文件写入的科研语义仍依赖模型与验收，不能机械证明模型遵守了 Skill。

模块动态规划，七个 Skill 不构成固定阶段。checklist 是控制状态来源；BRIEF/STATE 是说明和研究综合，不参与完成计算。目标变更后主模型应同步它们。

## 委派与资源

research_delegate 新增必填 moduleId；任务记录保存 researchId、moduleId、objectiveRevision。子任务返回后模块进入 awaiting_acceptance，旧目标结果必须重新核查。模块验收由主模型完成，不自动接受子任务 completed。

委派只能针对当前模块，skills 必须与模块声明一致。子会话没有主闭环控制器，仍使用显式扩展集合和精确工具集合，并加载所选 Skill 的完整指令。modules.ts 集中映射 Skill 资源；experiment 自动加入 engine，但是否执行 engine 仍由模型决定。engine 阶段不运行全局闭环。

默认只约束项目写入：主文件工具写在根目录内；子任务写在 attempt；engine 写在实验目录。Bash 从对应目录运行，TMPDIR 和 XDG_CACHE_HOME 指向该目录内的 .research；此设置是协作约定，命令可以覆盖它，不是系统沙箱。系统依赖允许读取。

fetch_arxiv 当前使用外部全局缓存，研究运行时阻止调用，需适配项目缓存后再启用；PDF 下载要求显式绝对 outputDir。其他第三方工具部署前需核对自己的缓存和下载配置，工具内部副作用不能由路径提示自动约束。

## 托管后台任务与定时唤醒

当前模块 start 后，长下载和训练使用 `research_job`。启动命令在托管 worker 中以前台方式运行，工具立即返回 `J-...`，不要另加 nohup、`&`、daemon 或嵌套 agent。

例如 MOABB 下载（环境依赖需事先安装）：

```json
{"action":"start","moduleId":"M1","command":"python3 -c \"from moabb.datasets import BNCI2014_001; BNCI2014_001().download()\"","timeoutSeconds":1200}
```

默认 cwd 为研究根目录。TMPDIR、XDG_CACHE_HOME 分别固定到根目录内 `.research/tmp`、`.research/cache`；MNE_DATA 默认 `<研究根目录>/mne_data`，自动建目录，也可通过 env 指定另一个根目录内路径。cwd 必须已经存在于根目录内。env 值不写入任务记录。命令本身仍可覆盖环境和路径；这沿用协作约定，不是系统沙箱。

查看与取消：

```json
{"action":"status","jobId":"J-..."}
{"action":"cancel","jobId":"J-..."}
```

status 省略 jobId 返回任务列表；指定 ID 返回状态、退出码、信号和最多 8 KiB 日志尾部。命令入口 `/researcher inspect J-...`、`stop J-...` 也可使用。重复启动同一模块下参数完全相同的活动命令返回原 ID，避免重复下载；进程与子会话共享 maxConcurrent 限制。

没有其他工作时结束当前回复，控制器自动进入 `control.state: waiting`。模块仍为 running，controller lock 保留，主会话不被长工具占用；TUI 每 2 秒刷新运行时长，不调用模型。任务退出会触发一次唤醒，状态可能是 succeeded、failed、cancelled、timed_out 或 interrupted。

需要定时检查时：

```json
{"action":"wait","wakeAfterSeconds":60}
```

该动作安排**一次**检查，时间范围 1–1800 秒；之后结束当前回复。省略 wakeAfterSeconds 则必须存在活动任务，只等待任务事件或用户输入。即使没有本地任务，也可指定时间等待外部条件。定时器不会阻塞工具调用，也不会反复自动安排下一次；需要再次检查时由模型重新设置。

用户输入优先：收到新输入立即退出等待、取消旧定时器并保存指令，保持已有任务继续运行，不重置预算。当前模型回复完成后，若任务还在运行，可再次进入等待。任务退出与计时同时发生时合并为一次唤醒；模型正在处理用户输入时不排入过期自动消息。等待时不增加无进展或续跑计数；每次实际自动唤醒消耗一次续跑额度，整体 30 分钟时限和每任务 timeoutSeconds 同时生效。

活动进程阻止当前模块 accept/skipped、重新 plan 和改变 objective；如需修改目标，先取消或等待活动工作，再 resolve。进程退出 0 只表示 succeeded，仍需核查文件再通过 checklist 验收，不能自动认为下载完整或科研结论正确。

pause、stop、Escape、shutdown/reload 取消整个托管进程组（先 TERM，必要时 KILL），清除定时器。worker 通过 IPC 监测宿主失联，宿主异常退出也会触发清理。进程 PID 与 Linux 启动身份一起保存，失效记录标记 interrupted，不根据陈旧 PID 杀进程。完成事件不会恢复已经暂停或停止的会话。

任务记录位于 `.research/jobs/J-.../job.json`，完整日志为 output.log，实际退出记录为 exit.json；任务启动和当前会话内的终态变化进入清单审计。已有产物保留。重启/reload 后需要显式 resume，取消或中断的进程不会自动重跑；先检查下载缓存和退出记录，再决定是否启动新任务。一次定时等待只在当前活动会话有效，不是跨退出持久运行的计划任务。

## 持久化和恢复

checklist.json 保存当前状态与审计；.research/checklist 保存 revision-N.json、latest.json 及异常文件备份。latest 是恢复提交点，物化 checklist 中断时通过 repair 恢复。初始化前以及恢复失败时的用户指令保存在 .research/inbox.json。审计历史保留在文件中；检查点、清单工具结果和状态命令共用精简状态投影，包含 pendingInstructions，不携带完整审计。Skill 全文只进入隐藏检查点，TUI widget 仅显示成功加载的名称，同名不重复刷新，暂停/完成/shutdown 时清除。

项目 controller.lock 防止同一目录多个运行时同时控制清单；任务锁继续防止重复续接子会话。自动恢复不调用模型。旧任务和文档保留，第一次激活由模型根据它们建立清单，不自动信任历史完成状态。

## 验证

`npm ci --ignore-scripts` 后运行 `npm run check`、`npm run pack:check`。测试含真实 Pi 1.4.0 SDK 的本地确定性 provider，不访问付费模型。闭环完成只是程序协议通过，证据是否足以支持科研结论仍需核查。
