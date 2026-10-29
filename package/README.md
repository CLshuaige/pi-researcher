# Pi Researcher

面向 Pi TUI 的模块化研究 package：一个主会话、七类按需加载的研究 Skills、可持久化和续接的子任务、文件化成果，以及适配后的实验 engine。

主会话负责研究目标、资源判断和综合结论。轻量任务直接完成；文献探索、持续实验和独立评审按需委派。七类能力不是必须依次通过的七个阶段。

## 安装与开始

本版本按 **Pi 1.4.0、Node.js 24** 开发验证，最低 Node.js 22.19；其他 Pi 版本需要重新验证 SDK 合同。宿主提供 Pi 和 TypeBox，发布包不捆绑这些运行时。

```bash
pi install /absolute/path/to/pi-researcher
```

在研究项目目录启动 `pi`，已经打开的 TUI 执行 `/reload`。然后：

```text
/research init 比较已有数据上两种方法的适用条件，给出可核查报告
/research
```

也可以直接 `/research <研究目标>`，初始化后交给主 Agent 继续。`init` 只建立文件，不调用模型，不覆盖现有目标和状态。此后在自然语言中说明目标变化；主 Agent 应更新 `BRIEF.md`。

一次性试用不修改安装设置：

```bash
pi -e /absolute/path/to/pi-researcher
```

检索工具包：

```Shell
pi install npm:pi-web-access@0.45.0
pi install npm:@duskmoon/pi-academic-search@0.1.1
pi install npm:pi-arxivist@0.1.7
pi install npm:pi-subagents
```

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
| `research-task`       | 主会话解析目标、约束、资源和验收条件               |
| `research-literature` | 文献检索、证据提取、反例和覆盖缺口；较大任务可独立 |
| `research-hypothesis` | 主会话构建可证伪假设，需要时独立探索替代解释       |
| `research-method`     | 主会话设计方法、基线、指标和预算                   |
| `research-experiment` | 独立可续接会话，按需直接分析或调用 engine          |
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

详见 [engine 接入与迁移](docs/engine.md)。

## 报告编译环境

`research-report` 默认生成中文 ICML2026 双栏报告，编译成功后交付唯一的报告 PDF：`paper/report.pdf`。Ubuntu / Debian 安装依赖：

```bash
sudo apt-get update
sudo apt-get install -y python3 texlive-xetex texlive-lang-chinese \
  texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended fonts-texgyre poppler-utils
```

中文使用 **Fandol 宋体、黑体、楷体和仿宋**，西文使用 **TeX Gyre** 字体，均由上述包提供，无需另装宋体或微软雅黑。安装后检查命令与字体，`kpsewhich` 应返回文件路径：

```bash
xelatex --version
bibtex --version
kpsewhich ctex.sty
kpsewhich FandolSong-Regular.otf
kpsewhich texgyretermes-regular.otf
```

完成报告写作后执行（`<package-dir>` 替换为本包实际路径）：

```bash
python3 <package-dir>/skills/research-report/scripts/report_generation.py compile --output paper
```

成功状态见 `paper/build-status.json`，错误日志见 `paper/build.log`。依赖需安装在 Pi 实际运行的机器或容器中。

本机已使用无 sudo 的用户级 TeX Live，位于 `~/.local/share/pi-researcher/texlive`，命令入口在已加入 PATH 的 `~/.local/bin`，无需再执行上述安装命令。

## 配置与验证

包的内置默认值不加载外部搜索或任意 MCP 工具；本机已通过全局 `research.json` 接入网页搜索、学术检索和 arXiv 全文三包组合。新机器安装方法见 [检索接入](docs/retrieval.md)，配置继承规则见 [配置说明](docs/configuration.md)。缺少工具或服务不可达时不能声称已完成文献搜索。

在包含测试和开发配置的源码目录中执行（分发压缩包不包含测试）：

```bash
npm ci --ignore-scripts
npm run check
npm run pack:check
```

自动化测试通过真实 Pi SDK 执行工具与持久化会话，模型响应由本地确定性测试 provider 提供，不调用付费模型。它验证运行机制；实际研究质量需要用你们的任务和模型另行评估。

进一步阅读：[架构与交接协议](docs/architecture.md) · [验证说明](docs/validation.md) · [可选增量路线](docs/roadmap.md)。
