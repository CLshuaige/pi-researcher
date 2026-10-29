# 报告产物与命令

本技能脚本需要 Python 3.10+ 标准库，无 pip 依赖、API Key 或原研究框架。Pi 使用其已有模型和 read/write/edit/bash 能力；无需改扩展或注册新工具。所有路径参数相对于调用命令时的工作目录；`report.json` 内的章节、参考文献和相对图片 source 则相对于该 JSON 所在目录。

## 目录与字段

```text
paper/
  context.json             Pi 整理的写作证据包
  outline.json             Pi 生成的提纲
  evidence.md              主张与原文/运行、图表数据的对应关系
  report.json              组装器输入及可搬移的导出清单
  main.tex                 生成的双栏主文档
  sections/*.tex           Pi 写作的章节正文
  figures/*                实际使用的 PDF/PNG/JPEG 图
  references.bib           已核验文献；允许没有外部引用
  icml2026.sty             与下面四个文件由技能原样复制
  icml2026.bst
  fancyhdr.sty
  algorithm.sty
  algorithmic.sty
  report.pdf               唯一的最终报告 PDF
  build-status.json        本次编译结果、来源摘要、错误与警告
  build.log                全部编译命令及原始 stdout/stderr
  report.log / report.blg  可用时保留 TeX / BibTeX 诊断
  report.bbl               成功引用解析后的参考文献（可用时）
```

可用 `init --output paper` 创建空骨架，默认中文、ICML2026、preprint。标题、摘要和正文留空并会阻止 `render`，不会自动生成虚构内容。已有目录不要重复 init。

`report.json` 示例展示字段形状，不包含可当作真实研究结果的样例指标或参考文献：

```json
{
  "journal": "ICML2026",
  "language": "zh",
  "style": "preprint",
  "title": "填写真实报告题名",
  "running_title": "Research Report",
  "abstract": "填写由材料支持的单段摘要，不加 abstract 环境。",
  "keywords": ["关键词一", "关键词二"],
  "authors": [],
  "sections": [
    {"id": 1, "title": "引言", "file": "sections/01-introduction.tex"},
    {"id": 2, "title": "讨论与局限", "file": "sections/02-discussion.tex"}
  ],
  "bibliography": "references.bib",
  "figures": []
}
```

字面百分号在 JSON 字符串中写成 `\\%`，解码后为 LaTeX `\%`。写真实摘要时替换示例文字。`title`、`running_title`、`keywords`、章节标题、作者等是**未转义纯文本**；`abstract` 和章节正文是 **LaTeX 片段**，组装器不会二次转义。JSON 中每个 LaTeX 反斜杠必须写成 `\\`，推荐用程序 JSON 序列化避免手写转义错误。较长摘要保持单段，不加环境。

`journal` 当前只支持 `ICML2026`，未知值报错。`language` 允许 `zh`（默认）与 `en`；默认中文适配为 `article` + `ctex` + 原始 ICML2026 样式，不改为 ctexart。`style` 允许 `preprint`（默认）、`anonymous`、`accepted`；后两项需任务明确要求。匿名模式隐藏 `main.tex` 中的作者身份，源包中的证据、清单、致谢和其他内容仍需人工检查。

`running_title` 是短页眉。默认 `Research Report` 避免原模板对 CJK 字形高度的严格检测导致页眉被隐藏；可按需要提供合适的短标题并检查 PDF。正文标题和其他报告内容仍默认中文。

真实作者按 `{"name":"姓名","affiliation":"单位","email":"真实通讯邮箱（可省略）"}` 填入 `authors`；同单位自动合并脚注，有邮箱的作者列入通讯作者。缺少作者、单位或邮箱会显示相应信息未提供，不填虚构 Research Team 或 example.com 邮箱。

章节顺序就是 `sections` 的数组顺序；`id` 为唯一正整数，文件必须是唯一的 `sections/*.tex`。文件路径使用不含空格的 ASCII 字符，只允许字母、数字、`_./-`，不能绝对路径、`..` 或通过符号链接逃出报告目录。标题可以是中文。章节不加顶层 section、包声明、文档、摘要或参考文献环境；子标题可以使用 subsection/subsubsection。

图片条目示例：

```json
{
  "source": "/实际实验目录/figures/curve.pdf",
  "path": "figures/curve.pdf",
  "caption": "由实际数据支持的图注",
  "evidence": "实际数据文件、绘图脚本、运行编号及必要定位"
}
```

