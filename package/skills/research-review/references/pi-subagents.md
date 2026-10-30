# Pi 调用与交接

本技能按本机已安装的 Pi 1.4.0、`pi-subagents` 0.84.0 及包内 researcher 扩展编写。以实际工具 schema 为准，不需要安装新扩展、增加同名自定义 agent 或修改全局配置。两条路径任选其一，不混用参数与终止方式。

## pi-subagents 主路径

示例使用项目根目录下的 `review/`；采用运行子目录或自定义输出位置时，将示例中所有成果路径统一替换为本次成果目录的真实绝对路径。

1. 主会话确定工作目录、创建成果目录和简要 context，自行发现已有成果；有相关 report.pdf 时确认子会话能读取，若需 PDF 提取或页面预览，由主会话准备到本次成果目录。没有该文件时直接使用实际材料，不要求报告生成前置阶段。输入清单可选，不要求用户指定研究输入。只有 `subagents_enable` 可见时先调用 `subagents_enable({})`，在下一次模型请求使用 `subagent`。
2. 按需用 `subagent({"action":"list","options":{"capabilities":true}})` 确认代理。默认内置 `delegate`，沿用模型，以 task 定义学术 Reviewer。内置 `reviewer` 的系统提示是代码审查格式，与本技能协议不同，不能仅凭同名就假定适用。项目覆盖 delegate 时先确认工具与提示是否兼容。
3. 使用 `options.context: "fresh"`，不 fork 作者会话。delegate 不自动继承本技能和 PDF/检索扩展，所以给出技能参考、工作目录及必要 PDF 读取入口，让 Reviewer 自主发现辅助文件；不提供封闭输入列表。不要用顶层 chain/parallel/tasks 旧参数。

本路径每次仅以 `agent`、`task` 启动一个 Reviewer。启动参数省略 `workflow`、`args`、`options.script` 及旧字段 `workflowScript`、`workflowScriptPath`，不要用 `workflow: false` 或 `null` 代替省略；管理查询另用 `action`，不混入启动调用，也不使用 `action: "single"`。

若返回 `Structured single-child execution cannot be combined with workflow.`，说明该次调用在启动前被参数校验拒绝。保留已有材料，从下方模板重建参数，完整去除工作流字段后纠正重试一次；不要仅修改 workflow 的值。若已有 run id 或启动状态不明，先按 ID 查询，避免重复启动；仍失败则报告错误，不自动切换执行模式。

```json
{
  "agent": "delegate",
  "cwd": "/absolute/project",
  "task": "你是独立学术 Reviewer，只完成本次评审，不启动其他代理。读取 /absolute/skill/research-review/references/reviewer.md、/absolute/skill/research-review/references/output.md 及 /absolute/project/review/context.md。在 /absolute/project 及子目录自行发现并判断可能有用的 Markdown、JSON 等材料；存在相关 report.pdf 时必须实际读取全文，PDF 读取方式和可用提取件见 context；不存在时直接评审已有材料，不要求生成 PDF 或执行前置阶段。不要局限于 context 已列路径。逐项核查决定结论的证据，记录实际读取文件和未核验范围，不运行实验、不改研究材料。将符合输出协议的完整 JSON 写入 /absolute/project/review/review.json，只允许写这个成果文件。完成后最终回复纯 JSON 交接 {status, summary, artifacts, open_questions}，artifacts 仅列真实写入的 review.json 绝对路径，summary 说明主要发现及局限；已存在的相关 report.pdf 全文无法读取时报告读取障碍，不自报完成全部评审。",
  "output": false,
  "options": {"context": "fresh", "outputMode": "inline"}
}
```

本分支先将完整评审写入 `review.json`，最终回复仅为交接 JSON `{status, summary, artifacts, open_questions}`，不在交接中重复完整评审。`output: false` 关闭扩展单文件重定向，使两者分开；不能只回复文件名或小结而不写产物。

delegate 的工具中有 write/edit/bash，本路径的“只读评审”表示不修改被评对象，**不是工具级只读隔离**。任务仅允许写指定 review.json，禁止修改输入或运行实验；需要工具级只读时使用下方 research_delegate 分支，或用户已有且提示兼容的只读 agent。不要为了评审增加权限。若使用兼容的纯只读 agent，当前扩展支持用 `output` 绑定产物路径，由运行时保存最终完整 JSON；此时不要沿用示例的 `output: false` 或要求另返交接小结。

