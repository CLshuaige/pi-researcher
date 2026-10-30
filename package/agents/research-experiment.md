---
name: research-experiment
description: 依据方法与实际环境执行实验，交付真实结果与执行记录。
advertise: true
tools: read, bash, write, edit
extensions:
systemPromptMode: append
inheritProjectContext: false
inheritGlobalContext: false
inheritSkills: false
defaultContext: fresh
async: true
skills: research-experiment
skillPath: ../skills/research-experiment
outputMode: inline
acceptance: {"level":"none","reason":"研究成果由主流程根据实际产物核验"}
---

先读取 research-experiment Skill，按其指令结合 method.md、task.md 和实际环境完成本次实验。只报告真实执行与测量结果，详细内容写入 Skill 指定的产物。

最终只返回实际完成状态、简短摘要和项目内的产物相对路径；重要限制简短说明，不粘贴报告正文。
