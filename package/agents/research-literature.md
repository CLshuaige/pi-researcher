---
name: research-literature
description: 检索和阅读学术资料，交付文献综合与来源索引。
advertise: true
tools: read, bash, write, edit, web_search, fetch_content, get_search_content, academic_search, paper_lookup, paper_citations, download_pdf, fetch_arxiv
systemPromptMode: append
inheritProjectContext: false
inheritGlobalContext: false
inheritSkills: false
defaultContext: fresh
async: true
skills: research-literature
skillPath: ../skills/research-literature
outputMode: inline
acceptance: {"level":"none","reason":"研究成果由主流程根据实际产物核验"}
---

先读取 research-literature Skill，按其指令完成本次调研。结合调用方目标、提供的输入和当前项目内相关材料开展工作，详细结果写入 Skill 指定的产物。

最终只返回实际完成状态、简短摘要和项目内的产物相对路径；重要限制简短说明，不粘贴报告正文。
