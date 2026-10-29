# 输出与执行交接

这是本技能的文件约定，沿用原方法对象的主要字段，不是 Pi 工具协议，也不是 engine 的 plan.json 格式。不需要复用旧框架的 Python 类或 Markdown 正则解析器。

## Formatter 输出

Formatter 把完整 JSON 保存为本次运行目录中的 `formatter.json`，顶层直接是方法对象，不包裹 `ideas` 或候选列表。以下用一个步骤展示字段形状，实际步骤数量由方法决定：

```json
{
  "overview": "说明研究目标、主要假说、实验设计、对照与结果解释。",
  "steps": [
    {
      "step_id": "S1",
      "description": "检查已有数据并按预定规则准备实验输入，记录数据来源、划分方式与泄漏检查；完成要求是生成可读取的数据清单和检查记录。",
      "assignee": "Engineer",
      "dependencies": [],
      "expected_output": "数据清单与检查记录，标明数据范围、样本数量、划分方式及发现的问题。"
    }
  ],
  "execution_order": ["S1"],
  "assignments": {
    "Engineer": ["S1：准备实验输入并记录检查结果"],
    "RA": []
  },
  "resources": {
    "data": "已有数据的位置、访问条件与尚需确认的内容",
    "compute": "计算环境、预计需求与预算",
    "time": "总体时间与各类任务的预计工作量",
    "tools": "已有工具、环境和必要条件"
  },
  "criticisms": ["讨论中的重要批评、已采纳的折中及仍未解决的问题"],
  "debate_rounds": 1
}
```

`overview` 为字符串；`steps` 为步骤列表；每步的 `step_id`、`description`、`assignee`、`expected_output` 为字符串，`dependencies` 为步骤 ID 数组。`execution_order` 为按执行次序排列的步骤 ID；`assignments` 按 Engineer、RA 汇总任务字符串数组；`resources` 为资源描述对象；`criticisms` 为字符串数组；`debate_rounds` 填实际完成的 Critic 轮数。

完成要求放在 `description` 或 `expected_output`，不新增独立 `success_criteria` 字段。具体环境、命令已知时写明，未知时明确指出，不能为了填充方案编造现成命令或资源。实验是否正确执行与假说是否得到支持应分别解释。

## 主会话保存

主会话读取 Formatter 输出，将方法对象保存为 `method.json`，并生成面向执行者的 `method.md`。不评分或排序方法，不额外引入批准状态、方法版本和最终复核。

`method.md` 包含：

- 研究任务、假说来源、方法概述及输入材料路径。
- 实验与假说的对应关系、基线和对照、测量与结果判定；按领域补充数据划分、重复性和误差解释。
- 逐项步骤：ID、说明、执行角色、依赖、预期产物与完成要求。
- 执行顺序、Engineer/RA 任务汇总、数据、工具、算力和时间资源。
- 执行范围、已有环境、已知运行方式、验收证据、预算与停止条件。
- 实际辩论轮数、因 READY 还是轮数上限结束，以及重要批评和限制。

批评详情可链接 `method.json` 和逐轮评审，保持设计对象与可读方案一致。项目已有 `PLAN.md` 约定或用户指定该名称时，同步生成该入口并指向本次完整方法，不维护相互矛盾的两份方案。

无法解析 Formatter 输出或未形成实际方法时，保留原始输出和讨论，报告未完整生成，不伪造实验步骤或执行结果。

## 交给实验执行

用户要求继续时，将 `method.md` 和所需输入交给已有 `research-experiment`。设计阶段不执行步骤，不把 `execution_order` 和 `dependencies` 描述成已经完成调度。

采用 engine 时，阅读 [engine 接入与恢复](../../../docs/engine.md)，在分配的实验输出目录内准备 `method.md`。材料位置应能从该目录正确访问：优先使用实际绝对路径，或明确相对路径的基准。不要在方法设计阶段生成或覆盖 engine 的 `experiments/plan.json`、`progress.json`。

当前 engine 会读取 method.md，再生成自己的 `{id,title,description,instructions}` 执行计划；不能把上述方法 JSON 直接写成它的 plan.json，也不声称它会按 assignee 自动调用 Engineer 或真人 RA。存在人工步骤时，在交接中明确所需人员、操作及预期产物，由后续流程与用户安排。
