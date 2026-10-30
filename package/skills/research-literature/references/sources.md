# 来源记录

`literature/papers.jsonl` 每行记录一篇实际保留的文献。最少包含 `title` 和 `url` 或 `doi`。按实际需要补充 `authors`、`year`、`abstract`、`source`、`accessed`、`localPath`、`readLevel`、`note`，只填已核实的信息。

`accessed` 和检索日期只能使用工具时间戳或运行环境实际确认的时间；需要时运行 `node -e 'console.log(new Date().toISOString())'`。无法核实时省略，不能猜测当前日期。历史记录沿用原访问日期，本轮复核日期另行说明。

`readLevel` 用 `metadata`、`abstract` 或 `fulltext` 表示实际访问深度。`fulltext` 表示已读取相关正文，不意味着通读全部章节。方法、数据、评估协议、代码与失败条件都可以成为保留理由。

`literature.md` 中关键结论就近附 DOI/原文链接及实际核对过的章节、表格或页码。只读摘要时说明边界。索引帮助后续 Agent 定位原文，不能代替关键内容的复核。

URL 失效时以 DOI/arXiv ID 等稳定标识查找。缓存正文或摘录时记录来源和版本；记录中的本地路径应能由工作区根目录或明确的索引所在目录解析。

## 完整 PDF 综述的最小留存

保持普通索引的最小字段不变；需要完整综述时，为保留的论文分配稳定的 `id`（如 P001），可加已核实的 `bibkey`，用于关联 LaTeX 引用、摘录与图片。不同且会影响结论的版本应分开标识，或显式记录每条证据使用的版本。`literature.md` 继续是工作笔记；不生成完整综述的 Markdown 副本。

`literature/evidence.jsonl` 每行保留一条实际用于综述的最小证据，字段示例：

```json
{"id":"E001","paper_id":"P001","kind":"paraphrase","readLevel":"fulltext","locator":"第 3 节，图 2 及其图注","content":"准确释义原文方法、结论和适用条件，不是模型补充的猜测。","version":"实际核实的版本（未知时省略）"}
```

`kind` 为 `quote`（短原文引句）、`paraphrase`（释义）或 `data`（核对过的数据及条件）。保留原语种引句，译文标为译文；不要把释义标成原文。`readLevel` 为实际取得的 abstract/fulltext，后者不表示通读全文。元数据不能充当方法、实验结果或图像内容的证据。未知版本/日期省略，示例占位文字不能原样留作成果。

## 原图候选的查看与取舍

`literature/figure-candidates.jsonl` 记录为本综述实际检查的核心论文图表，不要求所有检索结果都建一条，也不要求最终采用原图。每条包含稳定 `id`、`paper_id`、实际 `source_url`、`locator`、`inspection`（查看方式/已读范围）、`viewed`、`decision`、`reason`。示例仅展示字段，应替换为实际核验结果：

```json
{"id":"C001","paper_id":"P001","source_url":"论文实际地址","locator":"图 2，第 4 页及图注","inspection":"实际查看了 PDF 第 4 页图像与图注，并阅读相关方法段落。","viewed":true,"decision":"omit","reason":"原图聚焦单一实现细节，本节比较跨方法机制，采用有出处的原创分类图更清楚。"}
```

`decision` 允许：

- `include`：采用原图；`viewed:true`，填写最终 `asset_id`，资产 `kind:reproduced`。
- `adapt`：改绘/摘录；`viewed:true`，填写最终 `asset_id`，资产 `kind:adapted`。
- `omit`：已看过原图但不采用；`viewed:true`，说明与论点、可读性、重复性等相关的具体理由。
- `unavailable`：尚未取得/无法实际查看；`viewed:false`，`inspection` 记录实际访问尝试和失败，`locator` 记录已知目标或“正文未取得，图号未知”。不能填造图号或当成已查看。
- `no_figure`：已读的相关正文范围内没有图；`viewed:false`，记录实际检查范围，不据此断言全文从未有图。

最终原图/改绘的资产记录还需 `candidate_id`，与候选中的 `asset_id` 双向对应。未采用的原图不强制保存副本；选中的原图、裁剪图、改绘成品则需实际留存。只有原创图也可以完成综述，但仍须诚实记录原图查看与取舍；所有来源均受限时在综述中披露，不把原创图当作全文阅读证明。

## 最终采用的图片

图片记录保存到 `literature/assets.jsonl`，实际文件在 `literature/assets/`。推荐用 `review_generation.py retain` 从工具临时文件选择性保留并计算 SHA-256。模型先准备的元数据示例：

```json
{
  "id": "F001",
  "kind": "synthesis",
  "caption": "本综述对方法机制的综合示意，非原论文实测图。",
  "sources": [{"paper_id":"P001","locator":"第 3 节，图 2 及其图注"}],
  "credit": "本综述绘制，依据已核验文献 P001。",
  "derivation": "按已读原文比较模块关系；生成脚本在 literature/assets/draw_taxonomy.py。"
}
```

图的 `kind` 可为：

| kind | 额外记录 |
|---|---|
| `reproduced` 原图复用 | `source_url` 为原文/图地址，`reuse_basis` 记录实际可核实的复用依据，图号/页码、版本和原图注 |
| `adapted` 改绘 | 同上，并在说明中记录裁剪、翻译、标注或其他改动；不得改变数据含义 |
| `synthesis` 原创综合示意 | `derivation` 说明依据、制作方式和脚本或可复现描述，来源列表可有多篇 |
| `plot` 数值重绘 | `derivation`，加项目内 `literature/` 下的实际 `data` 和 `script` 路径，来源定位标明数据及条件 |

`retain` 自动加入 `path`、`sha256` 和真实执行时的 `retained_at`；同一 ID 不允许换内容，需新建 ID 保留修订。原图复用条件不明时，不把“可以访问”当成“可直接转载”的证明；可以保留来源链接，改用有据可查的原创综合示意。图片说明与署名同时保留，相关原图可在临时 PDF 中提取，无须因此保存全部论文。

这些记录支持回溯和组装，不自动证明科学主张、阅读深度或复用依据真实；仍由当前会话回到实际来源核验。
