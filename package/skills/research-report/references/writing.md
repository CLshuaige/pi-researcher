# 写作上下文与提示词

提示词按用户提供的 `prompts/paper_writing.py` 与 `templates.py` 中论文角色改写，实际文件为本技能的 [paper_writing.py](../prompts/paper_writing.py) 和 [templates.py](../prompts/templates.py)。保留提纲、摘要、关键词、逐节写作、引用核对与编译修复的步骤，移除 AutoGen 组聊、固定英文输出和 Perplexity 依赖。

无需用户显式指定输入文件。Pi 先递归查看已确定的项目根目录及子目录，包括被 Git 忽略的研究材料与旧目录，自行筛选与研究主题有关的 Markdown、JSON 等文件，按内容与出处判断其用途，再追踪引用的文献、实验记录、指标与图表。文件名和目录结构不作为是否可用的硬条件；用户提供的路径只是可选线索，用户明确限定的范围与运行时访问边界仍须遵守。

按需读取候选材料，不把依赖目录、无关文档和大型数据全部塞进上下文。注意区分真实实验与示例、不同运行或修订版本，以及报告草稿与原始证据；本次生成的摘要和正文不能反过来当成独立证据。信息缺失时先沿工作目录继续查找，关键缺口仍未解决再询问用户。

Pi 读取并判断原始材料后自行写入 `context.json`。它是写作证据包，不是用户必须提供的输入文件或新的工具协议。`report.json`、提纲、来源和图表目录也由 Pi 在生成过程中整理。可以按阶段缩减上下文，但不能把实验设想当结果。示例字段如下，内容由模型填写为真实材料：

```json
{
  "language": "zh",
  "task": "研究问题、用户的受众与篇幅要求",
  "idea": "选定假说及其来源位置；没有假说时说明报告类型",
  "method_summary": "方案与实际实现的区别、方法细节及原文件位置",
  "results_summary": "真实运行及指标位置；尚未运行就明确说明",
  "source_files": ["模型自行发现并阅读后记录的实际路径"],
  "reference_catalog": [
    {"key": "已核验的BibTeX键", "source": "原文路径或URL", "locator": "页码/章节", "supports": "支持的主张与限制"}
  ],
  "figure_catalog": [],
  "outline": {},
  "notation": [],
  "completed_sections": {},
  "section": {},
  "title": "",
  "abstract": ""
}
```

`source_files` 和目录条目记录模型已选择的材料，用于提示 Pi 回到原文，不是用户传入的文件白名单，也不会被脚本自动读取、下载或认定为已核验。写作中发现新的相关文件时，读取后更新上下文与证据索引。大型原文按需读取；关键数据保留原始精度和定位。`figure_catalog` 条目沿用 [report.json 图表格式](output.md)，写作使用 `path`，不是外部 `source`。

按需调用以下命令生成阶段提示词，再由当前 Pi 会话执行其中的写作任务：

```bash
# 在项目根目录执行；其他输出位置使用本次 context.json 的实际绝对路径。
python3 <skill-dir>/scripts/report_generation.py prompt --stage outline --context report/context.json
```

支持阶段：

| stage | 主要输入 | 输出/用途 |
|---|---|---|
| `outline` | task、idea、method_summary、results_summary、来源和图表目录 | 提纲 JSON，含章节可支持主张、证据、依赖、符号和缺口 |
| `abstract` | 研究材料、outline | JSON：纯文本 title 与 LaTeX 正文 abstract |
| `keywords` | title、abstract | JSON：keywords 字符串数组 |
| `section` | section、outline、notation、completed_sections、原材料与目录 | 单节 LaTeX 正文，保存到 sections/*.tex |
| `abstract-refine` | 当前 title、abstract、完整章节与真实结果 | 单段 LaTeX 摘要，回写 report.json |
| `citations` | text、reference_catalog 与关键原文 | 核对并修订就地引用，缺口记入 evidence.md |
| `repair` | text、errors、出错章节和已核验目录 | 只修复语法，系统依赖错误由主会话处理 |
| `review` | 最终全文、目录和原始证据 | 内容与排版检查记录 |

不必为每个小阶段启动独立会话。可直接读取函数中的提示词，不要求通过 CLI 反复打印相同系统规则；脚本不会代替 Pi 写正文。若用户指定英文，在写作 `context.json` 与排版 `report.json` 中都设 `language: "en"`。

`outline.json` 保存规划结果；写作时将当前节的目标、主张、证据、依赖和图片填入 `context.section`。保存每节正文后，更新 `completed_sections` 的实际文件路径或相关内容，保持符号与结论一致。每节不包含自己的顶层 `\section`，由组装器统一提供；不输出 Markdown 围栏或原框架的 `<SECTION_TEXT>` 包装。

`evidence.md` 至少把主要论断对应到来源与定位，建议列：主张、事实/推断/建议、原文或指标文件、页码/行号/运行编号、引用键、局限与核验状态。图表再关联输入数据、脚本与运行编号。它可以引用项目原文件，不必把整个实验复制进报告；`report/` 内的所有 TeX 编译依赖则必须完整。
