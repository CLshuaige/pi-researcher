# 检索与来源选择

检查实际可用工具及其参数。当前部署可使用：

- `academic_search`：初始查询优先使用配置选中的学术源，参数值与显示名称见下表。
- `paper_lookup`、`paper_citations`：核对文献并追踪引用。
- `web_search`、`fetch_content`、`get_search_content`：发现和阅读网页。web_search 使用 `workflow: "none"`，由当前会话分析资料。
- `download_pdf`：按需下载开放 PDF，将 outputDir 指向 `literature/papers/` 等文献子目录。
- `fetch_arxiv`：获取可读的 arXiv 全文材料；核对图表和页码时仍需原始 PDF。

所选来源用于安排检索重点，不是白名单。lookup/citations、网页检索和原文阅读可补充其他来源；如用户明确禁止某源或限制访问预算，再单独遵守并核对工具能否实现该限制。

当前 academic_search 的摘要补全默认会访问 Semantic Scholar，可按缺失摘要、可用凭据与访问预算决定 enrich 是否开启；不必因为它不在优先源列表就关闭。以 DOI/arXiv ID 作 query 会触发跨来源直接查找，paper_lookup 与 paper_citations 也可能合并来源。记录实际来源，不把补充结果写成只来自优先源。服务失败时保留访问边界，改用其他可用渠道。

| 配置值 | 完整名称 | academic_search 参数值 |
|---|---|---|
| arxiv | arXiv | arxiv |
| openalex | OpenAlex | openalex |
| semantic_scholar | Semantic Scholar | semantic |
| crossref | Crossref | crossref |
| pubmed | PubMed | pubmed |
| dblp | DBLP Computer Science Bibliography | dblp |

## 查询和筛选

分别以英文专业术语和中文关键词查询，针对译名、缩写与方法同义词补充查询。围绕问题对象、方法族、数据与指标构造互补查询。先发现代表性工作，再按具体问题缩窄；适时追踪参考文献和引用。使用 DOI、arXiv ID 和正式 URL 去重，必要时保留有意义的版本差异。

数据库元数据适合发现论文，论文正文适合核对主张，项目与代码适合判断复现条件。普通网页搜索服务也可补充线索；生成的回答与参考文献需独立核实。

## 失败和交接

401/403 报告认证或权限问题；429 按服务提示退避，减少请求或使用其他已允许来源。超时、认证失败和部分来源失败均须在综合中说明，不能解释为没有相关研究。

临时 responseId/resultId 只用于当前工具检索。长期产物保存正式 URL、DOI 和必要摘录，不能只保存缓存句柄。主会话安装了插件，不代表子会话已加载相同工具；缺少能力时向主会话报告。

优先阅读与问题相关的高影响原始研究及领域重要会议/期刊论文，核实引用和发表信息；兼顾年限、近期进展、中文语境及相反证据，避免按引用量单一排序。