`source` 可为真实绝对路径或 JSON 目录相对路径，输出 `path` 必须在 `figures/` 内。图片只接受 PDF/PNG/JPG/JPEG，不能把 SVG 改扩展名冒充支持格式。只拷贝目录里明确登记的实际图片，不扫描并收集任意实验图片。组装完成后导出清单的 `source` 改为本地 `path`，确保搬移 `paper/` 后仍能重组装和编译。证据目录中的外部原始数据路径只是追溯信息，不是编译依赖。

正文用精确输出路径：

```latex
如图~\ref{fig:curve} 所示，说明实际观察及适用范围。
\begin{figure}[t]
  \centering
  \includegraphics[width=\columnwidth]{figures/curve.pdf}
  \caption{由数据支持的图注。}
  \label{fig:curve}
\end{figure}
```

引用只使用 `references.bib` 中已核验键，采用 `\citep{key}` 或 `\citet{key}`。`bibliography` 可以是 JSON 目录中的其他 `.bib` 路径，导出统一为 `references.bib`；无外部引用时可为空字符串或空文件，正文不能仍有引用。只有确有引用时组装参考文献部分，未使用的条目不会伪装成已引用。不会复制模板的 `example_paper.bib`，也不会自动生成 DOI 或联网补文献。

## 调用与验证

```bash
python3 <skill-dir>/scripts/report_generation.py render --manifest paper/report.json --output paper
python3 <skill-dir>/scripts/report_generation.py check --output paper
python3 <skill-dir>/scripts/report_generation.py compile --output paper --timeout 120
```

`render` 先检查所有输入及输出冲突，再写文件。已有同内容文件可重用；对改变的生成文件，先确认更新范围，再加 `--force`。有手工编辑的 main.tex 时应先检查或保留副本，避免丢失改动。`--force` 不绕过路径或内容校验。

`check` 检查实际 `main.tex` 及递归 input 图，发现缺文件、未定义引用、重复 BibTeX 键、未定义/重复 label、目录外图片、LaTeX 中的 Markdown、章节包装错误时返回非零。支持本技能约定的标准 LaTeX 命令，不是完整 TeX/BibTeX 解析器；不能证明文献元数据或研究结论真实。

中文编译需要可用的 XeLaTeX（或 `--engine lualatex`）、BibTeX（有引用时）、ctex/xeCJK 或 LuaTeX 中文支持、Fandol 中文字体、TeX Gyre 西文字体与常用 LaTeX 包：amsmath、amssymb、amsthm、graphicx、booktabs、hyperref、natbib、times、xcolor、eso-pic、forloop、url、caption。中文预设在原 ICML 样式之后显式选择 TeX Gyre 的 OpenType 字体，避免传统 Times 设置在 Unicode 编码下丢失字体形状。简要安装与字体检查见 [README 报告编译环境](../../../README.md#报告编译环境)。脚本不联网安装，也不改变全局配置。

`compile` 先做静态校验，再运行 XeLaTeX → BibTeX（有引用时）→ XeLaTeX 两遍；没有引用时运行 XeLaTeX 两遍。命令关闭 shell escape，每条有独立超时。临时构建目录与字体缓存都在 `paper/` 内，结束后清理；完整命令输出保存在 `build.log`，不清除诊断依据。工具错误、缺字体、未解析引用或缺字都返回非零与 `ok: false`，不能称为成功生成 PDF。Overfull/Underfull 会保留为警告，需检查版面。

源文件仍为 `main.tex`，编译命令通过 `-jobname=report` 直接生成 `report.pdf` 及 `report.aux`、`report.log` 等文件，BibTeX 同样处理 `report` 作业。整个编译流程都不生成 `main.pdf`。诊断检查通过后，把临时构建目录中的 `report.pdf` 原样保存到输出目录，不再次转换、压缩或重排版；成功编译时会清理旧版本遗留的 `main.pdf`。`build-status.json` 的 `pdf` 和 `report_pdf` 都指向唯一的 `report.pdf`。

失败时可能保留上次成功的旧 PDF，`build-status.json` 的 `pdf` 和 `report_pdf` 均为 null。每次最终交付都应重新运行 compile；状态中的 `source_sha256` 标识实际输入，`pdf_sha256` 标识最终报告。根目录的 `report.pdf` 和旧版本遗留的 `main.pdf` 不参与来源摘要，作为输入图片的 PDF 仍参与，避免编译输出反过来改变来源标识。源码改动后旧状态不能作为验收依据。依赖不足时交付完整源码与日志，明确缺少什么，不假报 PDF 成功。

技能内的回归检查：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s <skill-dir>/tests -v
```
