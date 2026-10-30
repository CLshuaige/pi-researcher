# 输出约定

这是本技能的文件约定，不是 Pi 内置工具协议。阶段主产物统一为 `hypothesis.md`，`hypothesis.json` 是结构化配套，Formatter 与交接文件是过程记录。不要求修改其他技能或复用旧框架的 Python 类。

## Formatter 输出

Formatter 将完整 JSON 保存到主会话指定的独立 `formatter/formatter.json`，最终回复另按 [子代理交接](pi-subagents.md#子代理交接) 返回实际地址和工作小结。主会话从交接的 `artifacts` 打开该产物，不将交接 JSON 当成候选 JSON。顶层 `ideas` 是候选列表，每个候选包含以下字段；下面仅演示单个条目的形状，实际按讨论结果输出候选。

```json
{
  "ideas": [
    {
      "candidate_id": "H1",
      "content": "完整的假说或研究方案描述，包括预期观察及验证思路",
      "score": 0.8,
      "basis": "关键科学依据、对应的文献或已有结果位置；指出推断部分",
      "components": ["主要实现组成或步骤"],
      "strengths": ["科学价值、创新性或验证方面的优势"],
      "weaknesses": ["资源风险、证据局限或尚未解决的问题"],
      "round": 1
    }
  ]
}
```

`content`、`basis` 为字符串，`components`、`strengths`、`weaknesses` 为字符串数组，`score` 为 0–1 数值。`round` 是该候选在讨论中出现的轮次，从 1 开始。保留引用的稳定标识或本地材料位置；Markdown 定位到章节、段落，JSON 定位到字段路径或数组位置，不把临时搜索缓存 ID 当作证据来源。

`candidate_id` 沿用提出方向的 H1、H2 等标识，排序后仍保留，便于追溯每个子代理的产物。一个提出者只交一个假说，Formatter 按各方向最新完整结果整理；旧轮次不作为新候选。合并重复方向时在依据中说明来源与理由，不构造批准状态或候选版本门禁。

## 主会话结果

主会话读取 Formatter JSON，按 `score` 降序排列候选。同分时保留 Formatter 的原有顺序。将排序结果保存为 `hypothesis.json`：

```json
{
  "candidates": [],
  "selected_index": 0,
  "debate_rounds": 3
}
```

这里 `candidates` 必须填入实际排序后的候选对象，空数组只是字段示意，不是可交付的成功结果；`debate_rounds` 填实际完成的 Critic 轮数。不要直接照抄示例中的数字。默认选择最高分，即 `selected_index = 0`；不另加批准状态、候选版本或评分阈值。

同时生成 `hypothesis.md`，至少包含：

- 本次研究目标、输入材料位置及实际辩论轮数。
- 按分数降序列出的全部候选，第一项标题加 `[SELECTED]`。
- 每项的方向标识、来源产物、内容、分数、依据、实现组成、优势、弱点和出现轮次。
- 选中理由、尚存限制，以及本次因 READY 还是轮数上限结束讨论。

Formatter 无法解析或没有实际候选时，说明结果未完整生成，保留讨论和原始输出，不编造一个选中假说。

## 后续使用

向方法设计交付主产物 `hypothesis.md` 及材料位置；需要结构化读取时提供 `hypothesis.json` 中 `candidates[selected_index]` 的完整内容，以及 `context.md` 中的任务和约束。最高分是本轮讨论下的选择，不代表新颖性已检索证实、资源已实测或假说已通过实验。被舍弃的候选与批评仍留在本次运行目录中，供后续回看。

不额外创建固定编号的 `Hxxx.md`；项目已有该约定时，可由主会话把选中结果整理到相应文件，并链接本次 `hypothesis.md`。