`subagent` 默认异步，启动回执不等于完成。等待原生通知，不循环轮询或使用 bg_wait；只在确需阻塞时用 `async: false`。收到完成后主会话取得交接并保存 `reviewer.handoff.json`，再打开实际 review.json。交接的 status 为 completed/partial/blocked，指评审任务完成度；summary 为简要发现，artifacts 为真实文件，open_questions 为未决项。工具包装和日志不是该 JSON 本身。失败时保留已有结果并报告缺口。

主会话读取完整结构化结果，运行校验/渲染得到 `review.md`；不将子代理自报完成当成评审依据。不指定新模型、接受门禁或额外复核 agent，不自动再评审评审者。缺少 subagent 能力时说明不能完成新会话流程，可使用当前已存在的 research_delegate；单会话评审要明确其隔离限制。

## research_delegate 只读分支

适用于已经初始化的 researcher 工作区，或本技能已由 `research_delegate` 加载。主会话仅委派 `skills: ["research-review"]`，混入别的 skill 会使运行器使用普通可写工具集合；不在评审子会话中初始化工作区或继续委派。

```json
{
  "objective": "在运行时给出的 Workspace root 及子目录自行发现并判断可能有用的 Markdown、JSON 等材料，按本次任务独立评审已有成果。存在相关 report.pdf 时必须实际读取全文；若当前工具不支持 PDF，读取主会话直接由该 PDF 提取的带页码全文和必要页面，并记录来源；已存在但无法读取时报告读取障碍。不存在 report.pdf 时直接评审现有材料，不要求生成 PDF 或执行前置技能。先输出符合 research-review 输出协议的完整评审 JSON，再调用 research_finish；不要自行写文件或启动其他代理。",
  "skills": ["research-review"],
  "inputs": [],
  "doneWhen": ["已自主发现并读取评审材料；如有相关 report.pdf 则读取全文，记录核验范围", "完整 JSON 含七项评审、证据定位及可执行修正", "通过 research_finish 返回完成度、证据和缺口"]
}
```

`inputs: []` 让 Reviewer 根据运行时提供的工作目录自主发现材料，不要求用户指定文件。主会话如准备了 PDF 提取件，可在 objective 中附本次提取目录的实际绝对路径作为能力补充，不限制其他材料的发现。该分支默认仅有 read/grep/find/ls/research_finish；额外工具取决于 reviewerTools 配置，不假定有 Bash、写入、联网或图像能力。存在相关 report.pdf 而没有 PDF 读取工具时，由主会话准备该 PDF 的全文；不存在时正常评审已有材料。

**子会话交接顺序：** 将完整 `review.json` 对象作为 `research_finish` 工具调用所在的最后一条 assistant 消息的正文输出（正文只含 JSON），并在同一条消息调用 `research_finish`。这是为了让当前运行器的 `getLastAssistantText()` 保存这份完整正文到分配目录的 `assistant-output.md`；不要先用一条消息输出 JSON，再用下一条只有工具调用的消息覆盖“最后正文”。

`research_finish` 使用运行时原有字段：

```json
{
  "status": "completed",
  "summary": "已完成本次指定范围评审；主要问题和核验限制见完整 JSON。这里填写真实工作小结。",
  "artifacts": [],
  "evidence": ["自主发现并实际采用的材料路径及定位；有 report.pdf 时包含其实际路径和页码"],
  "openQuestions": [],
  "nextActions": ["主会话读取 assistant-output.md，校验并生成 review.md"]
}
```

此处只是字段形状示例，必须填写真实结论。没有写入权限时 artifacts 保持空数组，不把将来生成的 review.md、输入文件或不存在的文件冒充产物；summary 上限 6000 字符，只放工作小结，不承载完整评审。evidence/openQuestions/nextActions 使用 camelCase，不使用 subagent 交接的 open_questions。

运行器保存 `handoff.md` 和任务结果，也会在正文非空时保存 `assistant-output.md`，**不会自动创建 review.md**。主会话从任务 outputDir 读取该正文，解析为 JSON 并保存到本次成果目录的 `review.json`，再运行渲染脚本。若模型没有同时输出正文导致缺失，则从保留会话提取真实完整 JSON，或请求补齐，不从短 summary 杜撰全文。

被评对象无法访问时同样调用 research_finish，用 partial/blocked 说明原因；若不足以形成合法评审，不强行输出评分。若评审完整但意见为 Reject，交接仍可 completed。该分支的成果目录以运行时分配位置为准，子会话不写主会话目录或共享状态。
