# 来源记录

`literature/papers.jsonl` 每行记录一篇实际保留的文献。最少包含 `title` 和 `url` 或 `doi`。按实际需要补充 `authors`、`year`、`abstract`、`source`、`accessed`、`localPath`、`readLevel`、`note`，只填已核实的信息。

`accessed` 和检索日期只能使用工具时间戳或运行环境实际确认的时间；需要时运行 `node -e 'console.log(new Date().toISOString())'`。无法核实时省略，不能猜测当前日期。历史记录沿用原访问日期，本轮复核日期另行说明。

`readLevel` 用 `metadata`、`abstract` 或 `fulltext` 表示实际访问深度。`fulltext` 表示已读取相关正文，不意味着通读全部章节。方法、数据、评估协议、代码与失败条件都可以成为保留理由。

`literature.md` 中关键结论就近附 DOI/原文链接及实际核对过的章节、表格或页码。只读摘要时说明边界。索引帮助后续 Agent 定位原文，不能代替关键内容的复核。

URL 失效时以 DOI/arXiv ID 等稳定标识查找。缓存正文或摘录时记录来源和版本；记录中的本地路径应能由工作区根目录或明确的索引所在目录解析。
