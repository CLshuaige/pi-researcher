# PDF 文献综述写作与生成

仅在 `literature.writeReview=true` 或用户明确要求完整综述时执行。复用同包 [research-report 的输出约定](../../research-report/references/output.md)、[字体预设](../../research-report/latex/presets.py) 和 [组装/编译器](../../research-report/scripts/report_generation.py)，不复制模板或另装模型框架。两项技能应一起安装；缺少共享技能时明确报错，不从旧 `temp/` 目录或用户其他项目寻找替代。编译环境沿用包 README 的配置。

## 阅读、留存、综合，再排版

1. **先取证。** 读 [阅读](reading.md) 与 [来源记录](sources.md)。核心原始研究需进一步检查相关正文、图及图注，记录原图候选的查看和取舍，不能以摘要级综合图替代原图调查。在线阅读不等于要保存完整论文，但选定的关键原文证据与图必须在临时内容失效前留存。论文元数据、摘录、图片通过稳定 ID 对应，记录版本和位置；原文未取得时如实记录缺口。
2. **再组织论证。** 按研究问题/方法族/证据争议组织综述，不按每篇论文机械串联摘要。推荐包含研究范围与检索边界、方法谱系、代表性工作、可比较的证据与评估、分歧和局限、研究缺口及结论；按主题增删，不强制章节数量。论文结果属于相应文献，不能写成当前项目已经完成的实验。
3. **规划图与表。** 按全文的论点和章节安排视觉内容：总览、关键机制、代表性证据及方法比较各自选择最合适的图或表，不把“已有一张总览图”当成图文规划完成。可采用原创机制/分类图、摘录原图、改绘或混合方式，不强制每篇论文贴图，不设原图比例。完整图文综述至少实际使用一幅有信息量、可追溯的图，宜配比较表；脚本的最低数量检查不能代替人工判断图文是否充分。图表注明来源与条件，不可比较数值分开呈现，原创示意不冒充原论文实验。能力/材料不足时记录缺口，不用装饰图凑数。
4. **写作。** 模型自行整理 `context.json`、`outline.json` 和 `report.json`，不要求用户提供文件清单。可复用 report 的写作角色/阶段提示词中的 LaTeX、证据和图表规则，但当前任务是综述，输出语言仍跟随用户。尤其不能沿用“方法—新实验—本项目结果”的实验论文叙述。摘要根据最终综述写成一段，不加公式或引用；正文就地使用已核实的 `\citep{key}`/`\citet{key}`，BibTeX 不凭模型记忆补字段。
5. **组装并交付。** 使用下面的本技能入口，统一复用中文 ICML 字体和双栏前导，不让模型自行重新拼写模板。检查每张图的实际内容、可读性、中文图注、署名、正文引入与跨页布局，记录未核实部分。源文件与依赖完整保留在 `literature/review/`，最终只发布根目录的 `literature-review.pdf`。

## 产物和入口

所有命令的 `--root` 是**成果根目录**，默认当前命令目录；主会话通常是项目根目录，被委派时显式传分配的输出目录。材料发现范围仍是用户指定/运行时给出的项目根，不因为写作目录变化而缩小。仅在各自成果根目录写文件，避免并发任务共用同一份索引。

```text
<成果根>/
  literature.md                   保留的工作性综合
  literature-review.pdf           唯一的完整综述 PDF
  literature/
    papers.jsonl                  来源、稳定 ID 与实际阅读范围
    evidence.jsonl                选择性保留的原文证据
    figure-candidates.jsonl       核心论文原图的查看与取舍
    assets.jsonl                  图片出处、制作方式与哈希
    assets/*                      实际图片、必要数据/生成脚本
    review/
      context.json / outline.json 写作过程资料（模型按需保存）
      report.json / main.tex      共享组装器的清单与主文档
      sections/*.tex              LaTeX 正文，非 Markdown
      figures/* / references.bib  编译依赖
      *.sty / *.bst               从 report 技能复制
      build-status.json           ok、pdf、review_pdf、哈希和错误
      build.log / report.log      编译诊断；有引用时还有 report.blg/bbl
```

以下在成果根目录执行；将 `<literature-skill>` 替换为本技能实际绝对路径，子任务在每条命令加 `--root <分配输出目录>`：

```bash
python3 <literature-skill>/scripts/review_generation.py init --language zh
# 阅读并写 papers/evidence，准备实际配图和元数据；由模型完成。
python3 <literature-skill>/scripts/review_generation.py retain --file /实际工具临时图片.png --metadata literature/asset-draft.json
# 完成 report.json、BibTeX 和 sections 后组装。
python3 <literature-skill>/scripts/review_generation.py render
python3 <literature-skill>/scripts/review_generation.py check
python3 <literature-skill>/scripts/review_generation.py compile
```

