# 主流程与命令参考

主会话负责研究目标、资源判断和综合结论。轻量任务直接完成；文献探索、持续实验和独立评审按需委派。七类能力按任务选择。

在 Pi 中使用 `/research <研究目标>` 开始或继续研究。`/research init <目标>` 只初始化文件，不调用模型、不覆盖已有目标和状态。已打开的 TUI 可执行 `/reload` 加载更新。

## 使用方式

| 入口                           | 功能                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| `/research <目标>`           | 开始或继续研究，允许主 Agent 按任务需要委派                    |
| `/research init <目标>`      | 仅初始化，保留已有文件                                         |
| `/research status`           | 展示最近任务和工作区入口                                       |
| `/research capabilities`     | 查看模型、认证配置状态、主会话工具和子任务检索配置；不调用模型 |
| `/research inspect <任务ID>` | 查看交接、证据和成果位置                                       |
| `/research stop <任务ID>`    | 取消本 Pi runtime 中的任务，等待终态后再恢复                   |
| `/research help`             | 简要帮助                                                       |
| `research_workspace`         | 模型可调用的 init/status/inspect，无模型嵌套调用               |
| `research_delegate`          | 模型可调用的有界子任务执行；精确任务 ID 续接                   |

`research_delegate` 前台等待结果，期间显示进度并支持取消；不同工具调用可并行，默认每个 runtime 同一项目最多两个。它不是脱离 TUI 的后台作业服务。主会话退出或 `/reload` 时取消正在运行的子任务，记录保留。

主会话和子会话都使用相同 Skills；子会话只加载选定的能力以及显式配置的扩展，不复制父会话历史。子会话继承主会话选中的模型和实时模型连接，包含主会话已经配置的自定义 provider。

## 七类能力

| Skill                   | 默认用法                                           |
| ----------------------- | -------------------------------------------------- |
| `research-task`       | 主会话解析目标、约束和资源，产出 `research/task.md` |
| `research-literature` | 文献检索与综合，产出 `literature.md` 和论文索引；可选完整综述 |
| `research-hypothesis` | 主会话构建可证伪假设，需要时独立探索替代解释       |
| `research-method`     | 主会话设计方法、基线、指标和预算                   |
| `research-experiment` | 独立可续接会话，读取 `method.md` 真实执行，产出 `result.md` |
| `research-report`     | 主会话组织论点，长篇章节可委派                     |
| `research-review`     | 新会话独立评估，默认只有读取工具和交接工具         |

各 Skill 描述了适用条件和成果要求，不强制固定论文格式、步骤数量或实验类型。

## 研究文件

```text
project/
├── .pi/research.json                  # 可选运行配置
├── research/
│   ├── BRIEF.md                       # 目标、约束、完成条件
│   ├── STATE.md                       # 主会话维护当前认识和决策
│   ├── evidence/T-.../attempt-1/       # 文献子任务成果
│   ├── experiments/T-.../attempt-1/    # 实验子任务成果
│   ├── reviews/T-.../attempt-1/        # 独立评审交接
│   ├── notes/T-.../attempt-1/          # 其他子任务成果
│   ├── hypotheses/                    # 主会话按需整理
│   └── reports/                       # 主会话按需整理
└── .research/
    ├── tasks/T-.../task.json           # 最新运行状态
    ├── tasks/T-.../attempt-1.json      # 每次执行的记录
    └── sessions/                      # Pi 原生 JSONL 会话
```

初始化只创建目标、状态和必要运行目录。任务成果目录由运行器分配，避免并行任务写入同一位置。每次续接创建新的 attempt 目录，保留历史输出；续接的是相同会话。

`handoff.md` 是可阅读的结果摘要；`task.json` 保存状态、会话位置、目标版本摘要和使用量。`completed` 表示子任务提交了交接，不保证科研结论正确；主会话需按实际证据采纳。没有 `research_finish` 的普通结束只记为 `partial`。目标在执行期间变化时，结果也降为 `partial`，需要重新核对。

建议版本管理 `research/` 中的方案、分析和报告，按项目情况忽略 `.research/`、大型数据、模型及缓存。不要把认证信息放进研究文件。

## 实验 engine

包含 `research-experiment` 的子任务会自动加载本包 `extensions/engine/index.ts`，提供 `engine_start`、`engine_status`、`engine_abort`。无须把 engine 加到子任务配置里，也不要重复加载它。

它保留原 engine 的方法分析、计划、执行/评审、总结能力，改用有界 SDK 调用；每个 runtime 有独立状态，取消信号可以贯穿内部调用，实际终态才决定成功或失败。原有实验目录和旧版计划/进度可以恢复。

独立在主 TUI 使用 `/engine` 时，额外加载 `extensions/engine/index.ts`。本包 manifest 默认只加载 researcher，避免与用户已经安装的 `/engine` 重复注册。

详见 [engine 接入与迁移](engine.md)。

