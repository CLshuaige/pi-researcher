# 配置与交互

每个工作区的 `.pi/research-modules.json` 保存非秘密模块参数：

```json
{
  "interactionMode": "auto",
  "literature": {
    "sources": ["arxiv", "openalex", "semantic_scholar", "crossref", "pubmed", "dblp"],
    "writeReview": false
  },
  "experiment": { "max_optimization_iterations": 5 }
}
```

先运行本 Skill 的 `scripts/check-settings.mjs`，读取校验后的有效设置。调用方明确提供已校验的配置快照时可以复用。工作区显式配置覆盖默认值；缺失字段使用上例默认值。

- `interactionMode`：`auto` 自主推进；`review` 对关键歧义提供选项。各阶段的人工审核由主流程协调。
- `literature.sources`：初始学术检索优先使用的来源列表；空数组跳过优先源联合查询，仍可按需读取网页、已知论文和 DOI 线索。它不是来源白名单，允许补充查找与摘要补全。
- `literature.writeReview`：始终生成工作性的 `literature.md`；为 true 时额外生成 `literature-review.md`。

API Key 由运行进程环境或宿主凭据服务提供。工作区配置和交接只保存非秘密参数。

## 问题呈现

优先使用可用的 `ask_user` 工具，按实际 schema 给出一个关键问题、2–4 个选项和自由回答入口。例如：

- 先做小规模真实验证（推荐）：保留原目标，说明规模限制。
- 接入 GPU 后继续：保存已有材料，标明训练尚未执行。
- 本轮仅完成文献和方法：明确当前交付范围。

用户可以自定义或明确选择跳过并采用已说明的默认值。review 模式等待关键决定的回答，不能因为用户没有回应就宣称将自动采用某选项。无 UI 时用普通对话展示选项。子会话需要用户决定时向主会话交接，不虚构用户点击或回答。

运行 `scripts/check-settings.mjs --describe` 查看完整参数、可选值和默认值。定义来自同包的 `config/research-modules.schema.json`。

网页可配置 `hypothesis.max_debate_iterations` 和 `method.max_debate_iterations`，分别用于多角色假设生成和方法设计，默认 5，范围 1–20。`check-settings.mjs` 负责校验并返回它们，对应 Skill 在开始讨论前读取；用户本次明确指定的轮数优先。单会话技能不进行讨论循环，因此不使用这些字段。文献检索当前按问题调整关键词与检索范围，没有固定的关键词组数或轮数配置。

网页“实验执行”中的 `experiment.max_optimization_iterations` 限制每个改进任务的累计优化轮数，默认 5，范围 1–20。初次执行不计入；每轮反馈调整并执行评估计一轮，失败轮也计入，中断续跑不重置。达到目标可提前结束，达到上限时保留阶段结果并说明目标是否达成。仅在任务需要迭代优化时使用；用户指定基线时严格遵循，未指定时由智能体判断是否需要对照，基础任务不强制寻找基线。

参数在整个研究期间都可以修改。每次阶段启动、重新执行或续跑前，从项目根目录重新读取并校验当前设置；向子代理交接的配置快照必须在本次启动时取得。历史快照和旧产物仅用于追溯，不能覆盖后来保存的参数。记录每次运行实际采用的配置；已启动命令保持其启动参数，新设置在下一个执行边界生效。修改参数本身不自动重跑已完成阶段。