`init` 只创建空白写作骨架，不建立虚构来源、证据、图或正文。默认中文；英文请求用 `--language en`，其他语言沿用共享模板能支持的字符集并检查实际 PDF。正文语言不因论文均为英文而自动改为英文。

## 绘图前配置中文字体与短页眉

LaTeX 已有中文字体不等于 Matplotlib 默认会选中它。绘制含中文的原创/改绘图之前，先整理所有标题、标签、图例和标注文本，然后在**每个绘图进程中、创建图形前**调用本技能 `scripts/plotting.py` 的 `configure_chinese_font`：

```python
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, "/本技能实际绝对路径/scripts")
import matplotlib
matplotlib.use("Agg")
from plotting import configure_chinese_font

labels = ["检索证据", "方法比较", "综述综合"]
font = configure_chinese_font(labels)
import matplotlib.pyplot as plt
fig, ax = plt.subplots()
ax.text(0.5, 0.5, labels[0], fontproperties=font)
```

辅助函数优先通过 `kpsewhich` 找到已安装的 Fandol 字体文件，必要时查找可用的系统 CJK 字体；先检查实际标签的非拉丁字形，再显式注册字体、设置本进程字体与负号选项。返回的 `fontproperties` 可用于文本、标题或图例，不依赖某台机器固定的 `/usr/share/fonts/...` 路径。不修改用户全局 Matplotlib 配置，也不自动安装/下载字体。未找到覆盖标签的字体时应在画图前失败，不能带着缺字继续保存；罕见字和新增标签也要加入检查。Matplotlib 仅在需要绘图时使用，不是 PDF 编译器的新增依赖。

可以先检查：

```bash
python3 <literature-skill>/scripts/plotting.py --text '本次全部中文标签'
```

图保存后仍需目检字号、裁切、重叠和中文可读性。完整题名保留在 `title`；综述页眉统一使用短 ASCII 标题 **`Literature Review`**。`init` 提前填好，`render` 会将模型改写的长页眉恢复为该短标题，再交给共享模板；不要把完整题名复制到 `running_title`，也不修改 ICML 页边距或页眉尺寸限制。

`retain` 的输入图片与元数据由当前会话实际取得/制作，脚本不联网下载，也不判断原图授权；它记录来源和字节哈希，拒绝空文件、非支持格式及同 ID 换内容。先填写 papers.jsonl 中的论文 ID，再留图。只支持 PDF/PNG/JPEG；SVG 要真正转换，不能改扩展名。若手工维护 assets.jsonl，仍需遵守同样字段并计算实际文件哈希。

`report.json` 沿用共享字段，仅每个选中的图额外填写 `asset_id`：

```json
{
  "asset_id": "F001",
  "source": "/实际成果根/literature/assets/F001.png",
  "path": "figures/F001.png",
  "caption": "含来源署名和限制的实际中文图注。",
  "evidence": "literature/assets.jsonl 的 F001；papers.jsonl 的 P001；evidence.jsonl 的 E001。"
}
```

上例是 `report.json.figures` 的一个条目，不是整个清单。留存记录与清单中的图必须对应，图片不得只停留在清单里，还需放进章节。使用单栏 `figure` + `\includegraphics[width=\columnwidth]{figures/F001.png}`，宽图可用 `figure*` + `\textwidth`，并添加正文引用、图注和唯一 label。`caption` 字段是目录记录，真正显示的图注与文献引用由模型写入 LaTeX `\caption{...}`，不能以为填写清单就会自动插图。

`render` 会校验留存资料及原图取舍记录，先固定短页眉再调用共享组装器，保留已有内容冲突检查；明确续写并检查改动后才加 `--force`。选用图片的 SHA-256 与留存文件不一致、来源 ID 不存在、证据/候选记录缺失、原图/改绘与候选不匹配、缺图或正文没有实际插图时拒绝生成完整综述。只有无法访问/相关正文无图的记录时输出阅读边界警告，不强迫粘贴原图或伪造查看结果。`check` 进一步复用共享引用、图片与交叉引用检查；记录字段通过不代表实际看过原图或科学主张真实。

`compile` 复用 report 的实际 XeLaTeX/BibTeX 流程，内部 `report.pdf` 编译成功后原样发布为 `literature-review.pdf`，随即移除中间 PDF；不生成 main.pdf，不在成果中留下第二份报告 PDF。`build-status.json` 同步为最终路径，不能把内部 report.pdf 路径交给用户。失败时保留之前的 PDF 和本次诊断，状态为 `ok:false`、`pdf:null`、`review_pdf:null`；不能把旧 PDF 当新成果。源码和所需图片可用于重新编译，完整原论文不属于必要的编译依赖。

不删除已有 `literature-review.md` 等历史文件，也不把它们直接当作核验过的文献证据；新任务不再写该 Markdown 综述。不满足完整交付时，仍提交实际 `literature.md`、来源/证据、已留存图片及源码，并指出阻碍，不把格式失败伪装为科研完成。
