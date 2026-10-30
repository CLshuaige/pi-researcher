# 评审产物与协议

主产物为 **review.md**，由同目录的 review.json 渲染。不要交付 referee.md 或 research.md。context.md 是材料入口，inputs.json 是可选输入指纹清单，不是额外审稿结果。

## review.json

以下路径和内容仅演示存在 report.pdf 时的字段结构，不是预设输入。模型应在工作目录自主发现材料：有相关 report.pdf 时读取全文，没有时选择已有 Markdown、JSON、LaTeX 或其他实际成果作为评审对象，不要求先完成其他技能。按实际情况填写真实内容；空数组可用，不填充虚构问题。除注明可选者外均为必填。

```json
{
  "schema_version": 1,
  "input_type": "paper",
  "target": {
    "path": "/absolute/project/report/report.pdf",
    "sha256": "从 inputs.json 复制目标文件的实际 SHA-256"
  },
  "coverage": {
    "checked": ["report.pdf 全部页面正文（记录真实总页数和读取方式）；自主发现的 metrics.json 的 run-01 对象"],
    "unavailable": ["正文引用的第二次运行日志未提供"],
    "not_checked": ["PDF 全文通过文本提取读取，未做图表视觉检查；未重跑实验"]
  },
  "review_status": "needs_revision",
  "summary": "用两三句话概括实际研究问题、方法、贡献和结论。",
  "strengths": ["优势及对应章节或证据位置"],
  "issues": [
    {
      "id": "R1",
      "severity": "major",
      "location": "report.pdf:结果表页码及结论段",
      "finding": "这里填写具体发现，不将未报告直接说成未执行。",
      "evidence_status": "not_reported",
      "evidence": ["已读结果章节与表格，未见重复次数和波动说明"],
      "impact": "说明该问题如何影响结论或解读。",
      "suggested_action": "填写与影响相称的最小修正，不默认追加实验。",
      "acceptance_criteria": "给出完成修正后可检查的条件。"
    }
  ],
  "questions_for_authors": ["R1：请澄清影响判断的具体问题。"],
  "overall_score": 5,
  "score_rationale": "说明贡献、主要问题与这个分数的关系。",
  "confidence": 3,
  "confidence_rationale": "说明领域把握、证据覆盖与未核验范围。",
  "recommendation": "Borderline",
  "next_actions": ["R1 → research-report：补全报告或缩小结论，需补证时再交实验阶段。"]
}
```

- `schema_version` 固定为整数 1。`input_type` 为 paper 或 literature，后者按综述标准评估。
- `target.path` 是本次实际主评审文件的绝对路径，不限定文件名或格式。有相关 report.pdf 时使用其路径，即使用 PDF 提取件阅读也记录原 PDF；没有时使用实际选定的 Markdown、JSON、LaTeX 等成果路径，不填虚构的 PDF。`sha256` 为 64 位十六进制，优先复制清单，不由模型猜测。未使用 snapshot 时主会话用实际哈希工具取得。辅助材料由 Reviewer 自主选择，记录实际位置；清单存在时仅登记文件受版本检查。脚本只验证协议，不验证正文是否真的读过，主会话须检查读取记录和覆盖范围。
- `coverage.checked/unavailable/not_checked` 都为字符串数组：实际检查范围、无法访问的材料、主动未覆盖的核查。数组可空，实质范围说明不能省略；有限抽查不能写成全面验证。
- `review_status` 为 reviewed（计划范围的评审已完成且无 major）、needs_revision（有需修正的问题）或 insufficient_evidence（无法形成充分评价）。它与子任务 completed/partial/blocked 不同，也不是接收决策。
- `issues` 对应 Weaknesses，可为空。ID 形如 R1、R2，唯一，不按排序重编号。`severity` 为 major/minor/suggestion。位置、发现、影响、最小修正和验收条件必须具体。`evidence_status` 为 verified/not_reported/unverifiable；verified 至少有一条证据，其他状态也尽量列出已查范围或缺失路径，不伪造引用。
- `overall_score` 为 1–10 的整数，不能用布尔或字符串。`confidence` 为 1–5 的整数；1 表示把握很低，3 表示中等，5 表示相关领域及证据均有充分把握。都需理由，不按自信措辞自动给高分。
- `recommendation` 为 Strong Accept / Accept / Borderline / Reject / Strong Reject。不设置分数自动录用阈值，主会话应检查评分、理由与建议是否相称。存在 major 时不能给 Accept/Strong Accept 或 reviewed。
- 不能合理评分时 `overall_score: null`、`recommendation: "Not Assessed"`、`review_status: "insufficient_evidence"`，在理由、范围和作者问题中解释缺口。局部证据缺失不必一律弃评，可以给有限范围的正常评审及较低置信度。
- `next_actions` 是字符串数组，只提建议，不触发下游工具。

复审可额外包含 `previous_review`（旧 review.json 绝对路径）和 `resolved_issues`（已解决旧问题数组）。每项格式如下，不能与当前 issues 重复 ID。复审应把过去已关闭的问题也保留在 resolved_issues 中，便于之后追加编号和追踪；重新出现时从 resolved 移回 issues。

```json
{
  "id": "R1",
  "evidence": ["修订稿章节与本次实际核验的日志位置"],
  "explanation": "说明这份证据如何满足旧问题的验收条件。"
}
```

脚本检查这些字段的结构，但不证明引用真实、评分合理或复审确已解决；主会话仍需阅读依据。没有旧评审时不添加假的复审对象。

## 本地命令

从任意目录运行，将 `<skill-dir>` 替换为本 SKILL.md 的真实所在目录。示例使用项目根目录下的 `review/`；运行子目录或自定义输出位置应统一替换为本次成果目录的真实绝对路径。无需 pip 依赖、全局配置或原框架源码。

```bash
python3 <skill-dir>/scripts/review_output.py snapshot --target <本次主评审文件绝对路径> --input-type paper --output <本次成果目录>/inputs.json
python3 <skill-dir>/scripts/review_output.py check --review /absolute/project/review/review.json --manifest /absolute/project/review/inputs.json
python3 <skill-dir>/scripts/review_output.py render --review /absolute/project/review/review.json --manifest /absolute/project/review/inputs.json --output /absolute/project/review/review.md
```

snapshot 中的路径由模型发现后填入，用户无需指定。可按需用可重复的 `--evidence` 登记已发现的辅助材料；不存在的材料不要传给 snapshot，在 context 和 coverage 中记录。清单登记绝对路径、字节数和 SHA-256，不复制正文、抓取 URL 或替模型选择证据。render/check 提供 `--manifest` 时会核对本次对象和所有登记文件的当前哈希，变更或丢失时返回非零；应重新明确输入后评审，不直接更新哈希让旧评语通过。未登记的文件与外部页面不在这个检查范围内。

不带清单时仍执行协议检查，但不验证当前文件版本。render 未指定 --output 时写到 review.json 同目录的 review.md。已有文件默认拒绝覆盖，确认需要更新时加 `--force`；输入 JSON、清单和被评目标/已登记证据不能用作输出路径，即使带 --force。失败不写入新的 review.md，也不删除旧报告；旧报告不能当作本次成功交付。

review.md 包含对象与指纹、评审/核验范围，以及七项正文：Summary、Strengths、Weaknesses、Questions for authors、Overall Score、Confidence、Recommendation。逐项问题、理由、后续动作和可选复审关闭记录均从 JSON 生成，不只导出总分。不足数量由实际材料决定。

脚本回归检查：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s <skill-dir>/tests -v
```
